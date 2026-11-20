// Copyright (c) 2026 CryLo contributors
// Distributed under the GNU General Public License v3.0.
//
// OFFLINE ONLY: exercises actual MAINNET core/blockchain verification
// against a new ephemeral LMDB, not the FAKECHAIN replay test harness.
// No networking, wallet files, production secrets, or existing chain data.

#include <exception>
#include <iostream>
#include <string>
#include <vector>

#include <boost/filesystem.hpp>
#include <boost/program_options.hpp>
#include <boost/variant/get.hpp>

#include "common/util.h"
#include "cryptonote_basic/account.h"
#include "cryptonote_basic/cryptonote_format_utils.h"
#include "cryptonote_core/cryptonote_core.h"
#include "cryptonote_core/crylo_gas_treasury_proof.h"
#include "cryptonote_core/crylo_liquidity_proof.h"
#include "string_tools.h"

namespace
{
namespace fs = boost::filesystem;
namespace po = boost::program_options;

bool reject(const std::string& reason)
{
  std::cerr << "FAIL " << reason << std::endl;
  return false;
}

struct isolated_mainnet
{
  fs::path data_dir;
  cryptonote::core chain{nullptr};
  bool initialized = false;

  isolated_mainnet()
      : data_dir(fs::temp_directory_path() /
          fs::unique_path("crylo-mainnet-consensus-%%%%-%%%%-%%%%"))
  {
  }

  ~isolated_mainnet()
  {
    if (initialized)
      chain.deinit();
    boost::system::error_code error;
    fs::remove_all(data_dir, error);
    if (error)
      std::cerr << "WARN temporary consensus DB cleanup failed: "
                << error.message() << std::endl;
  }

