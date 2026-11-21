// Copyright (c) 2026 CryLo contributors
// Distributed under the GNU General Public License v3.0.
//
// Native, in-memory adversarial tests for the UNRELEASED mainnet Treasury
// recipient proof. These tests cannot by themselves authorize mainnet launch.
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
#include "cryptonote_core/crylo_gas_treasury_proof.h"
#include "cryptonote_core/crylo_liquidity_proof.h"
#include "cryptonote_core/crylo_dev_fund_proof.h"

namespace
{
constexpr size_t kHeight = 2;
constexpr uint8_t kMainnetForkVersion = HF_VERSION_BP_PLUS_FULL_COMMIT;
constexpr size_t kTreasuryOutput = 4;

bool build_coinbase(cryptonote::network_type network,
                    cryptonote::transaction& coinbase)
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
      kMainnetForkVersion);
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
         cryptonote::verify_crylo_mainnet_treasury_proof(
             tx, height, view, spend, index);
}

bool verify_dev(cryptonote::transaction const& tx,
                uint64_t height = kHeight,
                size_t index = 2)
{
  crypto::public_key view, spend;
  return epee::string_tools::hex_to_pod(CryLo_MAINNET_DEV_FUND_VIEWKEY, view) &&
         epee::string_tools::hex_to_pod(CryLo_MAINNET_DEV_FUND_SPENDKEY, spend) &&
         cryptonote::verify_crylo_mainnet_dev_fund_proof(
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
         cryptonote::verify_crylo_mainnet_liquidity_proof(
             tx, height, view, spend, index);
}
} // namespace

class CryLoMainnetTreasuryProof : public ::testing::Test
{
protected:
  cryptonote::transaction tx;

  void SetUp() override
  {
    ASSERT_TRUE(build_coinbase(cryptonote::MAINNET, tx))
        << "Mainnet coinbase constructor must produce a valid in-memory v21 transaction";
    ASSERT_EQ(5U, tx.vout.size());
  }
};

TEST_F(CryLoMainnetTreasuryProof, ApprovedFiveOutputAllocation)
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

TEST_F(CryLoMainnetTreasuryProof, ValidCoinbaseProofAccepted)
{
  ASSERT_TRUE(verify(tx));
  ASSERT_TRUE(verify_liquidity(tx));
  ASSERT_TRUE(verify_dev(tx));
}

TEST_F(CryLoMainnetTreasuryProof, DevelopmentProofWrongHeightRejected)
{
  ASSERT_TRUE(verify_dev(tx));
  ASSERT_FALSE(verify_dev(tx, kHeight + 1));
}

TEST_F(CryLoMainnetTreasuryProof, DevelopmentProofWrongOutputIndexRejected)
{
  ASSERT_TRUE(verify_dev(tx));
  ASSERT_FALSE(verify_dev(tx, kHeight, 3));
}

TEST_F(CryLoMainnetTreasuryProof, DevelopmentProofWrongRecipientRejected)
{
  crypto::public_key view, wrong_spend;
  ASSERT_TRUE(epee::string_tools::hex_to_pod(CryLo_MAINNET_DEV_FUND_VIEWKEY, view));
  ASSERT_TRUE(epee::string_tools::hex_to_pod(CryLo_GAS_TREASURY_SPENDKEY, wrong_spend));
  ASSERT_FALSE(cryptonote::verify_crylo_mainnet_dev_fund_proof(
      tx, kHeight, view, wrong_spend, 2));
}

TEST_F(CryLoMainnetTreasuryProof, DevelopmentProofSignatureTamperRejected)
{
  ASSERT_TRUE(verify_dev(tx));
  ASSERT_GE(tx.extra.size(), 3 * cryptonote::CRYLO_TREASURY_PROOF_FIELD_BYTES);
  const size_t pos = tx.extra.size() - 2 * cryptonote::CRYLO_TREASURY_PROOF_FIELD_BYTES - 1;
  tx.extra[pos] ^= 1;
  tx.invalidate_hashes();
  ASSERT_FALSE(verify_dev(tx));
  ASSERT_FALSE(verify_liquidity(tx));
  ASSERT_FALSE(verify(tx));
}

TEST_F(CryLoMainnetTreasuryProof, DevelopmentProofMissingRejected)
{
  ASSERT_TRUE(verify_dev(tx));
  const size_t pos = tx.extra.size() - 3 * cryptonote::CRYLO_TREASURY_PROOF_FIELD_BYTES;
  tx.extra.erase(tx.extra.begin() + pos,
      tx.extra.begin() + pos + cryptonote::CRYLO_TREASURY_PROOF_FIELD_BYTES);
  tx.invalidate_hashes();
  ASSERT_FALSE(verify_dev(tx));
  ASSERT_FALSE(verify_liquidity(tx));
  ASSERT_FALSE(verify(tx));
}

