// Copyright (c) 2023, The Monero Project
//
// All rights reserved.
//
// Redistribution and use in source and binary forms, with or without modification, are
// permitted provided that the following conditions are met:
//
// 1. Redistributions of source code must retain the above copyright notice, this list of
//    conditions and the following disclaimer.
//
// 2. Redistributions in binary form must reproduce the above copyright notice, this list
//    of conditions and the following disclaimer in the documentation and/or other
//    materials provided with the distribution.
//
// 3. Neither the name of the copyright holder nor the names of its contributors may be
//    used to endorse or promote products derived from this software without specific
//    prior written permission.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY
// EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF
// MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL
// THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
// SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
// PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
// INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT,
// STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF
// THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

#include "unit_tests_utils.h"
#include "gtest/gtest.h"

#include "file_io_utils.h"
#include "wallet/wallet2.h"
#include "common/util.h"

using namespace boost::filesystem;
using namespace epee::file_io_utils;

static constexpr const char WALLET_00fd416a_PRIMARY_ADDRESS[] =
    "45p2SngJAPSJbqSiUvYfS3BfhEdxZmv8pDt25oW1LzxrZv9Uq6ARagiFViMGUE3gJk5VPWingCXVf1p2tyAy6SUeSHPhbve";

TEST(wallet_storage, store_to_file2file)
{
    const path source_wallet_file = unit_test::data_dir / "wallet_00fd416a";
    const path interm_wallet_file = unit_test::data_dir / "wallet_00fd416a_copy_file2file";
    const path target_wallet_file = unit_test::data_dir / "wallet_00fd416a_new_file2file";

    ASSERT_TRUE(is_file_exist(source_wallet_file.string()));
    ASSERT_TRUE(is_file_exist(source_wallet_file.string() + ".keys"));

    tools::copy_file(source_wallet_file.string(), interm_wallet_file.string());
    tools::copy_file(source_wallet_file.string() + ".keys", interm_wallet_file.string() + ".keys");

    ASSERT_TRUE(is_file_exist(interm_wallet_file.string()));
    ASSERT_TRUE(is_file_exist(interm_wallet_file.string() + ".keys"));

    if (is_file_exist(target_wallet_file.string()))
        remove(target_wallet_file);
    if (is_file_exist(target_wallet_file.string() + ".keys"))
        remove(target_wallet_file.string() + ".keys");
    ASSERT_FALSE(is_file_exist(target_wallet_file.string()));
    ASSERT_FALSE(is_file_exist(target_wallet_file.string() + ".keys"));

    epee::wipeable_string password("beepbeep");

    const auto files_are_expected = [&]()
    {
        EXPECT_FALSE(is_file_exist(interm_wallet_file.string()));
        EXPECT_FALSE(is_file_exist(interm_wallet_file.string() + ".keys"));
        EXPECT_TRUE(is_file_exist(target_wallet_file.string()));
        EXPECT_TRUE(is_file_exist(target_wallet_file.string() + ".keys"));
    };

    {
        tools::wallet2 w;
        w.load(interm_wallet_file.string(), password);
        const std::string primary_address = w.get_address_as_str();
        EXPECT_EQ(WALLET_00fd416a_PRIMARY_ADDRESS, primary_address);
        w.store_to(target_wallet_file.string(), password);
        files_are_expected();
    }

    files_are_expected();

    {
        tools::wallet2 w;
        w.load(target_wallet_file.string(), password);
        const std::string primary_address = w.get_address_as_str();
        EXPECT_EQ(WALLET_00fd416a_PRIMARY_ADDRESS, primary_address);
        w.store_to("", "");
        files_are_expected();
    }

    files_are_expected();
}

TEST(wallet_storage, store_to_mem2file)
{
    const path target_wallet_file = unit_test::data_dir / "wallet_mem2file";

    if (is_file_exist(target_wallet_file.string()))
        remove(target_wallet_file);
    if (is_file_exist(target_wallet_file.string() + ".keys"))
        remove(target_wallet_file.string() + ".keys");
    ASSERT_FALSE(is_file_exist(target_wallet_file.string()));
    ASSERT_FALSE(is_file_exist(target_wallet_file.string() + ".keys"));

    epee::wipeable_string password("beepbeep2");

    {
        tools::wallet2 w;
        w.generate("", password);
        w.store_to(target_wallet_file.string(), password);

        EXPECT_TRUE(is_file_exist(target_wallet_file.string()));
        EXPECT_TRUE(is_file_exist(target_wallet_file.string() + ".keys"));
    }

    EXPECT_TRUE(is_file_exist(target_wallet_file.string()));
    EXPECT_TRUE(is_file_exist(target_wallet_file.string() + ".keys"));

    {
        tools::wallet2 w;
        w.load(target_wallet_file.string(), password);

        EXPECT_TRUE(is_file_exist(target_wallet_file.string()));
        EXPECT_TRUE(is_file_exist(target_wallet_file.string() + ".keys"));
    }

    EXPECT_TRUE(is_file_exist(target_wallet_file.string()));
    EXPECT_TRUE(is_file_exist(target_wallet_file.string() + ".keys"));
}

