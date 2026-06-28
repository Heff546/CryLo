#include "crylo_loading.h"

#include <cstdio>

#ifdef _WIN32
#include <windows.h>
static void crylo_sleep_us(unsigned int usec) { Sleep((usec + 999) / 1000); }
#else
#include <unistd.h>
static void crylo_sleep_us(unsigned int usec) { usleep(usec); }
#endif

namespace crylotui {

void play_crylo_loading_screen(const char* title) {
    fprintf(stderr, "\033[2J\033[H"); // clear screen
    fflush(stderr);
    crylo_sleep_us(150000);

    fprintf(stderr, "\033[36m\n");
    fprintf(stderr, "      ██████╗██████╗ ██╗   ██╗██╗      ██████╗\n");
    fprintf(stderr, "     ██╔════╝██╔══██╗╚██╗ ██╔╝██║     ██╔═══██╗\n");
    fprintf(stderr, "     ██║     ██████╔╝ ╚████╔╝ ██║     ██║   ██║\n");
    fprintf(stderr, "     ██║     ██╔══██╗  ╚██╔╝  ██║     ██║   ██║\n");
    fprintf(stderr, "     ╚██████╗██║  ██║   ██║   ███████╗╚██████╔╝\n");
    fprintf(stderr, "      ╚═════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝ ╚═════╝\n\n");
    fprintf(stderr, "                %s\n", title);
    fprintf(stderr, "              FAST. PRIVATE. SECURE.\n\n");
    fprintf(stderr, "    ┌──────────────────────────────────────────────────────────────┐\n");
    fprintf(stderr, "    │  ◌  Connecting to CryLo Testnet V4        ............       │\n");
    fprintf(stderr, "    │  ⛓  Initializing P2P Network              ............       │\n");
    fprintf(stderr, "    │  ◈  Verifying Blockchain Integrity        ............       │\n");
    fprintf(stderr, "    │  ▣  Preparing for Synchronization         ............       │\n");
    fprintf(stderr, "    │  ≋  Sync in Progress                      [----------]       │\n");
    fprintf(stderr, "    └──────────────────────────────────────────────────────────────┘\n\n");
    fprintf(stderr, "\033[0m");

    const char* steps[] = {
        "Connecting to CryLo Testnet V4",
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
            crylo_sleep_us(40000);
        }

        fprintf(stderr, " \033[32mOK\033[0m\n");
        fflush(stderr);
        crylo_sleep_us(100000);
    }

    fprintf(stderr, "\n    \033[32mREADY.\033[0m\n\n");
    fflush(stderr);
    crylo_sleep_us(300000);
}

} // namespace crylotui
