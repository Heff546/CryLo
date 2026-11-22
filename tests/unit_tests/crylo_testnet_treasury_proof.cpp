// Copyright (c) 2026 CryLo contributors
// Distributed under the GNU General Public License v3.0.
//
// Native, in-memory adversarial tests for the UNSCHEDULED Testnet v21 Treasury
// recipient proof. These tests cannot by themselves authorize Testnet v21 activation.
// No wallet seeds, private production keys, network RPC, or chain files used.

#include "gtest/gtest.h"

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <vector>

#include "string_tools.h"
#include "cryptonote_config.h"
#include "cryptonote_basic/account.h"
#include "cryptonote_basic/cryptonote_basic.h"
#include "cryptonote_basic/cryptonote_format_utils.h"
#include "cryptonote_core/cryptonote_tx_utils.h"
#include "cryptonote_core/crylo_testnet_gas_treasury_proof.h"
#include "cryptonote_core/crylo_testnet_liquidity_proof.h"
#include "cryptonote_core/crylo_testnet_dev_fund_proof.h"

namespace
{
constexpr size_t kHeight = 2;
constexpr uint8_t kTestnetProofVersion = HF_VERSION_TESTNET_TREASURY_PROOFS;
constexpr size_t kTreasuryOutput = 4;

bool build_coinbase(cryptonote::network_type network,
                    cryptonote::transaction& coinbase,
                    uint8_t version = kTestnetProofVersion)
{
  cryptonote::account_base miner;
  miner.generate();

  return cryptonote::construct_miner_tx(
      nullptr,
      network,
      kHeight,
      300000,
      0,
      1000,
      0,
      miner.get_keys().m_account_address,
      coinbase,
      cryptonote::blobdata(),
      5,
      version);
}

bool configured_treasury_keys(crypto::public_key& view,
                              crypto::public_key& spend)
{
  return epee::string_tools::hex_to_pod(CryLo_GAS_TREASURY_VIEWKEY, view) &&
         epee::string_tools::hex_to_pod(CryLo_GAS_TREASURY_SPENDKEY, spend);
}

bool verify(cryptonote::transaction const& tx,
            uint64_t height = kHeight,
            size_t index = kTreasuryOutput)
{
  crypto::public_key view;
  crypto::public_key spend;
  return configured_treasury_keys(view, spend) &&
         cryptonote::verify_crylo_testnet_treasury_proof(
             tx, height, view, spend, index);
}

bool verify_dev(cryptonote::transaction const& tx,
                uint64_t height = kHeight,
                size_t index = 2)
{
  crypto::public_key view, spend;
  return epee::string_tools::hex_to_pod(CryLo_DEV_FUND_VIEWKEY, view) &&
         epee::string_tools::hex_to_pod(CryLo_DEV_FUND_SPENDKEY, spend) &&
         cryptonote::verify_crylo_testnet_dev_fund_proof(
             tx, height, view, spend, index);
}

bool verify_liquidity(cryptonote::transaction const& tx,
                      uint64_t height = kHeight,
                      size_t index = 3)
{
  crypto::public_key view;
  crypto::public_key spend;
  return epee::string_tools::hex_to_pod(CryLo_LIQUIDITY_FUND_VIEWKEY, view) &&
         epee::string_tools::hex_to_pod(CryLo_LIQUIDITY_FUND_SPENDKEY, spend) &&
         cryptonote::verify_crylo_testnet_liquidity_proof(
             tx, height, view, spend, index);
}
} // namespace

class CryLoTestnetV21TreasuryProof : public ::testing::Test
{
protected:
  cryptonote::transaction tx;

  void SetUp() override
  {
    ASSERT_TRUE(build_coinbase(cryptonote::TESTNET, tx))
        << "Testnet v21 constructor must produce a valid in-memory v21 transaction";
    ASSERT_EQ(5U, tx.vout.size());
  }
};

TEST_F(CryLoTestnetV21TreasuryProof, ApprovedFiveOutputAllocation)
{
  const uint64_t total = cryptonote::get_outs_money_amount(tx);
  ASSERT_EQ(5U, tx.vout.size());
  ASSERT_EQ(total * 75 / 10000, tx.vout[2].amount);
  ASSERT_EQ(total * 25 / 10000, tx.vout[3].amount);
  ASSERT_EQ(total * 50 / 10000, tx.vout[4].amount);
  ASSERT_TRUE(verify(tx));
  ASSERT_TRUE(verify_liquidity(tx));
  ASSERT_TRUE(verify_dev(tx));
}