TEST(wallet_storage, change_password_same_file)
{
    const path source_wallet_file = unit_test::data_dir / "wallet_00fd416a";
    const path interm_wallet_file = unit_test::data_dir / "wallet_00fd416a_copy_change_password_same";

    ASSERT_TRUE(is_file_exist(source_wallet_file.string()));
    ASSERT_TRUE(is_file_exist(source_wallet_file.string() + ".keys"));

    tools::copy_file(source_wallet_file.string(), interm_wallet_file.string());
    tools::copy_file(source_wallet_file.string() + ".keys", interm_wallet_file.string() + ".keys");

    ASSERT_TRUE(is_file_exist(interm_wallet_file.string()));
    ASSERT_TRUE(is_file_exist(interm_wallet_file.string() + ".keys"));

    epee::wipeable_string old_password("beepbeep");
    epee::wipeable_string new_password("meepmeep");

    {
        tools::wallet2 w;
        w.load(interm_wallet_file.string(), old_password);
        const std::string primary_address = w.get_address_as_str();
        EXPECT_EQ(WALLET_00fd416a_PRIMARY_ADDRESS, primary_address);
        w.change_password(w.get_wallet_file(), old_password, new_password);
    }

    {
        tools::wallet2 w;
        w.load(interm_wallet_file.string(), new_password);
        const std::string primary_address = w.get_address_as_str();
        EXPECT_EQ(WALLET_00fd416a_PRIMARY_ADDRESS, primary_address);
    }

    {
        tools::wallet2 w;
        EXPECT_THROW(w.load(interm_wallet_file.string(), old_password), tools::error::invalid_password);
    }
}

TEST(wallet_storage, change_password_different_file)
{
    const path source_wallet_file = unit_test::data_dir / "wallet_00fd416a";
    const path interm_wallet_file = unit_test::data_dir / "wallet_00fd416a_copy_change_password_diff";
    const path target_wallet_file = unit_test::data_dir / "wallet_00fd416a_new_change_password_diff";

    ASSERT_TRUE(is_file_exist(source_wallet_file.string()));
    ASSERT_TRUE(is_file_exist(source_wallet_file.string() + ".keys"));

    tools::copy_file(source_wallet_file.string(), interm_wallet_file.string());
    tools::copy_file(source_wallet_file.string() + ".keys", interm_wallet_file.string() + ".keys");

    ASSERT_TRUE(is_file_exist(interm_wallet_file.string()));
    ASSERT_TRUE(is_file_exist(interm_wallet_file.string() + ".keys"));

    if (is_file_exist(target_wallet_file.string()))
        remove(target_wallet_file);
    if (is_file_exist(target_wallet_file.string() + ".keys"))
        remove(target_wallet_file.string() + ".keys");
    ASSERT_FALSE(is_file_exist(target_wallet_file.string()));
    ASSERT_FALSE(is_file_exist(target_wallet_file.string() + ".keys"));

    epee::wipeable_string old_password("beepbeep");
    epee::wipeable_string new_password("meepmeep");

    {
        tools::wallet2 w;
        w.load(interm_wallet_file.string(), old_password);
        const std::string primary_address = w.get_address_as_str();
        EXPECT_EQ(WALLET_00fd416a_PRIMARY_ADDRESS, primary_address);
        w.change_password(target_wallet_file.string(), old_password, new_password);
    }

    EXPECT_FALSE(is_file_exist(interm_wallet_file.string()));
    EXPECT_FALSE(is_file_exist(interm_wallet_file.string() + ".keys"));
    EXPECT_TRUE(is_file_exist(target_wallet_file.string()));
    EXPECT_TRUE(is_file_exist(target_wallet_file.string() + ".keys"));

    {
        tools::wallet2 w;
        w.load(target_wallet_file.string(), new_password);
        const std::string primary_address = w.get_address_as_str();
        EXPECT_EQ(WALLET_00fd416a_PRIMARY_ADDRESS, primary_address);
    }
}

