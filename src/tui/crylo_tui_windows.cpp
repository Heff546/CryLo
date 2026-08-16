#include "crylo_tui.h"

namespace crylotui {

static NodeStats g_stats;

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

void tui_log_handler(const std::string& message)
{
    NodeStats& stats = get_stats();
    stats.log_msgs_received++;

    if (!message.empty())
        stats.add_log(message, LOG_NORMAL);
}

void play_datasette_animation()
{
    // POSIX terminal animation is intentionally disabled on Windows.
}

void run_tui(std::atomic<bool>& stop_signal)
{
    // The Windows Electron release runs the daemon without the POSIX ncurses TUI.
    (void)stop_signal;
}

void CryLoTuiLogCallback::handle(const el::LogDispatchData* data)
{
    // Windows does not install the TUI logging callback.
    (void)data;
}

void install_tui_log_callback()
{
    // No-op on Windows.
}

} // namespace crylotui
