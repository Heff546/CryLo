// Copyright (c) 2026 CryLo contributors
// GPL-3.0-or-later
//
// Testnet treasury full-block admission tests on disposable LMDB databases.
// No live network, persisted wallet data, or production fork schedule changes.
#include "gtest/gtest.h"
#include <boost/filesystem.hpp>
#include <memory>
#include <string>
#include <cstdint>
#include <algorithm>
#include <vector>
#include "cryptonote_core/crylo_testnet_gas_treasury_proof.h"
#include "cryptonote_basic/cryptonote_format_utils.h"
#include "cryptonote_basic/account.h"
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
    // Direct Blockchain::add_new_block() does NOT start a write batch.
    // The production incoming-block path prepares an LMDB transaction
    // before admission and commits/aborts it in cleanup. Omitting this
    // caused SIGSEGV in BlockchainLMDB::add_transaction_data.
    const size_t block_bytes = cryptonote::block_to_blob(candidate).size();
    chain.prepare_handle_incoming_block_no_preprocess(block_bytes);
    const bool admitted = chain.add_new_block(candidate, bvc);
    const bool cleaned = chain.cleanup_handle_incoming_blocks();
    ASSERT_TRUE(cleaned) << "LMDB write-batch cleanup failed";
    ASSERT_TRUE(admitted) << "Full block admission returned false";
    EXPECT_TRUE(bvc.m_added_to_main_chain);
    EXPECT_FALSE(bvc.m_verifivation_failed);
    EXPECT_EQ(height + 1, chain.get_current_blockchain_height());
    EXPECT_EQ(cryptonote::TESTNET, chain.m_nettype);
  }

  ASSERT_TRUE(chain.deinit());
}

TEST(CryLoTestnetV21AdmissionFoundation, RejectsRedirectedTreasuryOutputsInCompleteV21Blocks) {
  // Each recipient attack gets a fresh chain. An invalid block must be
  // rejected AND the original valid v21 candidate must still be accepted.
  for (const size_t recipient_index : {size_t{2}, size_t{3}, size_t{4}}) {
    SCOPED_TRACE(::testing::Message() << "recipient index " << recipient_index);
    TemporaryTestnetDB tmp;
    cryptonote::core core(nullptr);
    auto db = std::make_unique<cryptonote::BlockchainLMDB>();
    ASSERT_NO_THROW(db->open(tmp.path.string()));
    ASSERT_TRUE(db->is_open());

    cryptonote::Blockchain &chain = core.get_blockchain_storage();
    ASSERT_TRUE(chain.init(db.release(), cryptonote::TESTNET, true, nullptr, 1));
    ASSERT_EQ(cryptonote::TESTNET, chain.m_nettype);

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

    cryptonote::account_base miner;
    miner.generate();
    const auto make_template = [&](cryptonote::block& block,
                                   uint64_t& height) {
      cryptonote::difficulty_type difficulty = 0;
      uint64_t expected_reward = 0, seed_height = 0;
      crypto::hash seed_hash = crypto::null_hash;
      const bool result = chain.create_block_template(
          block, miner.get_keys().m_account_address, difficulty, height,
          expected_reward, cryptonote::blobdata{}, seed_height, seed_hash);
      EXPECT_EQ(1u, difficulty);
      return result;
    };
    const auto submit = [&](const cryptonote::block& block,
                            cryptonote::block_verification_context& bvc) {
      const size_t bytes = cryptonote::block_to_blob(block).size();
      chain.prepare_handle_incoming_block_no_preprocess(bytes);
      const bool admitted = chain.add_new_block(block, bvc);
      EXPECT_TRUE(chain.cleanup_handle_incoming_blocks());
      return admitted;
    };

    cryptonote::block legacy{};
    uint64_t height = 0;
    ASSERT_TRUE(make_template(legacy, height));
    ASSERT_EQ(1u, height);
    ASSERT_EQ(20u, legacy.major_version);
    cryptonote::block_verification_context bvc20{};
    ASSERT_TRUE(submit(legacy, bvc20));
    ASSERT_TRUE(bvc20.m_added_to_main_chain);
    ASSERT_EQ(2u, chain.get_current_blockchain_height());
    ASSERT_EQ(HF_VERSION_TESTNET_TREASURY_PROOFS,
              chain.get_current_hard_fork_version());

    cryptonote::block legitimate{};
    ASSERT_TRUE(make_template(legitimate, height));
    ASSERT_EQ(2u, height);
    ASSERT_EQ(HF_VERSION_TESTNET_TREASURY_PROOFS, legitimate.major_version);
    ASSERT_EQ(5u, legitimate.miner_tx.vout.size());

    cryptonote::block redirected = legitimate;
    cryptonote::account_base attacker;
    attacker.generate();
    auto* target = boost::get<cryptonote::txout_to_tagged_key>(
        &redirected.miner_tx.vout.at(recipient_index).target);
    ASSERT_NE(nullptr, target);
    target->key = attacker.get_keys().m_account_address.m_spend_public_key;
    redirected.miner_tx.invalidate_hashes();
    ASSERT_NE(cryptonote::get_block_hash(legitimate),
              cryptonote::get_block_hash(redirected));

    cryptonote::block_verification_context rejected{};
    EXPECT_FALSE(submit(redirected, rejected));
    EXPECT_TRUE(rejected.m_verifivation_failed);
    EXPECT_FALSE(rejected.m_added_to_main_chain);
    EXPECT_EQ(2u, chain.get_current_blockchain_height());

    // Positive control on the same chain: proving rejection is not merely
    // a stale hardfork version, broken PoW, or failed LMDB write transaction.
    cryptonote::block_verification_context accepted{};
    ASSERT_TRUE(submit(legitimate, accepted));
    EXPECT_TRUE(accepted.m_added_to_main_chain);
    EXPECT_FALSE(accepted.m_verifivation_failed);
    EXPECT_EQ(3u, chain.get_current_blockchain_height());
    EXPECT_EQ(cryptonote::TESTNET, chain.m_nettype);
    ASSERT_TRUE(chain.deinit());
  }
}

