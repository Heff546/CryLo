// Copyright (c) 2026 CryLo contributors
// Distributed under the GNU General Public License v3.0.
//
// Testnet v21+ Development Fund recipient proof. NEVER embed a wallet view or spend
// secret in public consensus code. This header complements the Gas proof
// with a distinct DLEQ transcript and canonical three-field suffix.
#pragma once

#include "cryptonote_core/crylo_testnet_gas_treasury_proof.h"

namespace cryptonote
{
  // Separate domain: no valid Gas proof can be misinterpreted as DevelopmentFund.
  // This transcript covers the entire coinbase prefix before EITHER proof.
  inline crypto::hash crylo_testnet_dev_fund_proof_message(
      const transaction& transaction_without_proof,
      const uint64_t height)
  {
    const crypto::hash prefix_hash =
        get_transaction_prefix_hash(transaction_without_proof);

    std::string transcript("CryLo:testnet-v4+:DevelopmentFundCoinbase:DLEQ:v1");
    transcript.push_back('\0');
    for (const auto byte : config::testnet::NETWORK_ID)
      transcript.push_back(static_cast<char>(byte));
    for (size_t i = 0; i < 8; ++i)
      transcript.push_back(static_cast<char>((height >> (8 * i)) & 0xff));
    transcript.append(config::testnet::GENESIS_TX);
    transcript.append(
        reinterpret_cast<const char*>(&prefix_hash), sizeof(prefix_hash));
    return crypto::cn_fast_hash(transcript.data(), transcript.size());
  }

  // Add this FIRST, then Liquidity and Gas Treasury proofs, each signing
  // over preceding proofs. Do not re-sort after signing.
  inline bool add_crylo_testnet_dev_fund_proof(
      transaction& tx,
      const uint64_t height,
      const crypto::secret_key& tx_secret,
      const crypto::public_key& dev_fund_view,
      const crypto::public_key& dev_fund_spend,
      const size_t dev_fund_index)
  {
    if (dev_fund_index >= tx.vout.size() ||
        tx.extra.size() + CRYLO_TESTNET_TREASURY_PROOF_FIELD_BYTES > MAX_TX_EXTRA_SIZE)
      return false;

    try
    {
      const crypto::public_key tx_pub_key = get_tx_pub_key_from_extra(tx);
      crypto::public_key expected_pub_key;
      if (tx_pub_key == crypto::null_pkey ||
          !crypto::secret_key_to_public_key(tx_secret, expected_pub_key) ||
          expected_pub_key != tx_pub_key ||
          !rct::isInMainSubgroup(rct::pk2rct(dev_fund_view)) ||
          !rct::isInMainSubgroup(rct::pk2rct(tx_pub_key)))
        return false;

      // rct::scalarmultKey computes r*A, WITHOUT the cofactor of eight
      // used by generate_key_derivation(). The v2 transaction proof
      // checks that log_G(R) == log_A(D).
      const rct::key shared =
          rct::scalarmultKey(
              rct::pk2rct(dev_fund_view), rct::sk2rct(tx_secret));
      const crypto::public_key shared_point = rct::rct2pk(shared);
      if (!rct::isInMainSubgroup(shared) ||
          shared == rct::identity())
        return false;

      // Prove recipient derivation for the actual coinbase prefix,
      // not just a reusable transaction public key.
      const crypto::hash message = crylo_testnet_dev_fund_proof_message(tx, height);
      crypto::signature signature;
      crypto::generate_tx_proof(
          message, tx_pub_key, dev_fund_view, boost::none,
          shared_point, tx_secret, signature);

      // Additional defense: verify our own proof and destination before
      // finalizing. The independent consensus path repeats both checks.
      if (!crypto::check_tx_proof(
              message, tx_pub_key, dev_fund_view, boost::none,
              shared_point, signature, 2))
        return false;

      const rct::key cofactored = rct::scalarmult8(shared);
      crypto::key_derivation derivation;
      std::memcpy(&derivation, cofactored.bytes, sizeof(derivation));
      crypto::public_key expected_output;
      crypto::public_key actual_output;
      if (!crypto::derive_public_key(
              derivation, dev_fund_index, dev_fund_spend, expected_output) ||
          !get_output_public_key(tx.vout[dev_fund_index], actual_output) ||
          expected_output != actual_output)
        return false;

      crypto::view_tag expected_tag;
      crypto::derive_view_tag(derivation, dev_fund_index, expected_tag);
      const auto actual_tag = get_output_view_tag(tx.vout[dev_fund_index]);
      if (!actual_tag || actual_tag->data != expected_tag.data)
        return false;

      // A fixed 96-byte string uses one canonical varint byte (0x60).
      tx.extra.push_back(TX_EXTRA_TAG_CRYLO_DEV_FUND_PROOF);
      tx.extra.push_back(static_cast<uint8_t>(CRYLO_TESTNET_TREASURY_PROOF_BYTES));
      const auto *d = reinterpret_cast<const uint8_t*>(&shared_point);
      tx.extra.insert(tx.extra.end(), d, d + sizeof(shared_point));
      const auto *sig = reinterpret_cast<const uint8_t*>(&signature);
      tx.extra.insert(tx.extra.end(), sig, sig + sizeof(signature));
      return true;
    }
    catch (const std::exception&)
    {
      return false;
    }
  }

