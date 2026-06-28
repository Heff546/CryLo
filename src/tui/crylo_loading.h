#pragma once

namespace crylotui {

// Shared CryLo startup animation used by CLI entry points before any ncurses UI starts.
void play_crylo_loading_screen(const char* title = "CryLo Network Daemon Testnet V4");

} // namespace crylotui
