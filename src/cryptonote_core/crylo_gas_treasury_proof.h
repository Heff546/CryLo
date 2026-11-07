// Copyright (c) 2026 CryLo contributors
// Distributed under the GNU General Public License v3.0.
// Mainnet-only coinbase Treasury recipient proof. No private wallet view
// or spend key is embedded in a publicly distributed validator.
#pragma once

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <exception>
#include <cstring>
#include <string>
#include <vector>

#include "cryptonote_config.h"
#include "cryptonote_basic/cryptonote_format_utils.h"
#include "cryptonote_basic/tx_extra.h"
#include "crypto/crypto.h"
#include "crypto/hash.h"
#include "ringct/rctOps.h"

namespace cryptonote
{
  // Version 1: one byte tag, one byte canonical length (96),
  // 32-byte uncofactored shared point D=r*A, 64-byte v2 DLEQ signature.
  static constexpr size_t CRYLO_TREASURY_PROOF_BYTES =
      sizeof(crypto::public_key) + sizeof(crypto::signature);
  static constexpr size_t CRYLO_TREASURY_PROOF_FIELD_BYTES =
      2 + CRYLO_TREASURY_PROOF_BYTES;
  static_assert(CRYLO_TREASURY_PROOF_BYTES == 96,
      "Unexpected CryptoNote point or signature format");

  // The message commits to the entire coinbase transaction prefix
  // BEFORE inserting the proof. Thus amount, output keys, unlock time,
  // extra nonce and the height-bound generation input cannot be changed
  // without making the proof invalid. Only mainnet's network ID/genesis
  // are used: testnet has no such consensus requirement.
  inline crypto::hash crylo_treasury_proof_message(
      const transaction& transaction_without_proof,
      const uint64_t height)
  {
    const crypto::hash prefix_hash =
        get_transaction_prefix_hash(transaction_without_proof);

    std::string transcript("CryLo:mainnet:GasTreasuryCoinbase:DLEQ:v1");
    transcript.push_back('\0');
    for (const auto byte : config::NETWORK_ID)
      transcript.push_back(static_cast<char>(byte));
    for (size_t i = 0; i < 8; ++i)
      transcript.push_back(static_cast<char>((height >> (8 * i)) & 0xff));
    transcript.append(config::GENESIS_TX);
    transcript.append(
        reinterpret_cast<const char*>(&prefix_hash), sizeof(prefix_hash));
    return crypto::cn_fast_hash(transcript.data(), transcript.size());
  }