TEST_F(CryLoMainnetTreasuryProof, DevelopmentProofBadLengthRejected)
{
  ASSERT_TRUE(verify_dev(tx));
  const size_t pos = tx.extra.size() - 3 * cryptonote::CRYLO_TREASURY_PROOF_FIELD_BYTES;
  tx.extra[pos + 1] = 95;
  tx.invalidate_hashes();
  ASSERT_FALSE(verify_dev(tx));
}

TEST_F(CryLoMainnetTreasuryProof, DevelopmentProofOutputTamperRejected)
{
  ASSERT_TRUE(verify_dev(tx));
  ++tx.vout[2].amount;
  tx.invalidate_hashes();
  ASSERT_FALSE(verify_dev(tx));
}

TEST_F(CryLoMainnetTreasuryProof, DevelopmentProofDuplicateRejected)
{
  ASSERT_TRUE(verify_dev(tx));
  const size_t pos = tx.extra.size() - 3 * cryptonote::CRYLO_TREASURY_PROOF_FIELD_BYTES;
  const std::vector<uint8_t> field(
      tx.extra.begin() + pos,
      tx.extra.begin() + pos + cryptonote::CRYLO_TREASURY_PROOF_FIELD_BYTES);
  tx.extra.insert(tx.extra.begin() + pos, field.begin(), field.end());
  tx.invalidate_hashes();
  ASSERT_FALSE(verify_dev(tx));
  ASSERT_FALSE(verify_liquidity(tx));
  ASSERT_FALSE(verify(tx));
}

TEST_F(CryLoMainnetTreasuryProof, DevelopmentProofViewTagTamperRejected)
{
  ASSERT_TRUE(verify_dev(tx));
  auto *target = boost::get<cryptonote::txout_to_tagged_key>(
      &tx.vout[2].target);
  ASSERT_NE(nullptr, target);
  target->view_tag.data ^= 1;
  tx.invalidate_hashes();
  ASSERT_FALSE(verify_dev(tx));
}

TEST_F(CryLoMainnetTreasuryProof, DevelopmentProofReorderedRejected)
{
  ASSERT_TRUE(verify_dev(tx));
  const size_t begin =
      tx.extra.size() - 3 * cryptonote::CRYLO_TREASURY_PROOF_FIELD_BYTES;
  const auto fieldSize = cryptonote::CRYLO_TREASURY_PROOF_FIELD_BYTES;
  std::swap_ranges(
      tx.extra.begin() + begin, tx.extra.begin() + begin + fieldSize,
      tx.extra.begin() + begin + fieldSize);
  tx.invalidate_hashes();
  ASSERT_FALSE(verify_dev(tx));
  ASSERT_FALSE(verify_liquidity(tx));
  ASSERT_FALSE(verify(tx));
}

TEST_F(CryLoMainnetTreasuryProof, DevelopmentProofSharedPointTamperRejected)
{
  ASSERT_TRUE(verify_dev(tx));
  const size_t begin =
      tx.extra.size() - 3 * cryptonote::CRYLO_TREASURY_PROOF_FIELD_BYTES;
  tx.extra[begin + 2] ^= 1;
  tx.invalidate_hashes();
  ASSERT_FALSE(verify_dev(tx));
}

TEST_F(CryLoMainnetTreasuryProof, DifferentBlockHeightRejected)
{
  ASSERT_TRUE(verify(tx));
  ASSERT_FALSE(verify(tx, kHeight + 1));
}

TEST_F(CryLoMainnetTreasuryProof, DifferentTreasuryOutputIndexRejected)
{
  ASSERT_TRUE(verify(tx));
  ASSERT_FALSE(verify(tx, kHeight, kTreasuryOutput - 1));
}

TEST_F(CryLoMainnetTreasuryProof, TreasuryDestinationSubstitutionRejected)
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

TEST_F(CryLoMainnetTreasuryProof, TreasuryViewTagModificationRejected)
{
  auto* destination =
      boost::get<cryptonote::txout_to_tagged_key>(&tx.vout[kTreasuryOutput].target);
  ASSERT_NE(nullptr, destination);
  destination->view_tag.data ^= 1;
  tx.invalidate_hashes();
  ASSERT_FALSE(verify(tx));
}

TEST_F(CryLoMainnetTreasuryProof, TreasuryAmountModificationRejected)
{
  ++tx.vout[kTreasuryOutput].amount;
  tx.invalidate_hashes();
  ASSERT_FALSE(verify(tx));
}

