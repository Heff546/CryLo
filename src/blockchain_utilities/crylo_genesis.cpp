#include <iostream>
#include <fstream>
#include <string>
#include <ctime>

#include "common/util.h"
#include "common/command_line.h"
#include "common/scoped_message_writer.h"
#include "cryptonote_basic/cryptonote_format_utils.h"
#include "cryptonote_basic/cryptonote_basic_impl.h"
#include "cryptonote_config.h"
#include "cryptonote_core/cryptonote_tx_utils.h"
#include "crypto/hash.h"
#include "string_tools.h"
#include "version.h"

namespace
{
  std::string now_utc()
  {
    std::time_t t = std::time(nullptr);
    char buf[64];
    std::strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", std::gmtime(&t));
    return std::string(buf);
  }

  std::string shell(const char *cmd)
  {
    FILE *pipe = popen(cmd, "r");
    if (!pipe) return "";
    char buffer[256];
    std::string result;
    while (fgets(buffer, sizeof(buffer), pipe) != nullptr)
      result += buffer;
    pclose(pipe);
    while (!result.empty() && (result.back() == '\n' || result.back() == '\r'))
      result.pop_back();
    return result;
  }

  void usage(const char *argv0)
  {
    std::cerr
      << "CryLo development-only genesis generator\n\n"
      << "Usage:\n"
      << "  " << argv0 << " --testnet --address <CryLoAddress> [--out genesis-report.json]\n\n"
      << "Notes:\n"
      << "  - Development/release engineering tool only.\n"
      << "  - Does not run the daemon.\n"
      << "  - Generates values to place in cryptonote_config.h.\n";
  }
}

int main(int argc, char **argv)
{
  bool testnet = false;
  bool mainnet = false;
  std::string address;
  std::string out = "crylo-genesis-report.json";

  for (int i = 1; i < argc; ++i)
  {
    std::string arg = argv[i];

    if (arg == "--testnet")
    {
      testnet = true;
    }
    else if (arg == "--mainnet")
    {
      mainnet = true;
    }
    else if (arg == "--address" && i + 1 < argc)
    {
      address = argv[++i];
    }
    else if (arg == "--out" && i + 1 < argc)
    {
      out = argv[++i];
    }
    else if (arg == "--help" || arg == "-h")
    {
      usage(argv[0]);
      return 0;
    }
    else
    {
      std::cerr << "Unknown or incomplete argument: " << arg << "\n";
      usage(argv[0]);
      return 1;
    }
  }

  if (mainnet == testnet)
  {
    std::cerr << "Choose exactly one network: --mainnet or --testnet\n";
    usage(argv[0]);
    return 1;
  }

  if (address.empty())
  {
    std::cerr << "--address is required\n";
    usage(argv[0]);
    return 1;
  }

  cryptonote::network_type nettype = testnet ? cryptonote::TESTNET : cryptonote::MAINNET;

  cryptonote::address_parse_info info;
  if (!cryptonote::get_account_address_from_str(info, nettype, address))
  {
    std::cerr << "Failed to parse CryLo address for selected network.\n";
    return 1;
  }

  if (info.is_subaddress || info.has_payment_id)
  {
    std::cerr << "Use a standard CryLo address, not subaddress/integrated address.\n";
    return 1;
  }

  cryptonote::transaction tx;
  const uint8_t hf_version = HF_VERSION_VESTING;

  if (!cryptonote::construct_miner_tx(
        nullptr,
        nettype,
        0,        // genesis height
        0,        // median weight
        0,        // already generated coins
        0,        // current block weight
        0,        // fee
        info.address,
        tx,
        cryptonote::blobdata(),
        1,        // genesis should collapse to one output
        hf_version))
  {
    std::cerr << "Failed to construct genesis miner transaction.\n";
    return 1;
  }

  cryptonote::blobdata tx_blob = cryptonote::tx_to_blob(tx);
  const std::string genesis_tx = epee::string_tools::buff_to_hex_nodelimer(tx_blob);

  cryptonote::block genesis_block;
  if (!cryptonote::generate_genesis_block(genesis_block, genesis_tx, 0))
  {
    std::cerr << "Failed to generate genesis block.\n";
    return 1;
  }

  const crypto::hash genesis_hash = cryptonote::get_block_hash(genesis_block);
  const crypto::hash tx_hash = cryptonote::get_transaction_hash(tx);

  const std::string git_commit = shell("git rev-parse HEAD 2>/dev/null");
  const std::string generated = now_utc();

  std::ofstream report(out);
  report
    << "{\n"
    << "  \"network\": \"CryLo\",\n"
    << "  \"release\": \"Genesis 1.0\",\n"
    << "  \"nettype\": \"" << (testnet ? "testnet" : "mainnet") << "\",\n"
    << "  \"generated\": \"" << generated << "\",\n"
    << "  \"git_commit\": \"" << git_commit << "\",\n"
    << "  \"crylo_decimals\": 11,\n"
    << "  \"wCryLo_decimals\": 11,\n"
    << "  \"CRYLO_gas_decimals\": 18,\n"
    << "  \"difficulty_target_seconds\": " << DIFFICULTY_TARGET_V2 << ",\n"
    << "  \"genesis_address\": \"" << address << "\",\n"
    << "  \"genesis_tx\": \"" << genesis_tx << "\",\n"
    << "  \"genesis_nonce\": " << genesis_block.nonce << ",\n"
    << "  \"genesis_hash\": \"" << epee::string_tools::pod_to_hex(genesis_hash) << "\",\n"
    << "  \"tx_hash\": \"" << epee::string_tools::pod_to_hex(tx_hash) << "\"\n"
    << "}\n";
  report.close();

  std::cout
    << "\nCryLo Genesis 1.0 generated\n"
    << "Network: " << (testnet ? "testnet" : "mainnet") << "\n"
    << "Git commit: " << git_commit << "\n"
    << "GENESIS_TX = \"" << genesis_tx << "\"\n"
    << "GENESIS_NONCE = " << genesis_block.nonce << "\n"
    << "GENESIS_HASH = " << epee::string_tools::pod_to_hex(genesis_hash) << "\n"
    << "TX_HASH = " << epee::string_tools::pod_to_hex(tx_hash) << "\n"
    << "Report: " << out << "\n\n";

  return 0;
}