  // Canonical TESTNET v21+ suffix: Dev proof, Liquidity proof, Gas proof.
  // The Developer proof signs the coinbase WITHOUT any of the three proofs.
  inline bool verify_crylo_testnet_dev_fund_proof(
      const transaction& tx,
      const uint64_t height,
      const crypto::public_key& dev_fund_view,
      const crypto::public_key& dev_fund_spend,
      const size_t dev_fund_index)
  {
    if (dev_fund_index >= tx.vout.size() ||
        tx.extra.size() < 3 * CRYLO_TESTNET_TREASURY_PROOF_FIELD_BYTES ||
        tx.extra.size() > MAX_TX_EXTRA_SIZE)
      return false;

    const size_t gas_start =
        tx.extra.size() - CRYLO_TESTNET_TREASURY_PROOF_FIELD_BYTES;
    const size_t liquidity_start =
        gas_start - CRYLO_TESTNET_TREASURY_PROOF_FIELD_BYTES;
    const size_t proof_start =
        liquidity_start - CRYLO_TESTNET_TREASURY_PROOF_FIELD_BYTES;
    if (tx.extra[proof_start] != TX_EXTRA_TAG_CRYLO_DEV_FUND_PROOF ||
        tx.extra[proof_start + 1] != CRYLO_TESTNET_TREASURY_PROOF_BYTES ||
        tx.extra[liquidity_start] != TX_EXTRA_TAG_CRYLO_LIQUIDITY_PROOF ||
        tx.extra[liquidity_start + 1] != CRYLO_TESTNET_TREASURY_PROOF_BYTES ||
        tx.extra[gas_start] != TX_EXTRA_TAG_CRYLO_GAS_TREASURY_PROOF ||
        tx.extra[gas_start + 1] != CRYLO_TESTNET_TREASURY_PROOF_BYTES)
      return false;

    std::vector<tx_extra_field> fields;
    if (!parse_tx_extra(tx.extra, fields))
      return false;

    size_t dev_count = 0, liquidity_count = 0, gas_count = 0;
    for (const auto& field : fields)
    {
      if (const auto *proof = boost::get<tx_extra_crylo_dev_fund_proof>(&field))
      {
        ++dev_count;
        if (proof->data.size() != CRYLO_TESTNET_TREASURY_PROOF_BYTES ||
            !std::equal(proof->data.begin(), proof->data.end(),
                tx.extra.begin() + proof_start + 2,
                [](char a, uint8_t b) {
                  return static_cast<uint8_t>(a) == b;
                }))
          return false;
      }
      if (const auto *proof = boost::get<tx_extra_crylo_liquidity_proof>(&field))
      {
        ++liquidity_count;
        if (proof->data.size() != CRYLO_TESTNET_TREASURY_PROOF_BYTES ||
            !std::equal(proof->data.begin(), proof->data.end(),
                tx.extra.begin() + liquidity_start + 2,
                [](char a, uint8_t b) {
                  return static_cast<uint8_t>(a) == b;
                }))
          return false;
      }
      if (const auto *proof = boost::get<tx_extra_crylo_gas_treasury_proof>(&field))
      {
        ++gas_count;
        if (proof->data.size() != CRYLO_TESTNET_TREASURY_PROOF_BYTES ||
            !std::equal(proof->data.begin(), proof->data.end(),
                tx.extra.begin() + gas_start + 2,
                [](char a, uint8_t b) {
                  return static_cast<uint8_t>(a) == b;
                }))
          return false;
      }
    }
    if (dev_count != 1 || liquidity_count != 1 || gas_count != 1)
      return false;

    crypto::public_key shared_point;
    crypto::signature signature;
    std::memcpy(&shared_point,
        tx.extra.data() + proof_start + 2, sizeof(shared_point));
    std::memcpy(&signature,
        tx.extra.data() + proof_start + 2 + sizeof(shared_point),
        sizeof(signature));

    transaction without_proof = tx;
    without_proof.extra.resize(proof_start);
    without_proof.invalidate_hashes();

    try
    {
      const crypto::public_key tx_pub_key =
          get_tx_pub_key_from_extra(without_proof);
      if (tx_pub_key == crypto::null_pkey ||
          !rct::isInMainSubgroup(rct::pk2rct(dev_fund_view)) ||
          !rct::isInMainSubgroup(rct::pk2rct(tx_pub_key)) ||
          !rct::isInMainSubgroup(rct::pk2rct(shared_point)) ||
          shared_point == crypto::null_pkey ||
          !crypto::check_tx_proof(
              crylo_testnet_dev_fund_proof_message(without_proof, height),
              tx_pub_key, dev_fund_view, boost::none,
              shared_point, signature, 2))
        return false;

      const rct::key cofactored =
          rct::scalarmult8(rct::pk2rct(shared_point));
      crypto::key_derivation derivation;
      std::memcpy(&derivation, cofactored.bytes, sizeof(derivation));
      crypto::public_key expected_output;
      crypto::public_key actual_output;
      if (!crypto::derive_public_key(
              derivation, dev_fund_index, dev_fund_spend, expected_output) ||
          !get_output_public_key(tx.vout[dev_fund_index], actual_output) ||
          expected_output != actual_output)
        return false;
      crypto::view_tag expected_tag;
      crypto::derive_view_tag(derivation, dev_fund_index, expected_tag);
      const auto actual_tag = get_output_view_tag(tx.vout[dev_fund_index]);
      return actual_tag && actual_tag->data == expected_tag.data;
    }
    catch (const std::exception&)
    {
      return false;
    }
  }
}