TEST_F(CryLoMainnetTreasuryProof, ValidProofWithWrongTreasuryRecipientRejected)
{
  crypto::public_key view;
  crypto::public_key spend;
  ASSERT_TRUE(configured_treasury_keys(view, spend));

  cryptonote::account_base attacker;
  attacker.generate();
  const auto wrong_spend = attacker.get_keys().m_account_address.m_spend_public_key;

  ASSERT_FALSE(cryptonote::verify_crylo_mainnet_treasury_proof(
      tx, kHeight, view, wrong_spend, kTreasuryOutput));
}

TEST_F(CryLoMainnetTreasuryProof, AlteredProofSignatureRejected)
{
  ASSERT_TRUE(verify(tx));
  tx.extra.back() ^= 1;
  tx.invalidate_hashes();
  ASSERT_FALSE(verify(tx));
}

TEST_F(CryLoMainnetTreasuryProof, MissingProofRejected)
{
  ASSERT_GE(tx.extra.size(), cryptonote::CRYLO_TREASURY_PROOF_FIELD_BYTES);
  tx.extra.resize(
      tx.extra.size() - cryptonote::CRYLO_TREASURY_PROOF_FIELD_BYTES);
  tx.invalidate_hashes();
  ASSERT_FALSE(verify(tx));
}

TEST_F(CryLoMainnetTreasuryProof, DuplicateProofRejected)
{
  ASSERT_TRUE(verify(tx));
  ASSERT_GE(tx.extra.size(), cryptonote::CRYLO_TREASURY_PROOF_FIELD_BYTES);
  const std::vector<uint8_t> proof(
      tx.extra.end() - cryptonote::CRYLO_TREASURY_PROOF_FIELD_BYTES,
      tx.extra.end());
  tx.extra.insert(tx.extra.end(), proof.begin(), proof.end());
  tx.invalidate_hashes();
  ASSERT_FALSE(verify(tx));
}

TEST_F(CryLoMainnetTreasuryProof, WrongProofLengthRejected)
{
  ASSERT_TRUE(verify(tx));
  ASSERT_GE(tx.extra.size(), cryptonote::CRYLO_TREASURY_PROOF_FIELD_BYTES);
  const size_t proof_start =
      tx.extra.size() - cryptonote::CRYLO_TREASURY_PROOF_FIELD_BYTES;
  tx.extra[proof_start + 1] = 95;
  tx.invalidate_hashes();
  ASSERT_FALSE(verify(tx));
}

TEST_F(CryLoMainnetTreasuryProof, ProofTruncationRejected)
{
  ASSERT_TRUE(verify(tx));
  tx.extra.pop_back();
  tx.invalidate_hashes();
  ASSERT_FALSE(verify(tx));
}

TEST_F(CryLoMainnetTreasuryProof, LiquidityIncorrectRecipientRejected)
{
  crypto::public_key view, spend;
  ASSERT_TRUE(epee::string_tools::hex_to_pod(CryLo_LIQUIDITY_FUND_VIEWKEY, view));
  ASSERT_TRUE(epee::string_tools::hex_to_pod(CryLo_LIQUIDITY_FUND_SPENDKEY, spend));
  cryptonote::account_base attacker;
  attacker.generate();
  ASSERT_FALSE(cryptonote::verify_crylo_mainnet_liquidity_proof(
      tx, kHeight, view, attacker.get_keys().m_account_address.m_spend_public_key, 3));
}

TEST_F(CryLoMainnetTreasuryProof, LiquidityOutputSubstitutionRejected)
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

TEST_F(CryLoMainnetTreasuryProof, LiquidityAmountChangeRejected)
{
  ASSERT_TRUE(verify_liquidity(tx));
  ++tx.vout[3].amount;
  tx.invalidate_hashes();
  ASSERT_FALSE(verify_liquidity(tx));
  ASSERT_FALSE(verify(tx));
}

TEST_F(CryLoMainnetTreasuryProof, LiquidityViewTagChangeRejected)
{
  ASSERT_TRUE(verify_liquidity(tx));
  auto* destination =
      boost::get<cryptonote::txout_to_tagged_key>(&tx.vout[3].target);
  ASSERT_NE(nullptr, destination);
  destination->view_tag.data ^= 1;
  tx.invalidate_hashes();
  ASSERT_FALSE(verify_liquidity(tx));
}

TEST_F(CryLoMainnetTreasuryProof, LiquidityWrongHeightRejected)
{
  ASSERT_TRUE(verify_liquidity(tx));
  ASSERT_FALSE(verify_liquidity(tx, kHeight + 1));
}

