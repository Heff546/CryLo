#include "crylo_tui.h"

#include <windows.h>
#include <conio.h>

#include <algorithm>
#include <array>
#include <chrono>
#include <cctype>
#include <cstdio>
#include <cstdlib>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

namespace {

static constexpr uint64_t CRYLO_ATOMIC_UNITS = 100000000000ULL;
static constexpr uint64_t CRYLO_BLOCK_TARGET_SECONDS = 210;

static std::string run_cmd(const std::string& cmd)
{
    std::array<char, 4096> buffer{};
    std::string result;

    FILE* pipe = _popen(cmd.c_str(), "r");
    if (!pipe)
        return result;

    while (fgets(buffer.data(), static_cast<int>(buffer.size()), pipe) != nullptr)
        result += buffer.data();

    _pclose(pipe);
    return result;
}

static uint64_t json_u64(const std::string& json, const char* key)
{
    const auto key_pos = json.find(key);
    if (key_pos == std::string::npos)
        return 0;

    const auto colon = json.find(':', key_pos);
    if (colon == std::string::npos)
        return 0;

    const auto first = json.find_first_of("0123456789", colon + 1);
    if (first == std::string::npos)
        return 0;

    const auto last = json.find_first_not_of("0123456789", first);

    try
    {
        return std::stoull(json.substr(first, last - first));
    }
    catch (...)
    {
        return 0;
    }
}

static bool json_bool(const std::string& json, const char* key)
{
    const auto key_pos = json.find(key);
    if (key_pos == std::string::npos)
        return false;

    const auto colon = json.find(':', key_pos);
    if (colon == std::string::npos)
        return false;

    const auto value = json.find_first_not_of(" \t\r\n", colon + 1);
    if (value == std::string::npos)
        return false;

    return json.compare(value, 4, "true") == 0;
}

static std::string format_atomic_crylo(uint64_t atomic)
{
    std::ostringstream out;

    out << (atomic / CRYLO_ATOMIC_UNITS)
        << '.'
        << std::setw(11)
        << std::setfill('0')
        << (atomic % CRYLO_ATOMIC_UNITS);

    return out.str();
}

static std::string format_hashrate(uint64_t value)
{
    std::ostringstream out;

    if (value >= 1000000000ULL)
    {
        out << std::fixed << std::setprecision(2)
            << static_cast<double>(value) / 1000000000.0
            << " GH/s";
    }
    else if (value >= 1000000ULL)
    {
        out << std::fixed << std::setprecision(2)
            << static_cast<double>(value) / 1000000.0
            << " MH/s";
    }
    else if (value >= 1000ULL)
    {
        out << std::fixed << std::setprecision(2)
            << static_cast<double>(value) / 1000.0
            << " kH/s";
    }
    else
    {
        out << value << " H/s";
    }

    return out.str();
}

static std::string format_duration(uint64_t seconds)
{
    const uint64_t days = seconds / 86400;
    seconds %= 86400;

    const uint64_t hours = seconds / 3600;
    seconds %= 3600;

    const uint64_t minutes = seconds / 60;
    seconds %= 60;

    std::ostringstream out;

    if (days > 0)
        out << days << "d " << hours << "h " << minutes << "m";
    else if (hours > 0)
        out << hours << "h " << minutes << "m " << seconds << "s";
    else
        out << minutes << "m " << seconds << "s";

    return out.str();
}

static bool valid_wallet_argument(const std::string& value)
{
    if (value.empty() || value.size() > 256)
        return false;

    return std::all_of(
        value.begin(),
        value.end(),
        [](unsigned char ch)
        {
            return std::isalnum(ch) != 0;
        });
}

static void enable_windows_console()
{
    SetConsoleOutputCP(CP_UTF8);
    SetConsoleCP(CP_UTF8);

    HANDLE out = GetStdHandle(STD_OUTPUT_HANDLE);
    if (out == INVALID_HANDLE_VALUE)
        return;

    DWORD mode = 0;
    if (!GetConsoleMode(out, &mode))
        return;

    mode |= ENABLE_VIRTUAL_TERMINAL_PROCESSING;
    SetConsoleMode(out, mode);
}

static void clear_console()
{
    HANDLE out = GetStdHandle(STD_OUTPUT_HANDLE);

    if (out == INVALID_HANDLE_VALUE)
        return;

    CONSOLE_SCREEN_BUFFER_INFO info{};
    if (!GetConsoleScreenBufferInfo(out, &info))
        return;

    const DWORD cells =
        static_cast<DWORD>(info.dwSize.X) *
        static_cast<DWORD>(info.dwSize.Y);

    DWORD written = 0;
    const COORD home{0, 0};

    FillConsoleOutputCharacterA(out, ' ', cells, home, &written);
    FillConsoleOutputAttribute(
        out,
        info.wAttributes,
        cells,
        home,
        &written);

    SetConsoleCursorPosition(out, home);
}

static void write_console_frame(const std::string& frame)
{
    HANDLE out = GetStdHandle(STD_OUTPUT_HANDLE);

    if (out == INVALID_HANDLE_VALUE)
        return;

    CONSOLE_SCREEN_BUFFER_INFO info{};
    if (!GetConsoleScreenBufferInfo(out, &info))
        return;

    const SHORT width =
        static_cast<SHORT>(
            info.srWindow.Right -
            info.srWindow.Left +
            1);

    const SHORT height =
        static_cast<SHORT>(
            info.srWindow.Bottom -
            info.srWindow.Top +
            1);

    if (width <= 0 || height <= 0)
        return;

    std::vector<CHAR_INFO> cells(
        static_cast<size_t>(width) *
        static_cast<size_t>(height));

    for (auto& cell : cells)
    {
        cell.Char.AsciiChar = ' ';
        cell.Attributes = info.wAttributes;
    }

    SHORT row = 0;
    SHORT column = 0;

    for (char ch : frame)
    {
        if (row >= height)
            break;

        if (ch == '\r')
            continue;

        if (ch == '\n')
        {
            ++row;
            column = 0;
            continue;
        }

        if (column >= width)
        {
            ++row;
            column = 0;

            if (row >= height)
                break;
        }

        const size_t index =
            static_cast<size_t>(row) *
            static_cast<size_t>(width) +
            static_cast<size_t>(column);

        cells[index].Char.AsciiChar = ch;
        cells[index].Attributes = info.wAttributes;

        ++column;
    }

    COORD buffer_size{
        width,
        height
    };

    COORD buffer_origin{
        0,
        0
    };

    SMALL_RECT target{
        info.srWindow.Left,
        info.srWindow.Top,
        info.srWindow.Right,
        info.srWindow.Bottom
    };

    WriteConsoleOutputA(
        out,
        cells.data(),
        buffer_size,
        buffer_origin,
        &target);
}

static void set_console_cursor_visible(bool visible)
{
    HANDLE out = GetStdHandle(STD_OUTPUT_HANDLE);

    if (out == INVALID_HANDLE_VALUE)
        return;

    CONSOLE_CURSOR_INFO cursor{};
    if (!GetConsoleCursorInfo(out, &cursor))
        return;

    cursor.bVisible =
        visible
            ? TRUE
            : FALSE;

    SetConsoleCursorInfo(
        out,
        &cursor);
}

} // anonymous namespace