TEST(wallet_storage, change_password_in_memory)
{
    const epee::wipeable_string password1("monero");
    const epee::wipeable_string password2("means money");
    const epee::wipeable_string password_wrong("is traceable");

    tools::wallet2 w;
    w.generate("", password1);
    const std::string primary_address_1 = w.get_address_as_str();
    w.change_password("", password1, password2);
    const std::string primary_address_2 = w.get_address_as_str();
    EXPECT_EQ(primary_address_1, primary_address_2);

    EXPECT_THROW(w.change_password("", password_wrong, password1), tools::error::invalid_password);
    // A rejected change must preserve the current password and wallet state.
    EXPECT_NO_THROW(w.change_password("", password2, password1));
    EXPECT_EQ(primary_address_1, w.get_address_as_str());
}

TEST(wallet_storage, change_password_mem2file)
{
    const path target_wallet_file = unit_test::data_dir / "wallet_change_password_mem2file";

    if (is_file_exist(target_wallet_file.string()))
        remove(target_wallet_file);
    if (is_file_exist(target_wallet_file.string() + ".keys"))
        remove(target_wallet_file.string() + ".keys");
    ASSERT_FALSE(is_file_exist(target_wallet_file.string()));
    ASSERT_FALSE(is_file_exist(target_wallet_file.string() + ".keys"));

    const epee::wipeable_string password1("https://safecurves.cr.yp.to/rigid.html");
    const epee::wipeable_string password2(
        "https://csrc.nist.gov/csrc/media/projects/crypto-standards-development-process/documents/dualec_in_x982_and_sp800-90.pdf");
    
    std::string primary_address_1, primary_address_2;
    {
        tools::wallet2 w;
        w.generate("", password1);
        primary_address_1 = w.get_address_as_str();
        w.change_password(target_wallet_file.string(), password1, password2);
    }

    EXPECT_TRUE(is_file_exist(target_wallet_file.string()));
    EXPECT_TRUE(is_file_exist(target_wallet_file.string() + ".keys"));

    {
        tools::wallet2 w;
        w.load(target_wallet_file.string(), password2);
        primary_address_2 = w.get_address_as_str();
    }

    EXPECT_EQ(primary_address_1, primary_address_2);
}

TEST(wallet_storage, account_tags_survive_store_and_reload)
{
    const path target_wallet_file = unit_test::data_dir / "wallet_account_tags_portable";
    if (is_file_exist(target_wallet_file.string()))
        remove(target_wallet_file);
    if (is_file_exist(target_wallet_file.string() + ".keys"))
        remove(target_wallet_file.string() + ".keys");

    epee::wipeable_string password("wallet-tags-regression-test");
    std::string original_address;
    {
        tools::wallet2 w;
        w.generate("", password);
        original_address = w.get_address_as_str();
        w.set_account_tag({0}, "savings");
        w.set_account_tag_description("savings", "Long-term savings");
        const auto &tags = w.get_account_tags();
        ASSERT_EQ("Long-term savings", tags.first.at("savings"));
        ASSERT_FALSE(tags.second.empty());
        ASSERT_EQ("savings", tags.second[0]);
        w.store_to(target_wallet_file.string(), password);
    }

    ASSERT_TRUE(is_file_exist(target_wallet_file.string()));
    ASSERT_TRUE(is_file_exist(target_wallet_file.string() + ".keys"));
    {
        tools::wallet2 restored;
        restored.load(target_wallet_file.string(), password);
        EXPECT_EQ(original_address, restored.get_address_as_str());
        const auto &tags = restored.get_account_tags();
        ASSERT_EQ("Long-term savings", tags.first.at("savings"));
        ASSERT_FALSE(tags.second.empty());
        EXPECT_EQ("savings", tags.second[0]);
        restored.store_to("", "");
    }
}


// Self-contained CryLo wallet storage cases. Unlike the old Monero archive
// fixture tests above, these require no historical .keys file.
static void reset_generated_wallet_test_files(const path& wallet_file)
{
    if (is_file_exist(wallet_file.string()))
        remove(wallet_file);
    if (is_file_exist(wallet_file.string() + ".keys"))
        remove(wallet_file.string() + ".keys");
}