TEST_F(CryLoTestnetV21TreasuryProof, ValidCoinbaseProofAccepted)
{
  ASSERT_TRUE(verify(tx));
  ASSERT_TRUE(verify_liquidity(tx));
  ASSERT_TRUE(verify_dev(tx));
}

TEST_F(CryLoTestnetV21TreasuryProof, DevelopmentProofWrongHeightRejected)
{
  ASSERT_TRUE(verify_dev(tx));
  ASSERT_FALSE(verify_dev(tx, kHeight + 1));
}

TEST_F(CryLoTestnetV21TreasuryProof, DevelopmentProofWrongOutputIndexRejected)
{
  ASSERT_TRUE(verify_dev(tx));
  ASSERT_FALSE(verify_dev(tx, kHeight, 3));
}

TEST_F(CryLoTestnetV21TreasuryProof, DevelopmentProofWrongRecipientRejected)
{
  crypto::public_key view, wrong_spend;
  ASSERT_TRUE(epee::string_tools::hex_to_pod(CryLo_DEV_FUND_VIEWKEY, view));
  ASSERT_TRUE(epee::string_tools::hex_to_pod(CryLo_GAS_TREASURY_SPENDKEY, wrong_spend));
  ASSERT_FALSE(cryptonote::verify_crylo_testnet_dev_fund_proof(
      tx, kHeight, view, wrong_spend, 2));
}

TEST_F(CryLoTestnetV21TreasuryProof, DevelopmentProofSignatureTamperRejected)
{
  ASSERT_TRUE(verify_dev(tx));
  ASSERT_GE(tx.extra.size(), 3 * cryptonote::CRYLO_TESTNET_TREASURY_PROOF_FIELD_BYTES);
  const size_t pos = tx.extra.size() - 2 * cryptonote::CRYLO_TESTNET_TREASURY_PROOF_FIELD_BYTES - 1;
  tx.extra[pos] ^= 1;
  tx.invalidate_hashes();
  ASSERT_FALSE(verify_dev(tx));
  ASSERT_FALSE(verify_liquidity(tx));
  ASSERT_FALSE(verify(tx));
}

TEST_F(CryLoTestnetV21TreasuryProof, DevelopmentProofMissingRejected)
{
  ASSERT_TRUE(verify_dev(tx));
  const size_t pos = tx.extra.size() - 3 * cryptonote::CRYLO_TESTNET_TREASURY_PROOF_FIELD_BYTES;
  tx.extra.erase(tx.extra.begin() + pos,
      tx.extra.begin() + pos + cryptonote::CRYLO_TESTNET_TREASURY_PROOF_FIELD_BYTES);
  tx.invalidate_hashes();
  ASSERT_FALSE(verify_dev(tx));
  ASSERT_FALSE(verify_liquidity(tx));
  ASSERT_FALSE(verify(tx));
}

TEST_F(CryLoTestnetV21TreasuryProof, DevelopmentProofBadLengthRejected)
{
  ASSERT_TRUE(verify_dev(tx));
  const size_t pos = tx.extra.size() - 3 * cryptonote::CRYLO_TESTNET_TREASURY_PROOF_FIELD_BYTES;
  tx.extra[pos + 1] = 95;
  tx.invalidate_hashes();
  ASSERT_FALSE(verify_dev(tx));
}

TEST_F(CryLoTestnetV21TreasuryProof, DevelopmentProofOutputTamperRejected)
{
  ASSERT_TRUE(verify_dev(tx));
  ++tx.vout[2].amount;
  tx.invalidate_hashes();
  ASSERT_FALSE(verify_dev(tx));
}

TEST_F(CryLoTestnetV21TreasuryProof, DevelopmentProofDuplicateRejected)
{
  ASSERT_TRUE(verify_dev(tx));
  const size_t pos = tx.extra.size() - 3 * cryptonote::CRYLO_TESTNET_TREASURY_PROOF_FIELD_BYTES;
  const std::vector<uint8_t> field(
      tx.extra.begin() + pos,
      tx.extra.begin() + pos + cryptonote::CRYLO_TESTNET_TREASURY_PROOF_FIELD_BYTES);
  tx.extra.insert(tx.extra.begin() + pos, field.begin(), field.end());
  tx.invalidate_hashes();
  ASSERT_FALSE(verify_dev(tx));
  ASSERT_FALSE(verify_liquidity(tx));
  ASSERT_FALSE(verify(tx));
}

TEST_F(CryLoTestnetV21TreasuryProof, DevelopmentProofViewTagTamperRejected)
{
  ASSERT_TRUE(verify_dev(tx));
  auto *target = boost::get<cryptonote::txout_to_tagged_key>(
      &tx.vout[2].target);
  ASSERT_NE(nullptr, target);
  target->view_tag.data ^= 1;
  tx.invalidate_hashes();
  ASSERT_FALSE(verify_dev(tx));
}

