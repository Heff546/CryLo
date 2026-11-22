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
} // namespace
