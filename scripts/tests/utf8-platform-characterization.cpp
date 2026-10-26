#include "common/utf8.h"
#include <cassert>
#include <iostream>
#include <string>
#include <limits>
int main() {
  static_assert(sizeof(unsigned int)>=4,"Requires 32-bit unsigned int");
  const std::string ascii="CryLo";
  const std::string two="\xC3\xA9";
  const std::string three="\xE2\x82\xAC";
  const std::string four="\xF0\x9F\x98\x80";
  auto identity=[](wint_t cp)->wint_t{return cp;};
  if(tools::utf8canonical(ascii,identity)!=ascii) return 1;
  if(tools::utf8canonical(two,identity)!=two) return 2;
  if(tools::utf8canonical(three,identity)!=three) return 3;
  const std::string actual=tools::utf8canonical(four,identity);
  if(actual!=four) {
    std::cerr<<"UTF8_FOUR_BYTE_DIFFERENCE sizeof(wint_t)="<<sizeof(wint_t)
      <<" resulting_bytes="<<actual.size()<<" expected_bytes="<<four.size()<<"\n";
    return 10;
  }
  std::cout<<"PASS: UTF-8 ASCII/2/3/4-byte roundtrips; wint_t bytes="<<sizeof(wint_t)<<"\n";
}