TEST_F(CryLoTestnetV21TreasuryProof, DevelopmentProofReorderedRejected)
{
  ASSERT_TRUE(verify_dev(tx));
  const size_t begin =
      tx.extra.size() - 3 * cryptonote::CRYLO_TESTNET_TREASURY_PROOF_FIELD_BYTES;
  const auto fieldSize = cryptonote::CRYLO_TESTNET_TREASURY_PROOF_FIELD_BYTES;
  std::swap_ranges(
      tx.extra.begin() + begin, tx.extra.begin() + begin + fieldSize,
      tx.extra.begin() + begin + fieldSize);
  tx.invalidate_hashes();
  ASSERT_FALSE(verify_dev(tx));
  ASSERT_FALSE(verify_liquidity(tx));
  ASSERT_FALSE(verify(tx));
}

TEST_F(CryLoTestnetV21TreasuryProof, DevelopmentProofSharedPointTamperRejected)
{
  ASSERT_TRUE(verify_dev(tx));
  const size_t begin =
      tx.extra.size() - 3 * cryptonote::CRYLO_TESTNET_TREASURY_PROOF_FIELD_BYTES;
  tx.extra[begin + 2] ^= 1;
  tx.invalidate_hashes();
  ASSERT_FALSE(verify_dev(tx));
}

TEST_F(CryLoTestnetV21TreasuryProof, DifferentBlockHeightRejected)
{
  ASSERT_TRUE(verify(tx));
  ASSERT_FALSE(verify(tx, kHeight + 1));
}

TEST_F(CryLoTestnetV21TreasuryProof, DifferentTreasuryOutputIndexRejected)
{
  ASSERT_TRUE(verify(tx));
  ASSERT_FALSE(verify(tx, kHeight, kTreasuryOutput - 1));
}

TEST_F(CryLoTestnetV21TreasuryProof, TreasuryDestinationSubstitutionRejected)
{
  cryptonote::account_base attacker;
  attacker.generate();
  auto* destination =
      boost::get<cryptonote::txout_to_tagged_key>(&tx.vout[kTreasuryOutput].target);
  ASSERT_NE(nullptr, destination);
  destination->key = attacker.get_keys().m_account_address.m_spend_public_key;
  tx.invalidate_hashes();
  ASSERT_FALSE(verify(tx));
}

TEST_F(CryLoTestnetV21TreasuryProof, TreasuryViewTagModificationRejected)
{
  auto* destination =
      boost::get<cryptonote::txout_to_tagged_key>(&tx.vout[kTreasuryOutput].target);
  ASSERT_NE(nullptr, destination);
  destination->view_tag.data ^= 1;
  tx.invalidate_hashes();
  ASSERT_FALSE(verify(tx));
}

TEST_F(CryLoTestnetV21TreasuryProof, TreasuryAmountModificationRejected)
{
  ++tx.vout[kTreasuryOutput].amount;
  tx.invalidate_hashes();
  ASSERT_FALSE(verify(tx));
}

TEST_F(CryLoTestnetV21TreasuryProof, ValidProofWithWrongTreasuryRecipientRejected)
{
  crypto::public_key view;
  crypto::public_key spend;
  ASSERT_TRUE(configured_treasury_keys(view, spend));

  cryptonote::account_base attacker;
  attacker.generate();
  const auto wrong_spend = attacker.get_keys().m_account_address.m_spend_public_key;

  ASSERT_FALSE(cryptonote::verify_crylo_testnet_treasury_proof(
      tx, kHeight, view, wrong_spend, kTreasuryOutput));
}

TEST_F(CryLoTestnetV21TreasuryProof, AlteredProofSignatureRejected)
{
  ASSERT_TRUE(verify(tx));
  tx.extra.back() ^= 1;
  tx.invalidate_hashes();
  ASSERT_FALSE(verify(tx));
}

TEST_F(CryLoTestnetV21TreasuryProof, MissingProofRejected)
{
  ASSERT_GE(tx.extra.size(), cryptonote::CRYLO_TESTNET_TREASURY_PROOF_FIELD_BYTES);
  tx.extra.resize(
      tx.extra.size() - cryptonote::CRYLO_TESTNET_TREASURY_PROOF_FIELD_BYTES);
  tx.invalidate_hashes();
  ASSERT_FALSE(verify(tx));
}