TEST_F(CryLoMainnetTreasuryProof, LiquidityWrongOutputIndexRejected)
{
  ASSERT_TRUE(verify_liquidity(tx));
  ASSERT_FALSE(verify_liquidity(tx, kHeight, 4));
}

TEST_F(CryLoMainnetTreasuryProof, LiquidityProofSignatureTamperRejected)
{
  ASSERT_TRUE(verify_liquidity(tx));
  ASSERT_GE(tx.extra.size(), 2 * cryptonote::CRYLO_TREASURY_PROOF_FIELD_BYTES);
  const size_t liquidity_start =
      tx.extra.size() - 2 * cryptonote::CRYLO_TREASURY_PROOF_FIELD_BYTES;
  tx.extra[liquidity_start + cryptonote::CRYLO_TREASURY_PROOF_FIELD_BYTES - 1] ^= 1;
  tx.invalidate_hashes();
  ASSERT_FALSE(verify_liquidity(tx));
  ASSERT_FALSE(verify(tx));
}

TEST_F(CryLoMainnetTreasuryProof, MissingLiquidityProofRejected)
{
  ASSERT_TRUE(verify_liquidity(tx));
  ASSERT_GE(tx.extra.size(), 2 * cryptonote::CRYLO_TREASURY_PROOF_FIELD_BYTES);
  const auto start =
      tx.extra.end() - 2 * cryptonote::CRYLO_TREASURY_PROOF_FIELD_BYTES;
  tx.extra.erase(start, start + cryptonote::CRYLO_TREASURY_PROOF_FIELD_BYTES);
  tx.invalidate_hashes();
  ASSERT_FALSE(verify_liquidity(tx));
}

TEST_F(CryLoMainnetTreasuryProof, DuplicateLiquidityProofRejected)
{
  ASSERT_TRUE(verify_liquidity(tx));
  ASSERT_GE(tx.extra.size(), 2 * cryptonote::CRYLO_TREASURY_PROOF_FIELD_BYTES);
  const size_t start =
      tx.extra.size() - 2 * cryptonote::CRYLO_TREASURY_PROOF_FIELD_BYTES;
  const std::vector<uint8_t> copy(
      tx.extra.begin() + start,
      tx.extra.begin() + start + cryptonote::CRYLO_TREASURY_PROOF_FIELD_BYTES);
  tx.extra.insert(tx.extra.begin() + start, copy.begin(), copy.end());
  tx.invalidate_hashes();
  ASSERT_FALSE(verify_liquidity(tx));
  ASSERT_FALSE(verify(tx));
}

TEST_F(CryLoMainnetTreasuryProof, ReversedProofOrderRejected)
{
  ASSERT_TRUE(verify_liquidity(tx));
  ASSERT_TRUE(verify(tx));
  const size_t start =
      tx.extra.size() - 2 * cryptonote::CRYLO_TREASURY_PROOF_FIELD_BYTES;
  const auto first = tx.extra.begin() + start;
  std::swap_ranges(first,
      first + cryptonote::CRYLO_TREASURY_PROOF_FIELD_BYTES,
      first + cryptonote::CRYLO_TREASURY_PROOF_FIELD_BYTES);
  tx.invalidate_hashes();
  ASSERT_FALSE(verify_liquidity(tx));
  ASSERT_FALSE(verify(tx));
}

TEST_F(CryLoMainnetTreasuryProof, MalformedLiquidityProofLengthRejected)
{
  ASSERT_TRUE(verify_liquidity(tx));
  const size_t start =
      tx.extra.size() - 2 * cryptonote::CRYLO_TREASURY_PROOF_FIELD_BYTES;
  tx.extra[start + 1] = 95;
  tx.invalidate_hashes();
  ASSERT_FALSE(verify_liquidity(tx));
}

TEST_F(CryLoMainnetTreasuryProof, LiquidityProofTruncationRejected)
{
  ASSERT_TRUE(verify_liquidity(tx));
  const size_t end_of_liquidity =
      tx.extra.size() - cryptonote::CRYLO_TREASURY_PROOF_FIELD_BYTES;
  tx.extra.erase(tx.extra.begin() + end_of_liquidity - 1);
  tx.invalidate_hashes();
  ASSERT_FALSE(verify_liquidity(tx));
}

TEST(CryLoTestnetTreasuryProof, ExistingTestnetTransactionHasNoMainnetProof)
{
  cryptonote::transaction tx;
  ASSERT_TRUE(build_coinbase(cryptonote::TESTNET, tx));
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
