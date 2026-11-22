// Copyright (c) 2026 CryLo contributors
// GPL-3.0-or-later
//
// Isolated precursor to Testnet v21 treasury full-block admission tests.
// Uses a fresh disposable LMDB database and the real Testnet genesis.
// Does NOT simulate v21 or certify treasury full-block acceptance.
#include "gtest/gtest.h"
#include <boost/filesystem.hpp>
#include <memory>
#include <string>
#include "blockchain_db/lmdb/db_lmdb.h"
#define IN_UNIT_TESTS
#include "cryptonote_core/cryptonote_core.h"
#undef IN_UNIT_TESTS
#include "cryptonote_config.h"
#include "cryptonote_basic/hardfork.h"

namespace {
struct TemporaryTestnetDB {
  boost::filesystem::path path =
      boost::filesystem::temp_directory_path() /
      boost::filesystem::unique_path("crylo-treasury-testnet-%%%%%%%%");
  TemporaryTestnetDB() { boost::filesystem::create_directories(path); }
  ~TemporaryTestnetDB() {
    boost::system::error_code ignored;
    boost::filesystem::remove_all(path, ignored);
  }
};

TEST(CryLoTestnetV21AdmissionFoundation, RealTestnetGenesisInDisposableLMDB) {
  TemporaryTestnetDB tmp;
  cryptonote::core core(nullptr);
  auto db = std::make_unique<cryptonote::BlockchainLMDB>();
  ASSERT_NO_THROW(db->open(tmp.path.string()));
  ASSERT_TRUE(db->is_open());

  // CRITICAL: supplying test_options would switch Blockchain::init to
  // FAKECHAIN, where the TESTNET-only recipient-proof checks do not run.
  // Never use test_options for a supposed Testnet admission proof.
  cryptonote::Blockchain &chain = core.get_blockchain_storage();
  ASSERT_TRUE(chain.init(db.release(), cryptonote::TESTNET,
                         true /* offline */, nullptr /* no FAKECHAIN */,
                         1 /* fixed difficulty, test only */));
  EXPECT_EQ(1u, chain.get_current_blockchain_height());
  EXPECT_EQ(cryptonote::TESTNET, chain.m_nettype);
  EXPECT_EQ(17u, chain.get_current_hard_fork_version());

  ASSERT_TRUE(chain.deinit());
}

TEST(CryLoTestnetV21AdmissionFoundation, FutureForkIsLocalAndPreservesCurrentSchedule) {
  TemporaryTestnetDB tmp;
  cryptonote::core core(nullptr);
  auto db = std::make_unique<cryptonote::BlockchainLMDB>();
  ASSERT_NO_THROW(db->open(tmp.path.string()));
  ASSERT_TRUE(db->is_open());

  cryptonote::Blockchain &chain = core.get_blockchain_storage();
  ASSERT_TRUE(chain.init(db.release(), cryptonote::TESTNET, true, nullptr, 1));
  ASSERT_EQ(cryptonote::TESTNET, chain.m_nettype);
  ASSERT_EQ(20u, chain.get_ideal_hard_fork_version(2100));

  // Test-only mutation of this in-memory HardFork instance. Nothing changes
  // the compiled hardfork table, live chain, or production configuration.
  ASSERT_TRUE(chain.m_hardfork->add_fork(
      HF_VERSION_TESTNET_TREASURY_PROOFS, 2101, 1, 1739739601));
  EXPECT_EQ(20u, chain.get_ideal_hard_fork_version(2100));
  EXPECT_EQ(HF_VERSION_TESTNET_TREASURY_PROOFS,
            chain.get_ideal_hard_fork_version(2101));
  EXPECT_EQ(cryptonote::TESTNET, chain.m_nettype);

  ASSERT_TRUE(chain.deinit());
}

TEST(CryLoTestnetV21AdmissionFoundation, AcceptsCompleteV20ThenV21Blocks) {
  TemporaryTestnetDB tmp;
  cryptonote::core core(nullptr);
  auto db = std::make_unique<cryptonote::BlockchainLMDB>();
  ASSERT_NO_THROW(db->open(tmp.path.string()));
  ASSERT_TRUE(db->is_open());

  cryptonote::Blockchain &chain = core.get_blockchain_storage();
  ASSERT_TRUE(chain.init(db.release(), cryptonote::TESTNET, true, nullptr,
                         1 /* fixed PoW difficulty, isolated test only */));
  ASSERT_EQ(cryptonote::TESTNET, chain.m_nettype);
  ASSERT_EQ(1u, chain.get_current_blockchain_height());

  // Replace only this disposable chain's fork object. The actual Testnet
  // schedule and all production binaries remain unchanged. The 0% threshold
  // eliminates test-only activation votes; v20 starts at 1 and v21 at 2.
  auto* replacement = new cryptonote::HardFork(*chain.m_db, 17, 0);
  ASSERT_TRUE(replacement->add_fork(17, 0, 0, 1700000000));
  ASSERT_TRUE(replacement->add_fork(20, 1, 0, 1700000001));
  ASSERT_TRUE(replacement->add_fork(HF_VERSION_TESTNET_TREASURY_PROOFS,
                                    2, 0, 1700000002));
  auto* previous = chain.m_hardfork;
  chain.m_hardfork = replacement;
  chain.m_db->set_hard_fork(replacement);
  delete previous;
  replacement->init();

  ASSERT_EQ(20u, chain.get_current_hard_fork_version());
  ASSERT_EQ(HF_VERSION_TESTNET_TREASURY_PROOFS,
            chain.get_ideal_hard_fork_version(2));

  cryptonote::account_base miner;
  miner.generate();
  for (const uint8_t version : {uint8_t{20}, uint8_t{HF_VERSION_TESTNET_TREASURY_PROOFS}}) {
    cryptonote::block candidate{};
    cryptonote::difficulty_type difficulty = 0;
    uint64_t height = 0, expected_reward = 0, seed_height = 0;
    crypto::hash seed_hash = crypto::null_hash;
    ASSERT_TRUE(chain.create_block_template(
        candidate, miner.get_keys().m_account_address, difficulty,
        height, expected_reward, cryptonote::blobdata{},
        seed_height, seed_hash));
    ASSERT_EQ(version == 20 ? 1u : 2u, height);
    ASSERT_EQ(version, candidate.major_version);
    ASSERT_EQ(1u, difficulty);
    cryptonote::block_verification_context bvc{};
    ASSERT_TRUE(chain.add_new_block(candidate, bvc));
    EXPECT_TRUE(bvc.m_added_to_main_chain);
    EXPECT_FALSE(bvc.m_verifivation_failed);
    EXPECT_EQ(height + 1, chain.get_current_blockchain_height());
    EXPECT_EQ(cryptonote::TESTNET, chain.m_nettype);
  }

  ASSERT_TRUE(chain.deinit());
}
} // namespace