TEST_F(CryLoTestnetV21TreasuryProof, DuplicateProofRejected)
{
  ASSERT_TRUE(verify(tx));
  ASSERT_GE(tx.extra.size(), cryptonote::CRYLO_TESTNET_TREASURY_PROOF_FIELD_BYTES);
  const std::vector<uint8_t> proof(
      tx.extra.end() - cryptonote::CRYLO_TESTNET_TREASURY_PROOF_FIELD_BYTES,
      tx.extra.end());
  tx.extra.insert(tx.extra.end(), proof.begin(), proof.end());
  tx.invalidate_hashes();
  ASSERT_FALSE(verify(tx));
}

TEST_F(CryLoTestnetV21TreasuryProof, WrongProofLengthRejected)
{
  ASSERT_TRUE(verify(tx));
  ASSERT_GE(tx.extra.size(), cryptonote::CRYLO_TESTNET_TREASURY_PROOF_FIELD_BYTES);
  const size_t proof_start =
      tx.extra.size() - cryptonote::CRYLO_TESTNET_TREASURY_PROOF_FIELD_BYTES;
  tx.extra[proof_start + 1] = 95;
  tx.invalidate_hashes();
  ASSERT_FALSE(verify(tx));
}

TEST_F(CryLoTestnetV21TreasuryProof, ProofTruncationRejected)
{
  ASSERT_TRUE(verify(tx));
  tx.extra.pop_back();
  tx.invalidate_hashes();
  ASSERT_FALSE(verify(tx));
}

TEST_F(CryLoTestnetV21TreasuryProof, LiquidityIncorrectRecipientRejected)
{
  crypto::public_key view, spend;
  ASSERT_TRUE(epee::string_tools::hex_to_pod(CryLo_LIQUIDITY_FUND_VIEWKEY, view));
  ASSERT_TRUE(epee::string_tools::hex_to_pod(CryLo_LIQUIDITY_FUND_SPENDKEY, spend));
  cryptonote::account_base attacker;
  attacker.generate();
  ASSERT_FALSE(cryptonote::verify_crylo_testnet_liquidity_proof(
      tx, kHeight, view, attacker.get_keys().m_account_address.m_spend_public_key, 3));
}

TEST_F(CryLoTestnetV21TreasuryProof, LiquidityOutputSubstitutionRejected)
{
  ASSERT_TRUE(verify_liquidity(tx));
  cryptonote::account_base attacker;
  attacker.generate();
  auto* destination =
      boost::get<cryptonote::txout_to_tagged_key>(&tx.vout[3].target);
  ASSERT_NE(nullptr, destination);
  destination->key = attacker.get_keys().m_account_address.m_spend_public_key;
  tx.invalidate_hashes();
  ASSERT_FALSE(verify_liquidity(tx));
  ASSERT_FALSE(verify(tx));
}

TEST_F(CryLoTestnetV21TreasuryProof, LiquidityAmountChangeRejected)
{
  ASSERT_TRUE(verify_liquidity(tx));
  ++tx.vout[3].amount;
  tx.invalidate_hashes();
  ASSERT_FALSE(verify_liquidity(tx));
  ASSERT_FALSE(verify(tx));
}

TEST_F(CryLoTestnetV21TreasuryProof, LiquidityViewTagChangeRejected)
{
  ASSERT_TRUE(verify_liquidity(tx));
  auto* destination =
      boost::get<cryptonote::txout_to_tagged_key>(&tx.vout[3].target);
  ASSERT_NE(nullptr, destination);
  destination->view_tag.data ^= 1;
  tx.invalidate_hashes();
  ASSERT_FALSE(verify_liquidity(tx));
}

TEST_F(CryLoTestnetV21TreasuryProof, LiquidityWrongHeightRejected)
{
  ASSERT_TRUE(verify_liquidity(tx));
  ASSERT_FALSE(verify_liquidity(tx, kHeight + 1));
}

TEST_F(CryLoTestnetV21TreasuryProof, LiquidityWrongOutputIndexRejected)
{
  ASSERT_TRUE(verify_liquidity(tx));
  ASSERT_FALSE(verify_liquidity(tx, kHeight, 4));
}

TEST_F(CryLoTestnetV21TreasuryProof, LiquidityProofSignatureTamperRejected)
{
  ASSERT_TRUE(verify_liquidity(tx));
  ASSERT_GE(tx.extra.size(), 2 * cryptonote::CRYLO_TESTNET_TREASURY_PROOF_FIELD_BYTES);
  const size_t liquidity_start =
      tx.extra.size() - 2 * cryptonote::CRYLO_TESTNET_TREASURY_PROOF_FIELD_BYTES;
  tx.extra[liquidity_start + cryptonote::CRYLO_TESTNET_TREASURY_PROOF_FIELD_BYTES - 1] ^= 1;
  tx.invalidate_hashes();
  ASSERT_FALSE(verify_liquidity(tx));
  ASSERT_FALSE(verify(tx));
}