  bool init()
  {
    po::options_description options("Isolated mainnet consensus test");
    cryptonote::core::init_options(options);
    // Explicit MAINNET, never FAKECHAIN. Offline fixed-difficulty is
    // exclusively for ephemeral local consensus testing.
    const std::vector<std::string> args{
      "--mainnet",
      "--offline",
      "--disable-dns-checkpoints",
      "--check-updates=disabled",
      "--fixed-difficulty=1",
      "--data-dir=" + data_dir.string()
    };
    po::variables_map vm;
    po::store(po::command_line_parser(args).options(options).run(), vm);
    po::notify(vm);
    if (!chain.init(vm, nullptr, nullptr, false))
      return reject("actual MAINNET core initialization");
    initialized = true;
    if (chain.get_current_blockchain_height() != 1)
      return reject("MAINNET genesis database should have exactly one block");
    std::cout << "PASS Actual MAINNET genesis created in isolated offline DB" << std::endl;
    return true;
  }
};

bool submit_block(cryptonote::core& chain, const cryptonote::block& candidate)
{
  cryptonote::block_verification_context context{};
  cryptonote::pool_supplement extra{};
  const cryptonote::blobdata blob =
      cryptonote::t_serializable_object_to_blob(candidate);
  const bool handled =
      chain.handle_single_incoming_block(blob, &candidate, context, extra, false);
  return handled && context.m_added_to_main_chain && !context.m_verifivation_failed;
}

bool get_template(cryptonote::core& chain,
                  const cryptonote::account_base& miner,
                  cryptonote::block& template_block,
                  uint64_t expected_height)
{
  cryptonote::difficulty_type difficulty = 0;
  uint64_t height = 0;
  uint64_t reward = 0;
  uint64_t seed_height = 0;
  crypto::hash seed_hash = crypto::null_hash;
  if (!chain.get_block_template(
          template_block, miner.get_keys().m_account_address, difficulty,
          height, reward, cryptonote::blobdata(), seed_height, seed_hash))
    return reject("MAINNET block template generation at height " +
                  std::to_string(expected_height));
  if (height != expected_height || difficulty != 1)
    return reject("Unexpected height or offline fixed test difficulty");
  return true;
}

bool proofs_verify(const cryptonote::block& candidate)
{
  crypto::public_key liq_view, liq_spend, gas_view, gas_spend;
  if (!epee::string_tools::hex_to_pod(CryLo_LIQUIDITY_FUND_VIEWKEY, liq_view) ||
      !epee::string_tools::hex_to_pod(CryLo_LIQUIDITY_FUND_SPENDKEY, liq_spend) ||
      !epee::string_tools::hex_to_pod(CryLo_GAS_TREASURY_VIEWKEY, gas_view) ||
      !epee::string_tools::hex_to_pod(CryLo_GAS_TREASURY_SPENDKEY, gas_spend))
    return false;
  return cryptonote::verify_crylo_mainnet_liquidity_proof(
             candidate.miner_tx, 2, liq_view, liq_spend, 3) &&
         cryptonote::verify_crylo_mainnet_treasury_proof(
             candidate.miner_tx, 2, gas_view, gas_spend, 4);
}

bool run()
{
  isolated_mainnet test;
  if (!test.init())
    return false;

  cryptonote::account_base miner;
  miner.generate();

  cryptonote::block first;
  if (!get_template(test.chain, miner, first, 1))
    return false;
  if (first.major_version != 17)
    return reject("Mainnet height 1 must use v17");
  // Vote to activate the configured mainnet v21 fork at height 2.
  first.minor_version = 21;
  if (!submit_block(test.chain, first))
    return reject("Actual MAINNET consensus rejected valid v17 height-1 block");
  if (test.chain.get_current_blockchain_height() != 2)
    return reject("Expected MAINNET chain height 2 after v17 block");
  std::cout << "PASS Valid mainnet pre-fork block accepted at height 1" << std::endl;

  cryptonote::block second;
  if (!get_template(test.chain, miner, second, 2))
    return false;
  if (second.major_version != 21 || second.miner_tx.vout.size() != 5)
    return reject("Mainnet height 2 must activate v21 with five outputs");
  if (!proofs_verify(second))
    return reject("Mainnet block template has malformed public Liquidity/Gas proofs");
  std::cout << "PASS v21 block template has valid dual public recipient proofs" << std::endl;

  // Fee, extra-nonce and block-weight convergence can change tx.extra size.
  // Verify different canonical nonce lengths still leave the two proof
  // fields at the end and maintain valid DLEQ recipient authentication.
  cryptonote::block nonce_128_block;
  bool have_nonce_128_block = false;
  for (const size_t nonce_size : {
       size_t(1), size_t(16), size_t(64), size_t(127),
       size_t(128), size_t(240)})
  {
    cryptonote::block with_nonce;
    cryptonote::difficulty_type nonce_difficulty = 0;
    uint64_t nonce_height = 0, nonce_reward = 0, seed_height = 0;
    crypto::hash nonce_seed_hash = crypto::null_hash;
    if (!test.chain.get_block_template(
            with_nonce, miner.get_keys().m_account_address,
            nonce_difficulty, nonce_height, nonce_reward,
            cryptonote::blobdata(nonce_size, 'N'), seed_height,
            nonce_seed_hash))
      return reject("Unable to create v21 template for nonce size " +
                    std::to_string(nonce_size));
    if (nonce_height != 2 || nonce_difficulty != 1 ||
        with_nonce.miner_tx.vout.size() != 5 || !proofs_verify(with_nonce))
      return reject("Invalid v21 canonical dual proof with nonce size " +
                    std::to_string(nonce_size));

    // The 127/128-byte boundary is especially important: tx.extra nonces
    // must use the canonical serialized length (not the old one-byte
    // length), and the parser must recover the complete nonce payload.
    std::vector<cryptonote::tx_extra_field> parsed;
    cryptonote::tx_extra_nonce decoded_nonce{};
    if (!cryptonote::parse_tx_extra(with_nonce.miner_tx.extra, parsed) ||
        !cryptonote::find_tx_extra_field_by_type(parsed, decoded_nonce) ||
        decoded_nonce.nonce.size() < nonce_size ||
        decoded_nonce.nonce.compare(
            0, nonce_size, std::string(nonce_size, 'N')) != 0)
      return reject("Mainnet coinbase nonce round-trip failed for size " +
                    std::to_string(nonce_size));
    for (size_t j = nonce_size; j < decoded_nonce.nonce.size(); ++j)
      if (decoded_nonce.nonce[j] != '\0')
        return reject("Unexpected nonzero mainnet coinbase padding");
    if (nonce_size == 128)
    {
      nonce_128_block = with_nonce;
      have_nonce_128_block = true;
    }
  }
  if (!have_nonce_128_block)
    return reject("Did not capture 128-byte nonce block template");
  std::cout << "PASS Six nonce-length mainnet block templates preserve both proofs"
            << std::endl;

  // A malicious miner can use their own transaction key but must still
  // pay the official recipients. A substituted Liquidity/Gas output
  // must fail full block admission, even when amounts remain unchanged.
  cryptonote::account_base attacker;
  attacker.generate();
  for (size_t index : {size_t(3), size_t(4)})
  {
    cryptonote::block invalid = second;
    auto *destination =
        boost::get<cryptonote::txout_to_tagged_key>(
            &invalid.miner_tx.vout[index].target);
    if (destination == nullptr)
      return reject("Mainnet v21 output must be view-tagged");
    destination->key =
        attacker.get_keys().m_account_address.m_spend_public_key;
    invalid.miner_tx.invalidate_hashes();
    if (submit_block(test.chain, invalid))
      return reject("MAINNET ACCEPTED redirected payout index " +
                    std::to_string(index));
    if (test.chain.get_current_blockchain_height() != 2)
      return reject("Rejected malicious block advanced chain state");
    std::cout << "PASS Mainnet consensus rejected redirected output "
              << index << std::endl;
  }

  if (!submit_block(test.chain, nonce_128_block))
    return reject("Actual MAINNET consensus rejected v21 dual-proof 128-byte nonce block");
  if (test.chain.get_current_blockchain_height() != 3)
    return reject("Expected mainnet height 3 after valid v21 block");
  std::cout << "PASS Valid 128-byte nonce v21 dual-proof block accepted by MAINNET consensus"
            << std::endl;
  return true;
}
}  // namespace

int main(int argc, char** argv)
{
  (void)argc;
  try
  {
    tools::on_startup();
    epee::string_tools::set_module_name_and_folder(argv[0]);
    std::cout << "===== OFFLINE REAL-MAINNET CONSENSUS TEST =====" << std::endl;
    const bool result = run();
    std::cout << (result ? "RESULT: REAL MAINNET BLOCK CHECKS PASSED" :
                             "RESULT: REAL MAINNET BLOCK CHECKS FAILED")
              << std::endl;
    return result ? 0 : 1;
  }
  catch (const std::exception& ex)
  {
    std::cerr << "FAIL Exception: " << ex.what() << std::endl;
    return 1;
  }
}
