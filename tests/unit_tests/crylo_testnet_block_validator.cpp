// Copyright (c) 2026 CryLo contributors
// GPL-3.0-or-later
//
// Directly exercise the production Blockchain::prevalidate_miner_transaction
// and Blockchain::validate_miner_transaction code with TESTNET identity and
// an in-memory fake DB. This is not a full add_new_block()/PoW admission test.
// No historical chain files, private wallet keys, network, or services used.

#include "gtest/gtest.h"

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <vector>

#include "cryptonote_config.h"
#include "cryptonote_basic/account.h"
#include "cryptonote_basic/cryptonote_basic.h"
#include "cryptonote_core/cryptonote_tx_utils.h"
#include "cryptonote_core/crylo_testnet_gas_treasury_proof.h"
#include "blockchain_db/testdb.h"

// Blockchain deliberately exposes its internals only to native unit tests;
// this changes C++ access declarations in this test translation unit only.
// The linked production cryptonote_core object code is unchanged.
#define IN_UNIT_TESTS
#include "cryptonote_core/cryptonote_core.h"
#undef IN_UNIT_TESTS

namespace
{
  constexpr uint64_t kHeight = 2;
  constexpr uint64_t kAlreadyGeneratedCoins = 0;
  constexpr size_t kMedianWeight = 300000;
  constexpr size_t kBlockWeight = 1000;
  constexpr uint8_t kFutureVersion = HF_VERSION_TESTNET_TREASURY_PROOFS;
  constexpr uint8_t kLegacyVersion = HF_VERSION_VIEW_TAGS;

  struct InMemoryTestnetDB final : public cryptonote::BaseTestDB
  {
    uint64_t height() const override { return kHeight; }
  };

  class CryLoTestnetV21BlockValidator : public ::testing::Test
  {
  protected:
    cryptonote::core core_{nullptr};
    cryptonote::account_base miner_;
    cryptonote::block block_{};

    void SetUp() override
    {
      // The core is never initialized as a daemon. We attach one TestDB
      // solely to the Blockchain validator used in this fixture.
      cryptonote::Blockchain &chain = core_.get_blockchain_storage();
      chain.m_db = new InMemoryTestnetDB();
      chain.m_nettype = cryptonote::TESTNET;
      chain.m_current_block_cumul_weight_median = kMedianWeight;
      miner_.generate();
    }

    cryptonote::Blockchain& chain()
    {
      return core_.get_blockchain_storage();
    }

    bool construct(uint8_t version = kFutureVersion)
    {
      block_ = cryptonote::block{};
      block_.major_version = version;
      block_.minor_version = version;
      return cryptonote::construct_miner_tx(
          nullptr,
          cryptonote::TESTNET,
          kHeight,
          kMedianWeight,
          kAlreadyGeneratedCoins,
          kBlockWeight,
          0,
          miner_.get_keys().m_account_address,
          block_.miner_tx,
          cryptonote::blobdata{},
          5,
          version);
    }

    bool validate(uint8_t version = kFutureVersion)
    {
      uint64_t base_reward = 0;
      bool partial_block_reward = false;
      // This calls the ACTUAL linked Blockchain consensus implementation,
      // not a duplicated proof helper or a source-string assertion.
      return chain().validate_miner_transaction(
          block_,
          kBlockWeight,
          0,
          base_reward,
          kAlreadyGeneratedCoins,
          partial_block_reward,
          version);
    }

    void replace_recipient(size_t index)
    {
      cryptonote::account_base attacker;
      attacker.generate();
      auto* output = boost::get<cryptonote::txout_to_tagged_key>(
          &block_.miner_tx.vout.at(index).target);
      ASSERT_NE(nullptr, output);
      output->key = attacker.get_keys().m_account_address.m_spend_public_key;
      block_.miner_tx.invalidate_hashes();
    }
  };
}  // namespace

TEST_F(CryLoTestnetV21BlockValidator, ValidV21CoinbaseAcceptedByConsensusValidator)
{
  ASSERT_TRUE(construct());
  ASSERT_TRUE(chain().prevalidate_miner_transaction(
      block_, kHeight, kFutureVersion));
  EXPECT_TRUE(validate());
}

TEST_F(CryLoTestnetV21BlockValidator, RedirectedDevelopmentOutputRejected)
{
  ASSERT_TRUE(construct());
  replace_recipient(2);
  EXPECT_FALSE(validate());
}

TEST_F(CryLoTestnetV21BlockValidator, RedirectedLiquidityOutputRejected)
{
  ASSERT_TRUE(construct());
  replace_recipient(3);
  EXPECT_FALSE(validate());
}

TEST_F(CryLoTestnetV21BlockValidator, RedirectedGasTreasuryOutputRejected)
{
  ASSERT_TRUE(construct());
  replace_recipient(4);
  EXPECT_FALSE(validate());
}

TEST_F(CryLoTestnetV21BlockValidator, TamperedTreasuryAmountRejected)
{
  ASSERT_TRUE(construct());
  ++block_.miner_tx.vout[4].amount;
  block_.miner_tx.invalidate_hashes();
  EXPECT_FALSE(validate());
}

TEST_F(CryLoTestnetV21BlockValidator, MissingGasProofRejected)
{
  ASSERT_TRUE(construct());
  const size_t bytes = cryptonote::CRYLO_TESTNET_TREASURY_PROOF_FIELD_BYTES;
  ASSERT_GE(block_.miner_tx.extra.size(), bytes);
  block_.miner_tx.extra.resize(block_.miner_tx.extra.size() - bytes);
  block_.miner_tx.invalidate_hashes();
  EXPECT_FALSE(validate());
}

TEST_F(CryLoTestnetV21BlockValidator, ReorderedProofsRejected)
{
  ASSERT_TRUE(construct());
  const size_t n = cryptonote::CRYLO_TESTNET_TREASURY_PROOF_FIELD_BYTES;
  ASSERT_GE(block_.miner_tx.extra.size(), 3 * n);
  const size_t offset = block_.miner_tx.extra.size() - 3 * n;
  std::swap_ranges(block_.miner_tx.extra.begin() + offset,
                   block_.miner_tx.extra.begin() + offset + n,
                   block_.miner_tx.extra.begin() + offset + n);
  block_.miner_tx.invalidate_hashes();
  EXPECT_FALSE(validate());
}

TEST_F(CryLoTestnetV21BlockValidator, WrongGenesisHeightForSignedProofRejected)
{
  ASSERT_TRUE(construct());
  // The height in txin_gen is part of the signed transaction prefix.
  auto* generation = boost::get<cryptonote::txin_gen>(&block_.miner_tx.vin.at(0));
  ASSERT_NE(nullptr, generation);
  ++generation->height;
  block_.miner_tx.invalidate_hashes();
  EXPECT_FALSE(validate());
}

TEST_F(CryLoTestnetV21BlockValidator, LegacyV20CoinbaseAcceptedWithoutProofs)
{
  ASSERT_TRUE(construct(kLegacyVersion));
  EXPECT_TRUE(chain().prevalidate_miner_transaction(block_, kHeight, kLegacyVersion));
  EXPECT_TRUE(validate(kLegacyVersion));
}

TEST_F(CryLoTestnetV21BlockValidator, LegacyV20RecipientGapStillRequiresFutureFork)
{
  ASSERT_TRUE(construct(kLegacyVersion));
  replace_recipient(3);
  // This is the documented historical V4 weakness. Changing this
  // assertion would silently rewrite the meaning of already-mined blocks.
  EXPECT_TRUE(validate(kLegacyVersion));
}