  // Called only by the MAINNET v21+ miner, after all coinbase outputs,
  // unlock time, input height and extra nonce are final.
  inline bool add_crylo_mainnet_treasury_proof(
      transaction& tx,
      const uint64_t height,
      const crypto::secret_key& tx_secret,
      const crypto::public_key& treasury_view,
      const crypto::public_key& treasury_spend,
      const size_t treasury_index)
  {
    if (treasury_index >= tx.vout.size() ||
        tx.extra.size() + CRYLO_TREASURY_PROOF_FIELD_BYTES > MAX_TX_EXTRA_SIZE)
      return false;

    try
    {
      const crypto::public_key tx_pub_key = get_tx_pub_key_from_extra(tx);
      crypto::public_key expected_pub_key;
      if (tx_pub_key == crypto::null_pkey ||
          !crypto::secret_key_to_public_key(tx_secret, expected_pub_key) ||
          expected_pub_key != tx_pub_key ||
          !rct::isInMainSubgroup(rct::pk2rct(treasury_view)) ||
          !rct::isInMainSubgroup(rct::pk2rct(tx_pub_key)))
        return false;

      // rct::scalarmultKey computes r*A, WITHOUT the cofactor of eight
      // used by generate_key_derivation(). The v2 transaction proof
      // checks that log_G(R) == log_A(D).
      const rct::key shared =
          rct::scalarmultKey(
              rct::pk2rct(treasury_view), rct::sk2rct(tx_secret));
      const crypto::public_key shared_point = rct::rct2pk(shared);
      if (!rct::isInMainSubgroup(shared) ||
          shared == rct::identity())
        return false;

      // Prove recipient derivation for the actual coinbase prefix,
      // not just a reusable transaction public key.
      const crypto::hash message = crylo_treasury_proof_message(tx, height);
      crypto::signature signature;
      crypto::generate_tx_proof(
          message, tx_pub_key, treasury_view, boost::none,
          shared_point, tx_secret, signature);

      // Additional defense: verify our own proof and destination before
      // finalizing. The independent consensus path repeats both checks.
      if (!crypto::check_tx_proof(
              message, tx_pub_key, treasury_view, boost::none,
              shared_point, signature, 2))
        return false;

      const rct::key cofactored = rct::scalarmult8(shared);
      crypto::key_derivation derivation;
      std::memcpy(&derivation, cofactored.bytes, sizeof(derivation));
      crypto::public_key expected_output;
      crypto::public_key actual_output;
      if (!crypto::derive_public_key(
              derivation, treasury_index, treasury_spend, expected_output) ||
          !get_output_public_key(tx.vout[treasury_index], actual_output) ||
          expected_output != actual_output)
        return false;

      crypto::view_tag expected_tag;
      crypto::derive_view_tag(derivation, treasury_index, expected_tag);
      const auto actual_tag = get_output_view_tag(tx.vout[treasury_index]);
      if (!actual_tag || actual_tag->data != expected_tag.data)
        return false;

      // A fixed 96-byte string uses one canonical varint byte (0x60).
      tx.extra.push_back(TX_EXTRA_TAG_CRYLO_GAS_TREASURY_PROOF);
      tx.extra.push_back(static_cast<uint8_t>(CRYLO_TREASURY_PROOF_BYTES));
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

  // Called only by the MAINNET v21+ block consensus validator. The
  // deliberately strict suffix rule prevents duplicate proofs, alternate
  // varint encodings and any hidden extra data after the proof.
  inline bool verify_crylo_mainnet_treasury_proof(
      const transaction& tx,
      const uint64_t height,
      const crypto::public_key& treasury_view,
      const crypto::public_key& treasury_spend,
      const size_t treasury_index)
  {
    if (treasury_index >= tx.vout.size() ||
        tx.extra.size() < CRYLO_TREASURY_PROOF_FIELD_BYTES ||
        tx.extra.size() > MAX_TX_EXTRA_SIZE)
      return false;

    const size_t proof_start =
        tx.extra.size() - CRYLO_TREASURY_PROOF_FIELD_BYTES;
    if (tx.extra[proof_start] != TX_EXTRA_TAG_CRYLO_GAS_TREASURY_PROOF ||
        tx.extra[proof_start + 1] != CRYLO_TREASURY_PROOF_BYTES)
      return false;

    std::vector<tx_extra_field> fields;
    if (!parse_tx_extra(tx.extra, fields))
      return false;

    size_t count = 0;
    for (const auto& field : fields)
      if (const auto *proof =
              boost::get<tx_extra_crylo_gas_treasury_proof>(&field))
      {
        ++count;
        if (proof->data.size() != CRYLO_TREASURY_PROOF_BYTES ||
            !std::equal(proof->data.begin(), proof->data.end(),
                tx.extra.begin() + proof_start + 2,
                [](char a, uint8_t b) {
                  return static_cast<uint8_t>(a) == b;
                }))
          return false;
      }
    if (count != 1)
      return false;

    crypto::public_key shared_point;
    crypto::signature signature;
    std::memcpy(&shared_point,
        tx.extra.data() + proof_start + 2, sizeof(shared_point));
    std::memcpy(&signature,
        tx.extra.data() + proof_start + 2 + sizeof(shared_point),
        sizeof(signature));

    // Do not include the proof in its own transcript hash.
    transaction without_proof = tx;
    without_proof.extra.resize(proof_start);
    without_proof.invalidate_hashes();

    try
    {
      const crypto::public_key tx_pub_key =
          get_tx_pub_key_from_extra(without_proof);
      if (tx_pub_key == crypto::null_pkey ||
          !rct::isInMainSubgroup(rct::pk2rct(treasury_view)) ||
          !rct::isInMainSubgroup(rct::pk2rct(tx_pub_key)) ||
          !rct::isInMainSubgroup(rct::pk2rct(shared_point)) ||
          shared_point == crypto::null_pkey ||
          !crypto::check_tx_proof(
              crylo_treasury_proof_message(without_proof, height),
              tx_pub_key, treasury_view, boost::none,
              shared_point, signature, 2))
        return false;

      const rct::key cofactored =
          rct::scalarmult8(rct::pk2rct(shared_point));
      crypto::key_derivation derivation;
      std::memcpy(&derivation, cofactored.bytes, sizeof(derivation));

      crypto::public_key expected_output;
      crypto::public_key actual_output;
      if (!crypto::derive_public_key(
              derivation, treasury_index, treasury_spend, expected_output) ||
          !get_output_public_key(tx.vout[treasury_index], actual_output) ||
          expected_output != actual_output)
        return false;

      crypto::view_tag expected_tag;
      crypto::derive_view_tag(derivation, treasury_index, expected_tag);
      const auto actual_tag = get_output_view_tag(tx.vout[treasury_index]);
      return actual_tag && actual_tag->data == expected_tag.data;
    }
    catch (const std::exception&)
    {
      return false;
    }
  }
}