TEST(wallet_storage, generated_store_to_file2file)
{
    const path source = unit_test::data_dir / "wallet_generated_copy_source";
    const path target = unit_test::data_dir / "wallet_generated_copy_target";
    reset_generated_wallet_test_files(source);
    reset_generated_wallet_test_files(target);
    epee::wipeable_string password("generated-wallet-copy-password");
    std::string address;
    {
        tools::wallet2 wallet;
        wallet.generate(source.string(), password);
        address = wallet.get_address_as_str();
    }
    ASSERT_TRUE(is_file_exist(source.string()));
    ASSERT_TRUE(is_file_exist(source.string() + ".keys"));
    {
        tools::wallet2 wallet;
        wallet.load(source.string(), password);
        EXPECT_EQ(address, wallet.get_address_as_str());
        wallet.store_to(target.string(), password);
    }
    EXPECT_FALSE(is_file_exist(source.string()));
    EXPECT_FALSE(is_file_exist(source.string() + ".keys"));
    ASSERT_TRUE(is_file_exist(target.string()));
    ASSERT_TRUE(is_file_exist(target.string() + ".keys"));
    {
        tools::wallet2 wallet;
        wallet.load(target.string(), password);
        EXPECT_EQ(address, wallet.get_address_as_str());
        wallet.store_to("", "");
    }
}

TEST(wallet_storage, generated_change_password_same_file)
{
    const path source = unit_test::data_dir / "wallet_generated_change_same";
    reset_generated_wallet_test_files(source);
    epee::wipeable_string old_password("wallet-generated-old-same");
    epee::wipeable_string new_password("wallet-generated-new-same");
    std::string address;
    {
        tools::wallet2 wallet;
        wallet.generate(source.string(), old_password);
        address = wallet.get_address_as_str();
    }
    {
        tools::wallet2 wallet;
        wallet.load(source.string(), old_password);
        wallet.change_password(wallet.get_wallet_file(), old_password, new_password);
    }
    {
        tools::wallet2 wallet;
        wallet.load(source.string(), new_password);
        EXPECT_EQ(address, wallet.get_address_as_str());
    }
    {
        tools::wallet2 wallet;
        EXPECT_THROW(wallet.load(source.string(), old_password), tools::error::invalid_password);
    }
}

TEST(wallet_storage, generated_change_password_different_file)
{
    const path source = unit_test::data_dir / "wallet_generated_change_source";
    const path target = unit_test::data_dir / "wallet_generated_change_target";
    reset_generated_wallet_test_files(source);
    reset_generated_wallet_test_files(target);
    epee::wipeable_string old_password("wallet-generated-old-different");
    epee::wipeable_string new_password("wallet-generated-new-different");
    std::string address;
    {
        tools::wallet2 wallet;
        wallet.generate(source.string(), old_password);
        address = wallet.get_address_as_str();
    }
    {
        tools::wallet2 wallet;
        wallet.load(source.string(), old_password);
        wallet.change_password(target.string(), old_password, new_password);
    }
    EXPECT_FALSE(is_file_exist(source.string()));
    EXPECT_FALSE(is_file_exist(source.string() + ".keys"));
    ASSERT_TRUE(is_file_exist(target.string()));
    ASSERT_TRUE(is_file_exist(target.string() + ".keys"));
    {
        tools::wallet2 wallet;
        wallet.load(target.string(), new_password);
        EXPECT_EQ(address, wallet.get_address_as_str());
    }
}

TEST(wallet_storage, crylo_uri_roundtrip)
{
    const epee::wipeable_string password("crylo-uri-regression");
    tools::wallet2 wallet;
    wallet.generate("", password);
    const std::string address = wallet.get_address_as_str();
    std::string error;
    const uint64_t amount = 100000000000;
    const std::string uri = wallet.make_uri(address, "", amount, "URI regression", "CryLo recipient", error);
    ASSERT_TRUE(error.empty()) << error;
    ASSERT_FALSE(uri.empty());
    EXPECT_EQ(0u, uri.find("crylo:" + address));

    std::string recovered_address, recovered_payment, recovered_description, recovered_recipient;
    uint64_t recovered_amount = 0;
    std::vector<std::string> unknown;
    ASSERT_TRUE(wallet.parse_uri(uri, recovered_address, recovered_payment, recovered_amount,
        recovered_description, recovered_recipient, unknown, error)) << error;
    EXPECT_EQ(address, recovered_address);
    EXPECT_TRUE(recovered_payment.empty());
    EXPECT_EQ(amount, recovered_amount);
    EXPECT_EQ("URI regression", recovered_description);
    EXPECT_EQ("CryLo recipient", recovered_recipient);
    EXPECT_TRUE(unknown.empty());

    // Payment URI parsing must not accept the former chain's scheme.
    error.clear();
    EXPECT_FALSE(wallet.parse_uri("monero:" + address, recovered_address, recovered_payment,
        recovered_amount, recovered_description, recovered_recipient, unknown, error));
    EXPECT_NE(std::string::npos, error.find("wrong scheme"));
}