namespace crylotui {

static NodeStats g_stats;

static std::atomic<bool> g_mining_active{false};
static std::atomic<int> g_threads{0};

NodeStats& get_stats()
{
    return g_stats;
}

void NodeStats::set_status(const std::string& s)
{
    std::lock_guard<std::mutex> lock(mtx);
    status = s;
}

void NodeStats::add_log(const std::string& line, int color_type)
{
    std::lock_guard<std::mutex> lock(mtx);

    log_lines.push_back({line, color_type});

    if (log_lines.size() > 500)
        log_lines.pop_front();
}

void NodeStats::set_block_info(
    const std::string& id,
    const std::string& pow,
    const std::string& reward)
{
    std::lock_guard<std::mutex> lock(mtx);

    last_block_id = id;
    last_pow = pow;
    last_reward = reward;
}

void play_datasette_animation()
{
    // Windows uses the native console dashboard directly.
}

static void poll_daemon_state()
{
    NodeStats& stats = get_stats();

    const std::string info = run_cmd(
        "curl.exe -s --max-time 2 "
        "http://127.0.0.1:22641/get_info 2>NUL");

    if (!info.empty())
    {
        const uint64_t height =
            json_u64(info, "\"height\"");

        const uint64_t target =
            json_u64(info, "\"target_height\"");

        const uint64_t difficulty =
            json_u64(info, "\"difficulty\"");

        stats.height.store(height);
        stats.target_height.store(target);
        stats.difficulty.store(difficulty);

        const uint64_t peers_out =
            json_u64(info, "\"outgoing_connections_count\"");

        const uint64_t peers_in =
            json_u64(info, "\"incoming_connections_count\"");

        stats.peers_out.store(peers_out);
        stats.peers_in.store(peers_in);

        const bool has_peers =
            peers_out > 0 || peers_in > 0;

        stats.synced.store(
            has_peers &&
            (
                target == 0 ||
                height >= target ||
                json_bool(info, "\"synchronized\"")
            ));

        const uint64_t reward =
            json_u64(info, "\"block_reward\"");

        if (reward > 0)
        {
            std::lock_guard<std::mutex> lock(stats.mtx);
            stats.last_reward = format_atomic_crylo(reward);
        }
    }

    const std::string mining = run_cmd(
        "curl.exe -s --max-time 2 "
        "http://127.0.0.1:22641/mining_status 2>NUL");

    if (!mining.empty())
    {
        const bool active =
            json_bool(mining, "\"active\"");

        g_mining_active.store(active);
        stats.mining.store(active);

        stats.hashrate.store(
            json_u64(mining, "\"speed\""));

        g_threads.store(
            active
                ? static_cast<int>(
                    json_u64(mining, "\"threads_count\""))
                : 0);

        const uint64_t difficulty =
            json_u64(mining, "\"difficulty\"");

        if (difficulty > 0)
            stats.difficulty.store(difficulty);

        const uint64_t reward =
            json_u64(mining, "\"block_reward\"");

        if (reward > 0)
        {
            std::lock_guard<std::mutex> lock(stats.mtx);
            stats.last_reward = format_atomic_crylo(reward);
        }
    }
}

static void render_dashboard(
    const std::string& input,
    const std::vector<std::string>& command_output,
    std::chrono::steady_clock::time_point start_time)
{
    NodeStats& stats = get_stats();

    const uint64_t height =
        stats.height.load();

    const uint64_t target =
        stats.target_height.load();

    const uint64_t difficulty =
        stats.difficulty.load();

    const uint64_t local_hashrate =
        stats.hashrate.load();

    const uint64_t network_hashrate =
        CRYLO_BLOCK_TARGET_SECONDS > 0
            ? difficulty / CRYLO_BLOCK_TARGET_SECONDS
            : 0;

    std::string reward;
    std::deque<std::pair<std::string, int>> logs;

    {
        std::lock_guard<std::mutex> lock(stats.mtx);

        reward =
            stats.last_reward;

        logs =
            stats.log_lines;
    }

    const auto elapsed =
        std::chrono::duration_cast<std::chrono::seconds>(
            std::chrono::steady_clock::now() -
            start_time)
            .count();

    std::ostringstream frame;

    frame
        << "======================================================================\n"
        << "                CryLo Network Daemon Testnet V4\n"
        << "======================================================================\n\n"
        << "HEIGHT:        "
        << height
        << "\n"
        << "DIFFICULTY:    "
        << difficulty
        << "\n"
        << "REWARD:        "
        << (
            reward.empty()
                ? "-"
                : reward + " CryLo"
        )
        << "\n"
        << "PEERS:         "
        << stats.peers_out.load()
        << " OUT / "
        << stats.peers_in.load()
        << " IN\n"
        << "LOCAL HASH:    "
        << format_hashrate(local_hashrate)
        << "\n"
        << "NETWORK HASH:  "
        << format_hashrate(network_hashrate)
        << "\n";

    if (
        local_hashrate > 0 &&
        difficulty > 0)
    {
        frame
            << "ETA BLOCK:     "
            << format_duration(
                difficulty /
                local_hashrate)
            << "\n";
    }
    else
    {
        frame
            << "ETA BLOCK:     -\n";
    }

    const uint64_t peers_out =
        stats.peers_out.load();

    const uint64_t peers_in =
        stats.peers_in.load();

    if (peers_out == 0 && peers_in == 0)
    {
        frame
            << "SYNC:          DISCONNECTED\n";
    }
    else if (stats.synced.load())
    {
        frame
            << "SYNC:          SYNCED\n";
    }
    else if (target > 0)
    {
        const uint64_t percent =
            height >= target
                ? 100ULL
                : height * 100ULL / target;

        const uint64_t remaining =
            target > height
                ? target - height
                : 0;

        const uint64_t eta_seconds =
            remaining * CRYLO_BLOCK_TARGET_SECONDS;

        const uint64_t eta_hours =
            eta_seconds / 3600ULL;

        const uint64_t eta_minutes =
            (eta_seconds % 3600ULL) / 60ULL;

        frame
            << "SYNC:          "
            << height
            << " / "
            << target
            << " ("
            << percent
            << "%) ETA "
            << eta_hours
            << "h "
            << eta_minutes
            << "m\n";
    }
    else
    {
        frame
            << "SYNC:          SYNCING\n";
    }

    frame
        << "UPTIME:        "
        << format_duration(
            static_cast<uint64_t>(
                elapsed < 0
                    ? 0
                    : elapsed))
        << "\n"
        << "MINING:        "
        << (
            g_mining_active.load()
                ? "STARTED"
                : "PAUSED"
        )
        << "\n"
        << "THREADS:       "
        << g_threads.load()
        << "\n\n"
        << "----------------------------- EVENTS ---------------------------------\n";

    const size_t begin =
        logs.size() > 6
            ? logs.size() - 6
            : 0;

    if (logs.empty())
    {
        frame
            << "Waiting for daemon events...\n";
    }
    else
    {
        for (
            size_t i = begin;
            i < logs.size();
            ++i)
        {
            frame
                << logs[i].first
                << "\n";
        }
    }

    frame
        << "\n"
        << "----------------------------- OUTPUT ---------------------------------\n";

    if (command_output.empty())
    {
        frame
            << "Ready. Type help for commands.\n";
    }
    else
    {
        for (
            const auto& line :
            command_output)
        {
            frame
                << line
                << "\n";
        }
    }

    frame
        << "\n"
        << "COMMAND: "
        << input
        << "\n"
        << "TYPE: help | start_mining <wallet> <threads> | stop_mining | exit\n"
        << "======================================================================\n";

    write_console_frame(
        frame.str());
}
static void execute_command(
    const std::string& input,
    std::vector<std::string>& output,
    std::atomic<bool>& stop_signal)
{
    NodeStats& stats = get_stats();

    output.clear();

    if (input.empty())
        return;

    if (input == "help")
    {
        output = {
            "Commands:",
            "help | status | sync | height | peers | version",
            "mining_status | start_mining <wallet> <threads>",
            "stop_mining | clear | exit"
        };
        return;
    }

    if (input == "status")
    {
        output = {
            "Height : " + std::to_string(stats.height.load()),
            "Peers  : " +
                std::to_string(stats.peers_out.load()) +
                " OUT / " +
                std::to_string(stats.peers_in.load()) +
                " IN",
            "Sync   : " +
                std::string(
                    (
                        stats.peers_out.load() == 0 &&
                        stats.peers_in.load() == 0
                    )
                        ? "DISCONNECTED"
                        : (
                            stats.synced.load()
                                ? "SYNCED"
                                : "SYNCING"
                        )),
            "Mining : " +
                std::string(
                    g_mining_active.load()
                        ? "STARTED"
                        : "PAUSED")
        };
        return;
    }

    if (input == "sync")
    {
        output = {
            "Sync: " +
            std::string(
                (
                    stats.peers_out.load() == 0 &&
                    stats.peers_in.load() == 0
                )
                    ? "DISCONNECTED"
                    : (
                        stats.synced.load()
                            ? "SYNCED"
                            : "SYNCING"
                    )) +
            " | height " +
            std::to_string(stats.height.load())
        };
        return;
    }

    if (input == "height")
    {
        output = {
            "Height: " +
            std::to_string(stats.height.load())
        };
        return;
    }

    if (input == "peers")
    {
        output = {
            "Peers OUT: " +
            std::to_string(stats.peers_out.load()),
            "Peers IN : " +
            std::to_string(stats.peers_in.load())
        };
        return;
    }

    if (input == "version")
    {
        output = {
            "CryLo Network Daemon Testnet V4",
            "P2P Port : 22640",
            "RPC Port : 22641",
            "PoW      : rx/crylo"
        };
        return;
    }

    if (input == "mining_status")
    {
        poll_daemon_state();

        output = {
            "Mining : " +
            std::string(
                g_mining_active.load()
                    ? "STARTED"
                    : "PAUSED"),
            "Hashrate: " +
            format_hashrate(stats.hashrate.load()),
            "Threads : " +
            std::to_string(g_threads.load())
        };
        return;
    }

    if (input == "clear")
    {
        {
            std::lock_guard<std::mutex> lock(stats.mtx);
            stats.log_lines.clear();
        }

        clear_console();
        output = {"Console cleared."};
        return;
    }

    if (input == "stop_mining")
    {
        const std::string result = run_cmd(
            "curl.exe -s --max-time 5 "
            "http://127.0.0.1:22641/stop_mining "
            "-H \"Content-Type: application/json\" "
            "-d \"{}\" 2>NUL");

        poll_daemon_state();

        output = {
            g_mining_active.load()
                ? "Mining stop request sent; miner still reports active."
                : "Mining stopped."
        };

        return;
    }

    if (input == "exit" || input == "quit")
    {
        output = {"Stopping CryLo daemon..."};
        stop_signal.store(true);
        return;
    }

    if (input.rfind("start_mining ", 0) == 0)
    {
        std::istringstream args(input);

        std::string command;
        std::string wallet;
        int threads = 1;

        args >> command >> wallet >> threads;

        if (!valid_wallet_argument(wallet))
        {
            output = {
                "Invalid CryLo wallet address."
            };
            return;
        }

        if (threads < 1 || threads > 1024)
        {
            output = {
                "Thread count must be between 1 and 1024."
            };
            return;
        }

        std::ostringstream command_line;

        command_line
            << "curl.exe -s --max-time 5 "
            << "http://127.0.0.1:22641/start_mining "
            << "-H \"Content-Type: application/json\" "
            << "-d \"{\\\"miner_address\\\":\\\""
            << wallet
            << "\\\",\\\"threads_count\\\":"
            << threads
            << ",\\\"do_background_mining\\\":false,"
            << "\\\"ignore_battery\\\":true}\" "
            << "2>NUL";

        const std::string response =
            run_cmd(command_line.str());

        poll_daemon_state();

        if (g_mining_active.load())
        {
            output = {
                "Mining started.",
                "Threads : " +
                    std::to_string(g_threads.load()),
                "Hashrate: " +
                    format_hashrate(stats.hashrate.load())
            };
        }
        else
        {
            output = {
                "Mining start request did not become active.",
                response.empty()
                    ? "No RPC response returned."
                    : response
            };
        }

        return;
    }

    output = {
        "Unknown command: " + input,
        "Type help for available commands."
    };
}

void run_tui(std::atomic<bool>& stop_signal)
{
    enable_windows_console();
    clear_console();
    set_console_cursor_visible(false);

    std::string input;
    std::vector<std::string> command_output = {
        "Ready. Type help for commands."
    };

    const auto start_time =
        std::chrono::steady_clock::now();

    auto last_poll =
        std::chrono::steady_clock::now() -
        std::chrono::seconds(10);

    auto last_draw =
        std::chrono::steady_clock::now() -
        std::chrono::seconds(10);

    while (!stop_signal.load())
    {
        const auto now =
            std::chrono::steady_clock::now();

        if (
            std::chrono::duration_cast<std::chrono::seconds>(
                now - last_poll).count() >= 2)
        {
            last_poll = now;
            poll_daemon_state();

            // Keep a previously displayed mining-status command synchronized
            // with the daemon. Mining may be started or stopped externally by
            // Electron, so stale command output must not contradict the live
            // dashboard header.
            if (
                !command_output.empty() &&
                command_output.front().rfind("Mining :", 0) == 0)
            {
                NodeStats& stats = get_stats();

                command_output = {
                    "Mining : " +
                        std::string(
                            g_mining_active.load()
                                ? "STARTED"
                                : "PAUSED"),
                    "Hashrate: " +
                        format_hashrate(stats.hashrate.load()),
                    "Threads : " +
                        std::to_string(g_threads.load())
                };
            }
        }

        if (
            std::chrono::duration_cast<std::chrono::milliseconds>(
                now - last_draw).count() >= 500)
        {
            last_draw = now;
            render_dashboard(
                input,
                command_output,
                start_time);
        }

        while (_kbhit())
        {
            const int ch = _getch();

            if (ch == 27)
            {
                stop_signal.store(true);
                break;
            }

            if (
                (ch == 'q' || ch == 'Q') &&
                input.empty())
            {
                stop_signal.store(true);
                break;
            }

            if (ch == '\r' || ch == '\n')
            {
                execute_command(
                    input,
                    command_output,
                    stop_signal);

                input.clear();
                break;
            }

            if (ch == 8)
            {
                if (!input.empty())
                    input.pop_back();

                continue;
            }

            if (ch >= 32 && ch <= 126)
            {
                if (input.size() < 512)
                    input.push_back(
                        static_cast<char>(ch));
            }
        }

        std::this_thread::sleep_for(
            std::chrono::milliseconds(20));
    }

    set_console_cursor_visible(true);
}

void tui_log_handler(const std::string& message)
{
    NodeStats& stats = get_stats();

    stats.log_msgs_received++;

    if (message.empty())
        return;

    if (
        message.find("before_handshake") != std::string::npos ||
        message.find("INC] NEW CONNECTION") != std::string::npos ||
        message.find("INC] CLOSE CONNECTION") != std::string::npos ||
        message.find("OUT] NEW CONNECTION") != std::string::npos ||
        message.find("OUT] CLOSE CONNECTION") != std::string::npos ||
        message.find("No available peer in gray list") != std::string::npos ||
        message.find("No available peer in white list") != std::string::npos ||
        message.find("bytes sent for category") != std::string::npos ||
        message.find("bytes received for category") != std::string::npos)
    {
        return;
    }

    {
        const auto p = message.find("HEIGHT ");
        const auto d = message.find(", difficulty:");

        if (
            p != std::string::npos &&
            d != std::string::npos &&
            d > p)
        {
            try
            {
                stats.height.store(
                    std::stoull(
                        message.substr(
                            p + 7,
                            d - p - 7)));

                const auto ds =
                    message.find_first_of(
                        "0123456789",
                        d + 13);

                if (ds != std::string::npos)
                {
                    const auto de =
                        message.find_first_not_of(
                            "0123456789",
                            ds);

                    stats.difficulty.store(
                        std::stoull(
                            message.substr(
                                ds,
                                de - ds)));
                }
            }
            catch (...)
            {
            }
        }
    }

    {
        const auto p =
            message.find("block reward: ");

        if (p != std::string::npos)
        {
            const auto e =
                message.find(
                    '(',
                    p + 14);

            if (e != std::string::npos)
            {
                stats.set_block_info(
                    "",
                    "",
                    message.substr(
                        p + 14,
                        e - p - 14));
            }
        }
    }

    static bool block_from_peer = false;

    if (
        message.find(
            "Received NOTIFY_NEW_FLUFFY_BLOCK") !=
            std::string::npos ||
        message.find(
            "Received NOTIFY_NEW_BLOCK") !=
            std::string::npos)
    {
        block_from_peer = true;
    }

    const bool block_added =
        message.find(
            "BLOCK SUCCESSFULLY ADDED") !=
            std::string::npos ||
        message.find("+++++") !=
            std::string::npos;

    if (block_added)
    {
        stats.blocks_added++;

        std::ostringstream event;

        if (block_from_peer)
        {
            event
                << "<<<<< BLOCK RECEIVED HEIGHT "
                << stats.height.load();

            stats.add_log(
                event.str(),
                LOG_NORMAL);

            block_from_peer = false;
        }
        else
        {
            event
                << "+++++ BLOCK MINED! HEIGHT "
                << stats.height.load();

            stats.add_log(
                event.str(),
                LOG_SUCCESS);
        }

        return;
    }

    if (
        message.find("ALTERNATIVE") !=
        std::string::npos)
    {
        stats.blocks_alt++;
        return;
    }

    if (
        message.find("initialized OK") !=
        std::string::npos ||
        message.find("synchronized") !=
        std::string::npos ||
        message.find("BLOCK") !=
        std::string::npos ||
        message.find("mining") !=
        std::string::npos ||
        message.find("Mining") !=
        std::string::npos)
    {
        stats.add_log(
            message,
            LOG_NORMAL);
    }
}

void CryLoTuiLogCallback::handle(
    const el::LogDispatchData* data)
{
    try
    {
        if (!data || !data->logMessage())
            return;

        const std::string& message =
            data->logMessage()->message();

        if (!message.empty())
            tui_log_handler(message);
    }
    catch (...)
    {
    }
}

void install_tui_log_callback()
{
    // The Windows dashboard owns the visible console. Keep normal daemon
    // logging active for file/callback consumers, but prevent Easylogging++
    // from writing directly to stdout while the dashboard is rendering.
    el::Configurations console_config;
    console_config.setGlobally(
        el::ConfigurationType::ToStandardOutput,
        "false");

    el::Loggers::reconfigureAllLoggers(console_config);

    el::Helpers::installLogDispatchCallback<
        CryLoTuiLogCallback>(
            "CryLoTuiCallback");
}

} // namespace crylotui