TEST_F(CryLoTestnetV21TreasuryProof, MissingLiquidityProofRejected)
{
  ASSERT_TRUE(verify_liquidity(tx));
  ASSERT_GE(tx.extra.size(), 2 * cryptonote::CRYLO_TESTNET_TREASURY_PROOF_FIELD_BYTES);
  const auto start =
      tx.extra.end() - 2 * cryptonote::CRYLO_TESTNET_TREASURY_PROOF_FIELD_BYTES;
  tx.extra.erase(start, start + cryptonote::CRYLO_TESTNET_TREASURY_PROOF_FIELD_BYTES);
  tx.invalidate_hashes();
  ASSERT_FALSE(verify_liquidity(tx));
}

TEST_F(CryLoTestnetV21TreasuryProof, DuplicateLiquidityProofRejected)
{
  ASSERT_TRUE(verify_liquidity(tx));
  ASSERT_GE(tx.extra.size(), 2 * cryptonote::CRYLO_TESTNET_TREASURY_PROOF_FIELD_BYTES);
  const size_t start =
      tx.extra.size() - 2 * cryptonote::CRYLO_TESTNET_TREASURY_PROOF_FIELD_BYTES;
  const std::vector<uint8_t> copy(
      tx.extra.begin() + start,
      tx.extra.begin() + start + cryptonote::CRYLO_TESTNET_TREASURY_PROOF_FIELD_BYTES);
  tx.extra.insert(tx.extra.begin() + start, copy.begin(), copy.end());
  tx.invalidate_hashes();
  ASSERT_FALSE(verify_liquidity(tx));
  ASSERT_FALSE(verify(tx));
}

TEST_F(CryLoTestnetV21TreasuryProof, ReversedProofOrderRejected)
{
  ASSERT_TRUE(verify_liquidity(tx));
  ASSERT_TRUE(verify(tx));
  const size_t start =
      tx.extra.size() - 2 * cryptonote::CRYLO_TESTNET_TREASURY_PROOF_FIELD_BYTES;
  const auto first = tx.extra.begin() + start;
  std::swap_ranges(first,
      first + cryptonote::CRYLO_TESTNET_TREASURY_PROOF_FIELD_BYTES,
      first + cryptonote::CRYLO_TESTNET_TREASURY_PROOF_FIELD_BYTES);
  tx.invalidate_hashes();
  ASSERT_FALSE(verify_liquidity(tx));
  ASSERT_FALSE(verify(tx));
}

TEST_F(CryLoTestnetV21TreasuryProof, MalformedLiquidityProofLengthRejected)
{
  ASSERT_TRUE(verify_liquidity(tx));
  const size_t start =
      tx.extra.size() - 2 * cryptonote::CRYLO_TESTNET_TREASURY_PROOF_FIELD_BYTES;
  tx.extra[start + 1] = 95;
  tx.invalidate_hashes();
  ASSERT_FALSE(verify_liquidity(tx));
}

TEST_F(CryLoTestnetV21TreasuryProof, LiquidityProofTruncationRejected)
{
  ASSERT_TRUE(verify_liquidity(tx));
  const size_t end_of_liquidity =
      tx.extra.size() - cryptonote::CRYLO_TESTNET_TREASURY_PROOF_FIELD_BYTES;
  tx.extra.erase(tx.extra.begin() + end_of_liquidity - 1);
  tx.invalidate_hashes();
  ASSERT_FALSE(verify_liquidity(tx));
}

TEST(CryLoLegacyV4TreasuryProof, ExistingV20TransactionHasNoRecipientProof)
{
  cryptonote::transaction tx;
  ASSERT_TRUE(build_coinbase(cryptonote::TESTNET, tx, HF_VERSION_VIEW_TAGS));
  ASSERT_EQ(5U, tx.vout.size());

  std::vector<cryptonote::tx_extra_field> fields;
  ASSERT_TRUE(cryptonote::parse_tx_extra(tx.extra, fields));
  for (const auto& field : fields)
  {
    ASSERT_EQ(nullptr,
              boost::get<cryptonote::tx_extra_crylo_gas_treasury_proof>(&field));
    ASSERT_EQ(nullptr,
              boost::get<cryptonote::tx_extra_crylo_liquidity_proof>(&field));
    ASSERT_EQ(nullptr,
              boost::get<cryptonote::tx_extra_crylo_dev_fund_proof>(&field));
  }
}