TEST(CryLoTestnetV21AdmissionFoundation, RejectsMalformedProofsInCompleteV21Blocks) {
  constexpr size_t n = cryptonote::CRYLO_TESTNET_TREASURY_PROOF_FIELD_BYTES;
  // Separate disposable databases ensure no rejected candidate contaminates
  // the next case. A valid v21 positive control follows every rejection.
  for (int variant = 0; variant < 9; ++variant) {
    SCOPED_TRACE(::testing::Message() << "malformed proof variant " << variant);
    TemporaryTestnetDB tmp;
    cryptonote::core core(nullptr);
    auto db = std::make_unique<cryptonote::BlockchainLMDB>();
    ASSERT_NO_THROW(db->open(tmp.path.string()));
    ASSERT_TRUE(db->is_open());
    cryptonote::Blockchain& chain = core.get_blockchain_storage();
    ASSERT_TRUE(chain.init(db.release(), cryptonote::TESTNET, true, nullptr, 1));
    ASSERT_EQ(cryptonote::TESTNET, chain.m_nettype);

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

    cryptonote::account_base miner;
    miner.generate();
    const auto make_template = [&](cryptonote::block& block, uint64_t& height) {
      cryptonote::difficulty_type difficulty = 0;
      uint64_t expected_reward = 0, seed_height = 0;
      crypto::hash seed_hash = crypto::null_hash;
      const bool result = chain.create_block_template(
          block, miner.get_keys().m_account_address, difficulty, height,
          expected_reward, cryptonote::blobdata{}, seed_height, seed_hash);
      EXPECT_EQ(1u, difficulty);
      return result;
    };
    const auto submit = [&](const cryptonote::block& block,
                            cryptonote::block_verification_context& bvc) {
      chain.prepare_handle_incoming_block_no_preprocess(
          cryptonote::block_to_blob(block).size());
      const bool admitted = chain.add_new_block(block, bvc);
      EXPECT_TRUE(chain.cleanup_handle_incoming_blocks());
      return admitted;
    };

    cryptonote::block legacy{};
    uint64_t height = 0;
    ASSERT_TRUE(make_template(legacy, height));
    ASSERT_EQ(1u, height);
    ASSERT_EQ(20u, legacy.major_version);
    cryptonote::block_verification_context first{};
    ASSERT_TRUE(submit(legacy, first));
    ASSERT_TRUE(first.m_added_to_main_chain);
    ASSERT_EQ(2u, chain.get_current_blockchain_height());
    ASSERT_EQ(HF_VERSION_TESTNET_TREASURY_PROOFS,
              chain.get_current_hard_fork_version());

    cryptonote::block valid{};
    ASSERT_TRUE(make_template(valid, height));
    ASSERT_EQ(2u, height);
    ASSERT_EQ(HF_VERSION_TESTNET_TREASURY_PROOFS, valid.major_version);
    ASSERT_GE(valid.miner_tx.extra.size(), 3 * n);
    cryptonote::block invalid = valid;
    auto& extra = invalid.miner_tx.extra;
    const size_t start = extra.size() - 3 * n;
    switch (variant) {
      case 0: // remove Development proof
        extra.erase(extra.begin() + start, extra.begin() + start + n);
        break;
      case 1: // remove Liquidity proof
        extra.erase(extra.begin() + start + n, extra.begin() + start + 2 * n);
        break;
      case 2: // remove Gas proof
        extra.resize(extra.size() - n);
        break;
      case 3: // duplicate last proof
        extra.insert(extra.end(), extra.end() - n, extra.end());
        break;
      case 4: // swap proof order
        std::swap_ranges(extra.begin() + start,
                         extra.begin() + start + n,
                         extra.begin() + start + n);
        break;
      case 5: // corrupt Liquidity signature
        extra[start + n + 2 + sizeof(crypto::public_key)] ^= 0x01;
        break;
      case 6: // corrupt Development shared point
        extra[start + 2] ^= 0x01;
        break;
      case 7: // append unsigned trailing byte
        extra.push_back(0x00);
        break;
      case 8: { // change signed coinbase generation height
        auto* generation =
            boost::get<cryptonote::txin_gen>(&invalid.miner_tx.vin.at(0));
        ASSERT_NE(nullptr, generation);
        ++generation->height;
        break;
      }
    }
    invalid.miner_tx.invalidate_hashes();
    ASSERT_NE(cryptonote::get_block_hash(valid),
              cryptonote::get_block_hash(invalid));
    cryptonote::block_verification_context rejected{};
    EXPECT_FALSE(submit(invalid, rejected));
    EXPECT_TRUE(rejected.m_verifivation_failed);
    EXPECT_FALSE(rejected.m_added_to_main_chain);
    EXPECT_EQ(2u, chain.get_current_blockchain_height());

    cryptonote::block_verification_context accepted{};
    ASSERT_TRUE(submit(valid, accepted));
    EXPECT_TRUE(accepted.m_added_to_main_chain);
    EXPECT_FALSE(accepted.m_verifivation_failed);
    EXPECT_EQ(3u, chain.get_current_blockchain_height());
    ASSERT_TRUE(chain.deinit());
  }
}
} // namespace
