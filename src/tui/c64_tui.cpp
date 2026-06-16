#include "c64_tui.h"
#include <cstdlib>
#include <ctime>
#include <cstdio>
#include <unistd.h>
#include <fcntl.h>
#include <sys/ioctl.h>
#include <regex>
#include <algorithm>
#include <cstdio>
#include <array>
#include <cctype>
#include <sstream>


static std::string run_cmd(const char* cmd) {
    std::array<char, 512> buffer;
    std::string result;

    FILE* pipe = popen(cmd, "r");
    if (!pipe) return "";

    while (fgets(buffer.data(), buffer.size(), pipe) != nullptr)
        result += buffer.data();

    pclose(pipe);
    return result;
}


namespace c64tui {

// ---------- NodeStats ----------

static NodeStats g_stats;

static bool g_mining_active = false;
static int g_threads = 0;

NodeStats& get_stats() { return g_stats; }

void NodeStats::set_status(const std::string& s) {
    std::lock_guard<std::mutex> lock(mtx);
    status = s;
}

void NodeStats::add_log(const std::string& line, int color_type) {
    std::lock_guard<std::mutex> lock(mtx);
    log_lines.push_back({line, color_type});
    if (log_lines.size() > 500)
        log_lines.pop_front();
}

void NodeStats::set_block_info(const std::string& id, const std::string& pow, const std::string& reward) {
    std::lock_guard<std::mutex> lock(mtx);
    last_block_id = id;
    last_pow = pow;
    last_reward = reward;
}

// ---------- Datasette Animation ----------

void play_datasette_animation() {
    fprintf(stderr, "\033[2J\033[H"); // clear screen
    fflush(stderr);
    usleep(150000);

    fprintf(stderr, "\033[36m\n");
    fprintf(stderr, "      ██████╗██████╗ ██╗   ██╗██╗      ██████╗\n");
    fprintf(stderr, "     ██╔════╝██╔══██╗╚██╗ ██╔╝██║     ██╔═══██╗\n");
    fprintf(stderr, "     ██║     ██████╔╝ ╚████╔╝ ██║     ██║   ██║\n");
    fprintf(stderr, "     ██║     ██╔══██╗  ╚██╔╝  ██║     ██║   ██║\n");
    fprintf(stderr, "     ╚██████╗██║  ██║   ██║   ███████╗╚██████╔╝\n");
    fprintf(stderr, "      ╚═════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝ ╚═════╝\n\n");
    fprintf(stderr, "                CryLo Network Daemon\n");
    fprintf(stderr, "              FAST. PRIVATE. SECURE.\n\n");
    fprintf(stderr, "    ┌──────────────────────────────────────────────────────────────┐\n");
    fprintf(stderr, "    │  ◌  Connecting to CryLo Testnet v3        ............       │\n");
    fprintf(stderr, "    │  ⛓  Initializing P2P Network              ............       │\n");
    fprintf(stderr, "    │  ◈  Verifying Blockchain Integrity        ............       │\n");
    fprintf(stderr, "    │  ▣  Preparing for Synchronization         ............       │\n");
    fprintf(stderr, "    │  ≋  Sync in Progress                      [----------]       │\n");
    fprintf(stderr, "    └──────────────────────────────────────────────────────────────┘\n\n");
    fprintf(stderr, "\033[0m");

    const char* steps[] = {
        "Connecting to CryLo Testnet v3",
        "Initializing P2P Network",
        "Verifying Blockchain Integrity",
        "Preparing for Synchronization"
    };

    for (const char* step : steps) {
        fprintf(stderr, "\033[36m    [*] %s\033[0m", step);
        fflush(stderr);

        for (int i = 0; i < 12; ++i) {
            fprintf(stderr, "\033[36m.\033[0m");
            fflush(stderr);
            usleep(40000);
        }

        fprintf(stderr, " \033[32mOK\033[0m\n");
        fflush(stderr);
        usleep(100000);
    }

    fprintf(stderr, "\n    \033[32mREADY.\033[0m\n\n");
    fflush(stderr);
    usleep(300000);
}

// ---------- ncurses TUI ----------

// Color pair IDs
enum {
    CP_NORMAL = 1,
    CP_HEADER = 2,
    CP_SUCCESS = 3,
    CP_ERROR = 4,
    CP_WARNING = 5,
    CP_LOG_GREEN = 6,
    CP_LOG_BLUE = 7
};

static void init_colors() {
    start_color();
    if (can_change_color()) {
        init_color(20, 180, 180, 560);    // CryLo dark gray bg
        init_color(21, 420, 370, 710);    // CryLo light blue
        init_color(22, 1000, 1000, 1000); // White
        init_color(23, 700, 1000, 700);   // Green bright
        init_color(24, 1000, 400, 400);   // Red bright
        init_color(25, 1000, 1000, 700);  // Yellow bright
        init_color(26, 400, 900, 400);    // Log green
        init_color(27, 400, 600, 1000);   // Log blue
        init_pair(CP_NORMAL,    22, COLOR_BLACK);
	init_pair(CP_HEADER,    23, COLOR_BLACK);
	init_pair(CP_SUCCESS,   23, COLOR_BLACK);
	init_pair(CP_ERROR,     24, COLOR_BLACK);
	init_pair(CP_WARNING,   25, COLOR_BLACK);
	init_pair(CP_LOG_GREEN, 26, COLOR_BLACK);
	init_pair(CP_LOG_BLUE,  27, COLOR_BLACK);
    } else {
        init_pair(CP_NORMAL,    COLOR_WHITE,  COLOR_BLACK);
	init_pair(CP_HEADER,    COLOR_CYAN,   COLOR_BLACK);
	init_pair(CP_SUCCESS,   COLOR_GREEN,  COLOR_BLACK);
	init_pair(CP_ERROR,     COLOR_RED,    COLOR_BLACK);
	init_pair(CP_WARNING,   COLOR_YELLOW, COLOR_BLACK);
	init_pair(CP_LOG_GREEN, COLOR_GREEN,  COLOR_BLACK);
	init_pair(CP_LOG_BLUE,  COLOR_CYAN,   COLOR_BLACK);
    }
}

static void draw_border(int h, int w) {
    // Border disabled
}

static void draw_centered(int y, int w, const char* text, int cp) {
    int len = strlen(text);
    int x = (w - len) / 2;
    if (x < 0) x = 0;
    attron(COLOR_PAIR(cp) | A_BOLD);
    mvaddnstr(y, x, text, w);
    attroff(COLOR_PAIR(cp) | A_BOLD);
}

void run_tui(std::atomic<bool>& stop_signal) {
    static std::string input;
    static std::vector<std::string> command_output = {"Ready. Type help for commands."};
    auto start_time = std::chrono::steady_clock::now();
	g_mining_active = false;
	g_threads = 4;

    // Open /dev/tty directly so ncurses can read keyboard input
    FILE* tty = fopen("/dev/tty", "r+");
    if (!tty) {
    	tty = stdin;
    }

    SCREEN* scr = newterm(NULL, tty, tty);
    if (!scr) {
    	fprintf(stderr, "newterm() failed\n");
    	if (tty != stdin) fclose(tty);
    	return;
    }

    set_term(scr);

    cbreak();
    noecho();
    keypad(stdscr, TRUE);
    nodelay(stdscr, TRUE);
    curs_set(0);

    erase();
    refresh();

    init_colors();
    bkgd(COLOR_PAIR(CP_NORMAL));


    NodeStats& stats = get_stats();

    auto last_rpc_poll = std::chrono::steady_clock::now() - std::chrono::seconds(10);
    while (!stop_signal.load()) {
        // Poll RPC for peer count every 5 seconds
        {
            auto now_poll = std::chrono::steady_clock::now();
            if (std::chrono::duration_cast<std::chrono::seconds>(now_poll - last_rpc_poll).count() >= 5) {
                last_rpc_poll = now_poll;
                FILE* rpc = popen("curl -s http://127.0.0.1:22641/get_info 2>/dev/null", "r");
                if (rpc) {
                    char rb[4096]; std::string rd;
                    while (fgets(rb, sizeof(rb), rpc)) rd += rb;
                    pclose(rpc);

                    auto fv = [&](const char* k) -> uint64_t {
                        auto p = rd.find(k);
                        if (p == std::string::npos) return 0;
                        auto c = rd.find(':', p);
                        if (c == std::string::npos) return 0;
                        auto s = rd.find_first_of("0123456789", c);
                        if (s == std::string::npos) return 0;
                        return std::stoull(rd.substr(s));
                    };
                    try {
                        uint64_t h = fv("\"height\"");
                        uint64_t t = fv("\"target_height\"");

                        stats.height.store(h);
                        stats.target_height.store(t);
                        stats.synced.store(t == 0 || h >= t);

    			stats.difficulty.store(fv("\"difficulty\""));
    			stats.peers_out.store(fv("\"outgoing_connections_count\""));
    			stats.peers_in.store(fv("\"incoming_connections_count\""));
                    } catch (...) {}
                }
		FILE* ms = popen("curl -s http://127.0.0.1:22641/mining_status 2>/dev/null", "r");
		if (ms) {
    		    char mb[4096];
		    std::string md;

    		    while (fgets(mb, sizeof(mb),ms))
			md += mb;

		    pclose(ms);

    		    auto mv = [&](const char* k) -> uint64_t {
        		auto p = md.find(k);
        		if (p == std::string::npos) return 0;
        		auto c = md.find(':', p);
        		if (c == std::string::npos) return 0;
        		auto s = md.find_first_of("0123456789", c);
        		if (s == std::string::npos) return 0;
        		return std::stoull(md.substr(s));
    	    	    };

    	    	    try {
			stats.hashrate.store(mv("\"speed\""));

        		uint64_t reward_atomic = mv("\"block_reward\"");
        		double reward = (double)reward_atomic / 100000000000.0;

        		char reward_buf[64];
        		snprintf(reward_buf, sizeof(reward_buf), "%.11f", reward);

        		std::lock_guard<std::mutex> lock(stats.mtx);
        		stats.last_reward = reward_buf;
    	    	    } catch (...) {}
		}
	    }
	}
        int h, w;
        getmaxyx(stdscr, h, w);
        werase(stdscr);

        draw_border(h, w);

        int y = 2;

        // Header
        draw_centered(y++, w, "CryLo Network Daemon V3", CP_HEADER);
        draw_centered(y++, w, "64K RAM SYSTEM  38911 BASIC BYTES FREE", CP_NORMAL);
        y++;

        // Stats
        auto elapsed = std::chrono::steady_clock::now() - start_time;
        int uptime = std::chrono::duration_cast<std::chrono::seconds>(elapsed).count();
        int hrs = uptime / 3600, mins = (uptime % 3600) / 60, secs = uptime % 60;

        std::string status_str;
        {
            std::lock_guard<std::mutex> lock(stats.mtx);
            status_str = stats.status.empty() ? "LOADING BLOCKCHAIN..." : stats.status;
        }

        char buf[256];
        auto print_stat = [&](int idx, const char* key, const char* val, int cp) {
            snprintf(buf, sizeof(buf), "%-14s %s", key, val);
            attron(COLOR_PAIR(cp));
            mvaddnstr(y++, 3, buf, w - 6);
            attroff(COLOR_PAIR(cp));
        };

        char tmp[128];

        snprintf(tmp, sizeof(tmp), "%lu", stats.height.load());
        print_stat(1, "HEIGHT:", tmp, CP_NORMAL);

        snprintf(tmp, sizeof(tmp), "%lu", stats.difficulty.load());
        print_stat(2, "DIFFICULTY:", tmp, CP_NORMAL);

        snprintf(tmp, sizeof(tmp), "%lu", stats.blocks_added.load());
        // print_stat(3, "BLOCKS OK:", tmp, stats.blocks_added.load() > 0 ? CP_SUCCESS : CP_NORMAL);

        snprintf(tmp, sizeof(tmp), "%lu", stats.blocks_alt.load());
        // print_stat(4, "BLOCKS ALT:", tmp, stats.blocks_alt.load() > 0 ? CP_WARNING : CP_NORMAL);

        std::string reward_str;
        {
            std::lock_guard<std::mutex> lock(stats.mtx);
            reward_str = stats.last_reward.empty() ? "" : stats.last_reward;
        }
        snprintf(tmp, sizeof(tmp), "%s CryLo", reward_str.c_str());
        print_stat(3, "REWARD:", tmp, CP_NORMAL);

        // snprintf(tmp, sizeof(tmp), "%lu", stats.rpc_calls.load());
        // print_stat(4, "RPC CALLS:", tmp, CP_NORMAL);

        snprintf(tmp, sizeof(tmp), "%lu OUT / %lu IN",
		stats.peers_out.load(),
	 	stats.peers_in.load());

        print_stat(4, "PEERS:", tmp,
		stats.peers_out.load() +
		stats.peers_in.load() > 0 ?
		CP_SUCCESS : CP_WARNING);

	snprintf(tmp, sizeof(tmp), "%lu H/s",
             stats.hashrate.load());

	print_stat(5, "HASHRATE:", tmp,
           	stats.hashrate.load() > 0 ?
           	CP_SUCCESS : CP_WARNING);

        {
            uint64_t hr = stats.hashrate.load();
            uint64_t diff = stats.difficulty.load();

            if (hr > 0 && diff > 0) {
                uint64_t eta = diff / hr;
                uint64_t eta_days = eta / 86400;
                uint64_t eta_hours = (eta % 86400) / 3600;
                uint64_t eta_mins = (eta % 3600) / 60;
                uint64_t eta_secs = eta % 60;

                if (eta_days > 0) {
                    snprintf(tmp, sizeof(tmp), "%lud %luh %lum",
                             eta_days, eta_hours, eta_mins);
                } else if (eta_hours > 0) {
                    snprintf(tmp, sizeof(tmp), "%luh %lum %lus",
                             eta_hours, eta_mins, eta_secs);
                } else {
                    snprintf(tmp, sizeof(tmp), "%lum %lus",
                             eta_mins, eta_secs);
                }

                print_stat(6, "ETA BLOCK:", tmp, CP_NORMAL);
            } else {
                snprintf(tmp, sizeof(tmp), "—");
                print_stat(6, "ETA BLOCK:", tmp, CP_WARNING);
            }
        }

        {
            uint64_t h = stats.height.load();
            uint64_t t = stats.target_height.load();

	    if (stats.synced.load() || t == 0 || h >= t) {
                snprintf(tmp, sizeof(tmp), "SYNCED");
                print_stat(7, "SYNC:", tmp, CP_SUCCESS);
            } else {
                uint64_t pct = t > 0 ? (h * 100 / t) : 0;
                uint64_t remaining = t > h ? t - h : 0;
                uint64_t eta_seconds = remaining * 210;

                uint64_t eta_hours = eta_seconds / 3600;
                uint64_t eta_mins = (eta_seconds % 3600) / 60;

                snprintf(tmp, sizeof(tmp), "%lu / %lu (%lu%%) ETA %luh %lum",
                         h, t, pct, eta_hours, eta_mins);
                print_stat(7, "SYNC:", tmp, CP_WARNING);
            }
        }
        snprintf(tmp, sizeof(tmp), "%02d:%02d:%02d", hrs, mins, secs);
        print_stat(8, "UPTIME:", tmp, CP_NORMAL);

	snprintf(tmp, sizeof(tmp), "%s", g_mining_active ? "STARTED" : "PAUSED");
	print_stat(9, "MINING:", tmp, g_mining_active ? CP_SUCCESS : CP_WARNING);

	snprintf(tmp, sizeof(tmp), "%d", g_threads);
	print_stat(10, "THREADS:", tmp, CP_NORMAL);

	y += 3;

	// Command input / output lines
	attron(COLOR_PAIR(CP_HEADER) | A_BOLD);
	mvprintw(h - 7, 3, "COMMAND: %-100s", input.c_str());
	mvprintw(h - 6, 3, "OUTPUT :");
	for (size_t oi = 0; oi < command_output.size() && oi < 5; ++oi) {
	    mvprintw(h - 5 + oi, 5, "%-100s", command_output[oi].c_str());
	}
	attroff(COLOR_PAIR(CP_HEADER) | A_BOLD);

	// Help hint
	attron(COLOR_PAIR(CP_NORMAL) | A_BOLD);
	mvprintw(h - 1, 3, "TYPE: help  |  start_mining <wallet> <threads>  |  stop_mining");
	attroff(COLOR_PAIR(CP_NORMAL) | A_BOLD);

        // Footer
        move(h - 1, 0);
	clrtoeol();
	draw_centered(h - 1, w,
	    "CryLo Chain (C) 2026",
	    CP_HEADER);

        refresh();

        // Draw mining status from daemon RPC
	std::string mining_status = run_cmd(
    	    "curl -s http://127.0.0.1:22641/mining_status"
	);

	bool mining_on =
    	    mining_status.find("\"active\": true") != std::string::npos ||
    	    mining_status.find("\"active\":true") != std::string::npos;

	g_mining_active = mining_on;

	if (!g_mining_active)
    	    g_threads = 0;

	size_t speed_pos = mining_status.find("\"speed\":");
	std::string speed = "0";

	if (speed_pos != std::string::npos) {
    	    speed_pos = mining_status.find(":", speed_pos);

    	    if (speed_pos != std::string::npos) {
                speed_pos++;

        	while (speed_pos < mining_status.size() &&
                      (mining_status[speed_pos] == ' ' ||
                       mining_status[speed_pos] == '\t'))
        {
            speed_pos++;
        }

        size_t speed_end = speed_pos;

        while (speed_end < mining_status.size() &&
              (isdigit(mining_status[speed_end]) ||
               mining_status[speed_end] == '.'))
        {
            speed_end++;
        }

        speed = mining_status.substr(
            speed_pos,
            speed_end - speed_pos
        );
    }
}

	//  mvprintw(LINES - 5, 2, "MINING: %s", mining_on ? "STARTED" : "STOPPED");
	//mvprintw(LINES - 4, 2, "HASHRATE: %s H/s", speed.c_str());

	// Draw command line
	// move(LINES - 2, 0);
	// clrtoeol();
	// mvprintw(LINES - 2, 2, "READY. %s", input.c_str());
	// move(LINES - 2, 9 + input.size());
	// refresh();

	for (int i = 0; i < 20 && !stop_signal.load(); i++) {
    	    int ch = getch();

    	    if (ch == 27) {
    		stop_signal.store(true);
    		break;
	    }

	    if ((ch == 'q' || ch == 'Q') && input.empty()) {
    		stop_signal.store(true);
    		break;
	    }

    	    if (ch == '\n' || ch == '\r' || ch == 10) {
        	if (!input.empty()) {
            	    if (input.rfind("start_mining ", 0) == 0) {
    			std::istringstream iss(input);
    			std::string command, address;
    			int threads = 1;

    			iss >> command >> address >> threads;

    			if (!address.empty() && threads > 0) {
        		    std::string cmd =
            			"curl -s http://127.0.0.1:22641/start_mining "
            			"-H 'Content-Type: application/json' "
            			"-d '{\"miner_address\":\"" + address +
            			"\",\"threads_count\":" + std::to_string(threads) +
            			",\"do_background_mining\":false,"
            			"\"ignore_battery\":true}'";

        		    { int rc = system(cmd.c_str()); (void)rc; }

        		    g_mining_active = true;
        		    g_threads = threads;
    			}
		    }

            	    if (input == "stop_mining") {
                	{ int rc = system("curl -s http://127.0.0.1:22641/stop_mining -d '{}' -H 'Content-Type: application/json'"); (void)rc; }

			g_mining_active = false;
			g_threads = 0;
            	    }

            	    if (input == "mining_status") {
                	{ int rc = system("curl -s http://127.0.0.1:22641/mining_status"); (void)rc; }
            	    }

            	    if (input == "help") {
                	command_output = {
                    "Commands:",
                    "help | status | sync | height | peers | version",
                    "mining_status | start_mining <wallet> <threads>",
                    "stop_mining | clear"
                };
            	    }

            	    if (input == "status") {
                	command_output = {
                    "Height : " + std::to_string(stats.height.load()),
                    "Peers  : " + std::to_string(stats.peers_out.load()) + " OUT / " +
                               std::to_string(stats.peers_in.load()) + " IN",
                    "Sync   : " + std::string(stats.synced.load() ? "SYNCED" : "SYNCING"),
                    "Mining : " + std::string(g_mining_active ? "STARTED" : "PAUSED")
                };
            	    }

            	    if (input == "sync") {
                	stats.set_status("Sync: " + std::string(stats.synced.load() ? "SYNCED" : "SYNCING") + " | height " + std::to_string(stats.height.load()));
            	    }

            	    if (input == "height") {
                	command_output = {
                    "Height: " + std::to_string(stats.height.load())
                };
            	    }

            	    if (input == "peers") {
                	command_output = {
                    	    "Peers OUT: " + std::to_string(stats.peers_out.load()),
                    	    "Peers IN : " + std::to_string(stats.peers_in.load())
                	};
            	    }

            	    if (input == "version") {
                	command_output = {
                    "CryLo Testnet v3",
                    "P2P Port : 22640",
                    "RPC Port : 22641",
                    "Build    : Nexus-ready daemon"
                };
            	    }

            	    if (input == "clear") {
                	stats.log_lines.clear();
                	command_output = {"Console cleared."};
            	    }

            	    input.clear();
        	}
    	    } else if (ch == KEY_BACKSPACE || ch == 127 || ch == 8) {
        	if (!input.empty()) input.pop_back();
    	    } else if (ch >= 32 && ch <= 126) {
        	input.push_back((char)ch);

	    }

    	    usleep(20000);
	}
    }

    endwin();
    if (scr) delscreen(scr);
    if (tty) fclose(tty);
}

// ---------- Log handler ----------

void tui_log_handler(const std::string& message) {
    NodeStats& stats = get_stats();
    stats.log_msgs_received++;
    if (message.empty()) return;

    // Filter out connection spam (NEW/CLOSE CONNECTION + before_handshake)
    if (message.find("before_handshake") != std::string::npos) return;
    if (message.find("INC] NEW CONNECTION") != std::string::npos) return;
    if (message.find("INC] CLOSE CONNECTION") != std::string::npos) return;
    if (message.find("No available peer in gray list") != std::string::npos) return;
    if (message.find("No available peer in white list") != std::string::npos) return;
    if (message.find("Failed to connect to any") != std::string::npos) return;
    if (message.find("OUT] NEW CONNECTION") != std::string::npos) return;
    if (message.find("OUT] CLOSE CONNECTION") != std::string::npos) return;
    if (message.find("bytes sent for category") != std::string::npos) return;
    if (message.find("bytes received for category") != std::string::npos) return;
    if (message.find("COMMAND_HANDSHAKE") != std::string::npos) return;
    if (message.find("Failed to HANDSHAKE") != std::string::npos) return;
    if (message.find("Failed to invoke command") != std::string::npos) return;
    if (message.find("switching safe mode") != std::string::npos) return;
    if (message.find("clearing used stripe") != std::string::npos) return;
    if (message.find("Resolving node address") != std::string::npos) return;
    if (message.find("Added node:") != std::string::npos) return;
    if (message.find("state: requesting") != std::string::npos) return;
    if (message.find("NOTIFY_GET_TXPOOL") != std::string::npos) return;
    if (message.find("NOTIFY_NEW_TRANSACTIONS") != std::string::npos) return;
    if (message.find("0Connect failed") != std::string::npos) return;
    if (message.find("pruning seed") != std::string::npos) return;

    // --- Always update stats from raw message ---

    // HEIGHT XXXX, difficulty: YYY
    {
        auto p = message.find("HEIGHT ");
        auto d = message.find(", difficulty:");
        if (p != std::string::npos && d != std::string::npos && d > p) {
            try {
                uint64_t h = std::stoull(message.substr(p + 7, d - p - 7));
                auto ds = message.find_first_of("0123456789", d + 13);
                if (ds != std::string::npos) {
                    auto de = message.find_first_not_of("0123456789", ds);
                    uint64_t dv = std::stoull(message.substr(ds, de - ds));
                    stats.height.store(h);
                    stats.difficulty.store(dv);
                    stats.set_status("MINING");
                }
            } catch (...) {}
        }
    }

    // "last block: XXXX,"
    {
        auto p = message.find("last block: ");
        if (p != std::string::npos) {
            try {
                stats.height.store(std::stoull(message.substr(p + 12)));
                stats.set_status("READY");
            } catch (...) {}
        }
    }

    // "block reward: XXX("
    {
        auto p = message.find("block reward: ");
        if (p != std::string::npos) {
            auto e = message.find('(', p + 14);
            if (e != std::string::npos)
                stats.set_block_info("", "", message.substr(p + 14, e - p - 14));
        }
    }

    // "id:   <hash>"
    {
        auto p = message.find("id:");
        if (p != std::string::npos) {
            auto lt = message.find('<', p);
            auto gt = message.find('>', lt != std::string::npos ? lt : 0);
            if (lt != std::string::npos && gt != std::string::npos && gt > lt) {
                std::lock_guard<std::mutex> lock(stats.mtx);
                stats.last_block_id = message.substr(lt + 1, gt - lt - 1);
            }
        }
    }

    // "PoW:  <hash>"
    {
        auto p = message.find("PoW:");
        if (p != std::string::npos) {
            auto lt = message.find('<', p);
            auto gt = message.find('>', lt != std::string::npos ? lt : 0);
            if (lt != std::string::npos && gt != std::string::npos && gt > lt) {
                std::lock_guard<std::mutex> lock(stats.mtx);
                stats.last_pow = message.substr(lt + 1, gt - lt - 1);
            }
        }
    }

    // RPC calls
    if (message.find("Calling RPC") != std::string::npos)
        stats.rpc_calls++;

    // Track blocks received from peers
    static bool block_from_peer = false;
    if (message.find("Received NOTIFY_NEW_FLUFFY_BLOCK") != std::string::npos ||
        message.find("Received NOTIFY_NEW_BLOCK") != std::string::npos) {
        block_from_peer = true;
    }
    // Block counts + generate clean log entries
    bool is_block_added = (message.find("BLOCK SUCCESSFULLY ADDED") != std::string::npos ||
                           message.find("+++++") != std::string::npos);
    bool is_alt_block = (message.find("ALTERNATIVE") != std::string::npos);

    if (is_block_added) {
        stats.blocks_added++;
        char buf[128];
        if (block_from_peer) {
            snprintf(buf, sizeof(buf), "<<<<< BLOCK RECEIVED HEIGHT %lu", stats.height.load());
            stats.add_log(std::string(buf), LOG_NORMAL);
            block_from_peer = false;
        } else {
            stats.set_status("MINING");
            snprintf(buf, sizeof(buf), "+++++ BLOCK MINED! HEIGHT %lu", stats.height.load());
            stats.add_log(std::string(buf), LOG_SUCCESS);
        }
        return;
    }

    if (is_alt_block) {
        stats.blocks_alt++;
        // Don't log alt blocks - too noisy at low difficulty
        return;
    }

    // --- Filter out noisy messages for display ---
    static const char* filters[] = {
        "build/bin/", "__cxa_throw", "Unwound call", "bad_alloc",
        "Exception:", "libboost", "libc.so", "PERF", "HTTP [",
        "POST /json", "GET /get", "Calling RPC", "calling /",
        "Setting LIMIT", "Set limit-", "coinbase_weight",
        "submitblock", "getblocktemplate", "net_service",
        "Starting core", "Starting p2p", "ZMQ", "Set server type",
        "Binding on", "prefix_name", "block reward:", "PoW:",
        "difficulty:", "cumulative", "Run net_service",
        nullptr
    };
    for (int i = 0; filters[i]; i++) {
        if (message.find(filters[i]) != std::string::npos) {
            // Exception: keep lines with "HEIGHT" or "Blockchain" or "BLOCK"
            if (message.find("HEIGHT") != std::string::npos) break;
            if (message.find("Blockchain") != std::string::npos) break;
            if (message.find("BLOCK") != std::string::npos) break;
            return;
        }
    }

    // Also filter "id:  <" lines that aren't block messages
    if (message.find("id:") != std::string::npos && message.find("BLOCK") == std::string::npos)
        return;

    // Determine color
    int color = LOG_NORMAL;
    if (message.find("error") != std::string::npos || message.find("ERROR") != std::string::npos)
        color = LOG_ERROR;
    else if (message.find("initialized OK") != std::string::npos || message.find("READY") != std::string::npos)
        color = LOG_SUCCESS;

    // Strip timestamp prefix "2026-02-11 14:59:56.260     I "
    std::string clean = message;
    auto ts = clean.find(" I ");
    if (ts != std::string::npos && ts < 30)
        clean = clean.substr(ts + 3);
    // Also try " W ", " E " etc
    if (clean == message) {
        for (const char* lvl : {" W ", " E ", " D "}) {
            auto p = clean.find(lvl);
            if (p != std::string::npos && p < 30) {
                clean = clean.substr(p + 3);
                break;
            }
        }
    }

    if (!clean.empty()) {
        // Anti-spam: normalize connection messages (strip UUID and port)
        static std::string last_msg;
        static int repeat_count = 0;
        std::string cmp = clean;
        // Strip UUID patterns (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
        while (true) {
            auto p = cmp.find_first_of("0123456789abcdef");
            if (p == std::string::npos) break;
            // Check if this looks like a UUID (8-4-4-4-12 with dashes)
            if (p + 36 <= cmp.size() && cmp[p+8] == '-' && cmp[p+13] == '-') {
                cmp.erase(p, 36);
            } else break;
        }
        // Strip port numbers after IPs (e.g. :42340 -> :*)
        for (size_t i = 0; i < cmp.size(); i++) {
            if (cmp[i] == ':' && i + 1 < cmp.size() && isdigit(cmp[i+1])) {
                size_t j = i + 1;
                while (j < cmp.size() && isdigit(cmp[j])) j++;
                cmp.replace(i+1, j-i-1, "*");
            }
        }
        if (cmp == last_msg) {
            repeat_count++;
            if (repeat_count == 5) {
                stats.add_log("  ... (repeated messages hidden)", LOG_WARNING);
            }
            // Only show every 50th repeat after that
            if (repeat_count > 5 && repeat_count % 50 != 0) return;
        } else {
            repeat_count = 0;
            last_msg = cmp;
        }
        stats.add_log(clean, color);
    }
}
// ---------- Easylogging++ Callback ----------

void CryLoTuiLogCallback::handle(const el::LogDispatchData* data) {
    try {
        if (!data || !data->logMessage()) return;

        const std::string& msg = data->logMessage()->message();
        if (msg.empty()) return;

        // Forward to TUI log handler
        tui_log_handler(msg);
    } catch (...) {
        // Never let exceptions escape the log callback
    }
}

void install_tui_log_callback() {
    el::Helpers::installLogDispatchCallback<CryLoTuiLogCallback>("CryLoTuiCallback");
}

} // namespace c64tui
