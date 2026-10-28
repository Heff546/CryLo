// Isolated wallet account-tag archive compatibility gate.
// Reproduces wallet2.h v23+ Boost portable archive semantics; no wallet keys used.
#include "serialization/containers.h"
#include <boost/archive/portable_binary_iarchive.hpp>
#include <boost/archive/portable_binary_oarchive.hpp>
#include <boost/serialization/map.hpp>
#include <boost/serialization/vector.hpp>
#include <boost/serialization/string.hpp>
#include <boost/serialization/utility.hpp>
#include <map>
#include <sstream>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>
#include <iostream>

using ActualTags = std::pair<serializable_map<std::string, std::string>, std::vector<std::string>>;
using ArchivedTags = std::pair<std::map<std::string, std::string>, std::vector<std::string>>;

template <class Archive>
void existing_wallet_v23_tag_archive(Archive &ar, ActualTags &tags) {
  // Exact expression at wallet2.h:1338.
  ar & (ArchivedTags&)tags;
}

template <class Archive>
void proposed_wallet_v23_tag_archive(Archive &ar, ActualTags &tags) {
  if (Archive::is_saving::value) {
    ArchivedTags stored(tags.first.parent(), tags.second);
    ar & stored;
  } else {
    ArchivedTags stored;
    ar & stored;
    tags.first.parent() = std::move(stored.first);
    tags.second = std::move(stored.second);
  }
}

template <class Func>
std::string encode(ActualTags tags, Func f) {
  std::ostringstream stream(std::ios::out | std::ios::binary);
  {
    boost::archive::portable_binary_oarchive ar(stream);
    f(ar, tags);
  }
  return stream.str();
}

template <class Func>
ActualTags decode(const std::string &bytes, Func f) {
  ActualTags tags;
  std::istringstream stream(bytes, std::ios::in | std::ios::binary);
  {
    boost::archive::portable_binary_iarchive ar(stream);
    f(ar, tags);
  }
  return tags;
}

bool equal(const ActualTags &a, const ActualTags &b) {
  return a.first.parent() == b.first.parent() && a.second == b.second;
}

void require(bool yes, const char *reason) {
  if (!yes) throw std::runtime_error(reason);
}

int main() {
  try {
    std::vector<ActualTags> fixtures(4);
    fixtures[1].first["saved"] = "Savings";
    fixtures[1].second = {"saved", "", "saved"};
    fixtures[2].first["old"] = "Historical tag";
    fixtures[2].first["new"] = "Updated tag";
    fixtures[2].second = {"old", "new", "", "old"};
    fixtures[3].first["unicode"] = "UTF8: \xE2\x82\xAC";
    fixtures[3].second = {"unicode", "unicode"};
    unsigned int n = 0;
    for (const auto &expected: fixtures) {
      const auto oldBytes = encode(expected, existing_wallet_v23_tag_archive<boost::archive::portable_binary_oarchive>);
      const auto newBytes = encode(expected, proposed_wallet_v23_tag_archive<boost::archive::portable_binary_oarchive>);
      require(oldBytes == newBytes, "FAIL: account-tag output bytes differ from legacy wallet archive");
      const auto corrected = decode(oldBytes, proposed_wallet_v23_tag_archive<boost::archive::portable_binary_iarchive>);
      require(equal(corrected, expected), "FAIL: proposed code cannot load legacy account-tag archive");
      const auto roundtrip = decode(newBytes, proposed_wallet_v23_tag_archive<boost::archive::portable_binary_iarchive>);
      require(equal(roundtrip, expected), "FAIL: proposed wallet archive roundtrip");
      // Measure, do not require, legacy load behavior (may have silently discarded tags).
      const auto legacyDecoded = decode(oldBytes, existing_wallet_v23_tag_archive<boost::archive::portable_binary_iarchive>);
      std::cout << "fixture=" << n++ << " archived_bytes=" << oldBytes.size()
                << " legacy_load_preserved=" << equal(legacyDecoded, expected)
                << " corrected_load_preserved=" << equal(corrected, expected) << "\n";
    }
    std::cout << "PASS: old/new portable archive bytes identical; legacy archives load correctly with proposed code\n";
  } catch (const std::exception &e) {
    std::cerr << e.what() << "\n";
    return 1;
  }
}
