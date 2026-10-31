// Windows wallet account-tag archive compatibility against captured v23 wire bytes.
// The four historical reference archives were captured from the original
// Boost portable archive path in CryLo Windows run #41208292564.
// No wallet keys, addresses or user data are involved.
#include "serialization/containers.h"
#include <boost/archive/portable_binary_iarchive.hpp>
#include <boost/archive/portable_binary_oarchive.hpp>
#include <boost/serialization/map.hpp>
#include <boost/serialization/vector.hpp>
#include <boost/serialization/string.hpp>
#include <boost/serialization/utility.hpp>
#include <array>
#include <iostream>
#include <map>
#include <sstream>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

using ActualTags = std::pair<serializable_map<std::string, std::string>, std::vector<std::string>>;
using ArchivedTags = std::pair<std::map<std::string, std::string>, std::vector<std::string>>;

template <class Archive>
void wallet_v23_tag_archive(Archive &ar, ActualTags &tags)
{
  // Use the production wallet's archive representation without type-punning
  // one std::pair specialization into another (undefined behavior).
  if constexpr (Archive::is_saving::value) {
    ArchivedTags stored(tags.first.parent(), tags.second);
    ar & stored;
  } else {
    ArchivedTags stored;
    ar & stored;
    tags.first.parent() = std::move(stored.first);
    tags.second = std::move(stored.second);
  }
}

std::string encode(ActualTags tags)
{
  std::ostringstream stream(std::ios::out | std::ios::binary);
  {
    boost::archive::portable_binary_oarchive ar(stream);
    wallet_v23_tag_archive(ar, tags);
  }
  return stream.str();
}

ActualTags decode(const std::string &bytes)
{
  ActualTags tags;
  std::istringstream stream(bytes, std::ios::in | std::ios::binary);
  {
    boost::archive::portable_binary_iarchive ar(stream);
    wallet_v23_tag_archive(ar, tags);
  }
  return tags;
}

std::string from_hex(const std::string &hex)
{
  if (hex.size() % 2)
    throw std::runtime_error("Invalid historical archive hex length");
  const auto digit = [](char c) -> unsigned {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    throw std::runtime_error("Invalid historical archive hex digit");
  };
  std::string bytes;
  bytes.reserve(hex.size() / 2);
  for (size_t i = 0; i < hex.size(); i += 2)
    bytes.push_back(static_cast<char>((digit(hex[i]) << 4) | digit(hex[i + 1])));
  return bytes;
}

bool equal(const ActualTags &a, const ActualTags &b)
{
  using Map = std::map<std::string, std::string>;
  return static_cast<const Map&>(a.first) == static_cast<const Map&>(b.first)
      && a.second == b.second;
}

void require(bool yes, const char *reason)
{
  if (!yes) throw std::runtime_error(reason);
}

int main()
{
  try {
    const std::array<const char*, 4> historicalV23Hex = {{
    "011673657269616c697a6174696f6e3a3a61726368697665008000000000000000000000",
    "011673657269616c697a6174696f6e3a3a617263686976650080000000000101000000010573617665640107536176696e67730000010300010573617665640001057361766564",
    "011673657269616c697a6174696f6e3a3a61726368697665008000000000010200000001036e6577010b557064617465642074616701036f6c64010e486973746f726963616c20746167000001040001036f6c6401036e65770001036f6c64",
    "011673657269616c697a6174696f6e3a3a6172636869766500800000000001010000000107756e69636f64650109555446383a20e282ac00000102000107756e69636f64650107756e69636f6465"
    }};
    std::vector<ActualTags> fixtures(4);
    fixtures[1].first["saved"] = "Savings";
    fixtures[1].second = {"saved", "", "saved"};
    fixtures[2].first["old"] = "Historical tag";
    fixtures[2].first["new"] = "Updated tag";
    fixtures[2].second = {"old", "new", "", "old"};
    fixtures[3].first["unicode"] = "UTF8: \xE2\x82\xAC";
    fixtures[3].second = {"unicode", "unicode"};

    for (size_t n = 0; n < fixtures.size(); ++n) {
      const auto oldBytes = from_hex(historicalV23Hex[n]);
      const auto newBytes = encode(fixtures[n]);
      require(newBytes == oldBytes, "FAIL: wallet tag archive bytes differ from historical v23 output");
      const auto legacyDecoded = decode(oldBytes);
      require(equal(legacyDecoded, fixtures[n]), "FAIL: cannot load historical v23 wallet tags");
      const auto roundtrip = decode(newBytes);
      require(equal(roundtrip, fixtures[n]), "FAIL: current wallet tag archive roundtrip");
      std::cout << "fixture=" << n << " archived_bytes=" << oldBytes.size()
                << " golden_match=1 legacy_load_preserved=1\n";
    }
    std::cout << "PASS: all four historical wallet tag archive fixtures are byte-exact and load correctly\n";
  } catch (const std::exception &e) {
    std::cerr << e.what() << "\n";
    return 1;
  }
}
