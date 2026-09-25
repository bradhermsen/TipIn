#ifndef SCOREBOARD_H
#define SCOREBOARD_H

#include <Arduino.h>
#include <vector>

// -----------------------------------------------------------------------------
// Data Structures
// -----------------------------------------------------------------------------
enum ScoreboardVendor {
    VENDOR_NEVCO,
    VENDOR_FAIRPLAY,
    VENDOR_DAKTRONICS,
    VENDOR_ELECTRO_MECH
};

struct Penalty {
    int playerNumber;
    int secondsRemaining;
    bool active;
};

// -----------------------------------------------------------------------------
// Global Extern Variables
// -----------------------------------------------------------------------------
extern ScoreboardVendor currentVendor;
extern unsigned long serialRxByteCount;
extern unsigned long serialLastRxMillis;

// Penalty Tracking
extern Penalty penalties[8];
extern std::vector<Penalty> homePenalties;
extern std::vector<Penalty> awayPenalties;
extern int penaltyCount;

// Controls whether fake data generation is active
extern bool emulatorModeActive;

// --- Live Scoreboard & Clock State ---
extern bool clockRunning;
extern int clockMin;
extern int clockSec;
extern int clockTenths;      // Sub-minute tenths of a second (0-9)
extern int homeScore;
extern int awayScore;
extern int homeShots;
extern int awayShots;
extern int currentPeriod;

// -----------------------------------------------------------------------------
// Function Prototypes
// -----------------------------------------------------------------------------
void scoreboard_begin();
void scoreboard_loop();

// Control & State Override API Handlers
void scoreboard_start_clock();
void scoreboard_stop_clock();
void scoreboard_set_state(int home, int away, int period);
void scoreboard_set_vendor(const String& vendorStr);
void scoreboard_set_mirror(bool enable);
void scoreboard_set_emulator(bool enable);
String scoreboard_get_serial_trace();

#endif // SCOREBOARD_H