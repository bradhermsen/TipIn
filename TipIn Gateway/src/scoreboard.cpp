#include "scoreboard.h"

#include <ctype.h>

// Global Variable Definitions
ScoreboardVendor currentVendor = VENDOR_DAKTRONICS;
unsigned long serialRxByteCount = 0;
unsigned long serialLastRxMillis = 0;
Penalty penalties[8];
std::vector<Penalty> homePenalties;
std::vector<Penalty> awayPenalties;
int penaltyCount = 0;

// Emulator flag definition (default true until physical feed connects)
bool emulatorModeActive = true;

// Shared Live Scoreboard State (Accessed by main.cpp / REST API)
bool clockRunning = false;
int clockMin = 17;
int clockSec = 0;
int clockTenths = 0;

int homeScore = 0;
int awayScore = 0;
int homeShots = 0;
int awayShots = 0;
int currentPeriod = 1;

// Internal State Variables (Used only within scoreboard.cpp)
static bool serialMirroringEnabled = false;
static unsigned long lastClockTick = 0;
static String dakLineBuffer = "";
constexpr size_t SERIAL_TRACE_CAPACITY = 1600;
constexpr size_t DAK_FRAME_CAPACITY = 240;
static char serialTraceBuffer[SERIAL_TRACE_CAPACITY];
static size_t serialTraceStart = 0;
static size_t serialTraceLength = 0;
static char dakFrameBuffer[DAK_FRAME_CAPACITY + 1];
static size_t dakFrameLength = 0;
static bool dakFrameActive = false;

static void appendSerialTrace(const char* text, size_t length) {
    for (size_t i = 0; i < length; i++) {
        if (serialTraceLength < SERIAL_TRACE_CAPACITY) {
            size_t writeIndex = (serialTraceStart + serialTraceLength) % SERIAL_TRACE_CAPACITY;
            serialTraceBuffer[writeIndex] = text[i];
            serialTraceLength++;
        } else {
            serialTraceBuffer[serialTraceStart] = text[i];
            serialTraceStart = (serialTraceStart + 1) % SERIAL_TRACE_CAPACITY;
        }
    }
}

static int parseFixedInt(const char* frame, size_t start, size_t length, int fallback) {
    int value = 0;
    bool foundDigit = false;

    for (size_t i = start; i < start + length; i++) {
        char character = frame[i];
        if (character >= '0' && character <= '9') {
            foundDigit = true;
            value = (value * 10) + (character - '0');
        }
    }

    return foundDigit ? value : fallback;
}

static void setFixedPenaltySlot(
    std::vector<Penalty>& team,
    int slotIndex,
    const char* frame,
    size_t frameLength,
    size_t fieldStart
) {
    while ((int)team.size() <= slotIndex) {
        team.push_back(Penalty{0, 0, false});
    }

    Penalty& penalty = team[slotIndex];
    if (fieldStart + 7 > frameLength || frame[fieldStart + 4] != ':') {
        penalty = Penalty{0, 0, false};
        return;
    }

    int playerNumber = parseFixedInt(frame, fieldStart, 2, -1);
    int minutes = parseFixedInt(frame, fieldStart + 3, 1, -1);
    int seconds = parseFixedInt(frame, fieldStart + 5, 2, -1);

    if (
        playerNumber <= 0 ||
        minutes < 0 ||
        seconds < 0 ||
        seconds > 59
    ) {
        penalty = Penalty{0, 0, false};
        return;
    }

    penalty.playerNumber = playerNumber;
    penalty.secondsRemaining = (minutes * 60) + seconds;
    penalty.active = penalty.secondsRemaining > 0;
}

static int parseIntSafe(const String& text, int fallback) {
    if (text.length() == 0) return fallback;
    return text.toInt();
}

static int clampInt(int value, int minV, int maxV) {
    if (value < minV) return minV;
    if (value > maxV) return maxV;
    return value;
}

static void parseClockField(const String& raw) {
    String value = raw;
    value.trim();

    // Supports MM:SS and MM:SS.T formats.
    int colon = value.indexOf(':');
    if (colon <= 0) return;

    String minPart = value.substring(0, colon);
    String secPart = value.substring(colon + 1);

    int tenths = 0;
    int dot = secPart.indexOf('.');
    if (dot >= 0) {
        String tenthsPart = secPart.substring(dot + 1);
        secPart = secPart.substring(0, dot);
        tenths = clampInt(parseIntSafe(tenthsPart, 0), 0, 9);
    }

    int mm = clampInt(parseIntSafe(minPart, clockMin), 0, 99);
    int ss = clampInt(parseIntSafe(secPart, clockSec), 0, 59);

    clockMin = mm;
    clockSec = ss;
    clockTenths = (clockMin == 0) ? tenths : 0;
}

static void setPenaltySlot(std::vector<Penalty>& team, int slotIndex, const String& raw) {
    if (slotIndex < 0 || slotIndex > 1) return;

    String value = raw;
    value.trim();

    if (value.length() == 0 || value == "0" || value == "NONE" || value == "OFF") {
        if (slotIndex < (int)team.size()) {
            team[slotIndex].active = false;
            team[slotIndex].secondsRemaining = 0;
            team[slotIndex].playerNumber = 0;
        }
        return;
    }

    int comma = value.indexOf(',');
    if (comma <= 0) return;

    String playerPart = value.substring(0, comma);
    String timePart = value.substring(comma + 1);
    int colon = timePart.indexOf(':');
    if (colon <= 0) return;

    int player = clampInt(parseIntSafe(playerPart, 0), 0, 99);
    int mm = clampInt(parseIntSafe(timePart.substring(0, colon), 0), 0, 99);
    int ss = clampInt(parseIntSafe(timePart.substring(colon + 1), 0), 0, 59);

    Penalty p;
    p.playerNumber = player;
    p.secondsRemaining = (mm * 60) + ss;
    p.active = p.secondsRemaining > 0;

    while ((int)team.size() <= slotIndex) {
        Penalty empty;
        empty.playerNumber = 0;
        empty.secondsRemaining = 0;
        empty.active = false;
        team.push_back(empty);
    }

    team[slotIndex] = p;
}

static void applyDakField(const String& rawKey, const String& rawValue) {
    String key = rawKey;
    String value = rawValue;
    key.trim();
    value.trim();
    key.toUpperCase();

    if (key == "CLK" || key == "CLOCK" || key == "TIME") {
        parseClockField(value);
    } else if (key == "PER" || key == "PERIOD") {
        currentPeriod = clampInt(parseIntSafe(value, currentPeriod), 1, 9);
    } else if (key == "HOME" || key == "HOM" || key == "HSCORE") {
        homeScore = clampInt(parseIntSafe(value, homeScore), 0, 99);
    } else if (key == "AWAY" || key == "AWY" || key == "ASCORE") {
        awayScore = clampInt(parseIntSafe(value, awayScore), 0, 99);
    } else if (key == "HSHOTS" || key == "SHOTH" || key == "HSH") {
        homeShots = clampInt(parseIntSafe(value, homeShots), 0, 199);
    } else if (key == "ASHOTS" || key == "SHOTA" || key == "ASH") {
        awayShots = clampInt(parseIntSafe(value, awayShots), 0, 199);
    } else if (key == "RUN" || key == "CLOCKRUN" || key == "RUNNING") {
        String run = value;
        run.toUpperCase();
        clockRunning = (run == "1" || run == "TRUE" || run == "ON" || run == "RUN");
    } else if (key == "HP1") {
        setPenaltySlot(homePenalties, 0, value);
    } else if (key == "HP2") {
        setPenaltySlot(homePenalties, 1, value);
    } else if (key == "AP1") {
        setPenaltySlot(awayPenalties, 0, value);
    } else if (key == "AP2") {
        setPenaltySlot(awayPenalties, 1, value);
    }
}

static void parseDaktronicsLine(const String& rawLine) {
    if (currentVendor != VENDOR_DAKTRONICS) return;

    String line = rawLine;
    line.trim();
    if (line.length() == 0) return;

    // Accept comma/semicolon/pipe separated key=value tokens.
    int start = 0;
    while (start < line.length()) {
        int end = line.length();
        int comma = line.indexOf(',', start);
        int semi = line.indexOf(';', start);
        int pipe = line.indexOf('|', start);

        if (comma >= 0 && comma < end) end = comma;
        if (semi >= 0 && semi < end) end = semi;
        if (pipe >= 0 && pipe < end) end = pipe;

        String token = line.substring(start, end);
        token.trim();

        int eq = token.indexOf('=');
        if (eq > 0) {
            String key = token.substring(0, eq);
            String value = token.substring(eq + 1);
            applyDakField(key, value);
        }

        start = end + 1;
    }
}

static bool parseDaktronicsCgFrame(const char* frame, size_t frameLength) {
    if (currentVendor != VENDOR_DAKTRONICS) return false;

    if (frameLength >= 19 && frame[2] == ':') {
        clockMin = clampInt(parseFixedInt(frame, 0, 2, clockMin), 0, 99);
        clockSec = clampInt(parseFixedInt(frame, 3, 2, clockSec), 0, 59);
        clockTenths = 0;
        clockRunning = frame[7] != 's' && frame[7] != 'S';
        homeScore = clampInt(parseFixedInt(frame, 8, 2, homeScore), 0, 199);
        awayScore = clampInt(parseFixedInt(frame, 10, 2, awayScore), 0, 199);
        homeShots = clampInt(parseFixedInt(frame, 13, 3, homeShots), 0, 199);
        awayShots = clampInt(parseFixedInt(frame, 16, 2, awayShots), 0, 199);
        currentPeriod = clampInt(parseFixedInt(frame, 18, 1, currentPeriod), 1, 9);

        if (frameLength >= 48) {
            setFixedPenaltySlot(homePenalties, 0, frame, frameLength, 20);
            setFixedPenaltySlot(homePenalties, 1, frame, frameLength, 27);
            setFixedPenaltySlot(awayPenalties, 0, frame, frameLength, 34);
            setFixedPenaltySlot(awayPenalties, 1, frame, frameLength, 41);
        }
        return true;
    }

    String fallbackFrame(frame, frameLength);
    fallbackFrame.trim();
    if (fallbackFrame.length() == 0) return false;

    String fields[8];
    int fieldCount = 0;
    int cursor = 0;

    while (cursor < fallbackFrame.length() && fieldCount < 8) {
        while (cursor < fallbackFrame.length() && isspace((unsigned char)fallbackFrame[cursor])) cursor++;
        if (cursor >= fallbackFrame.length()) break;

        int fieldStart = cursor;
        while (cursor < fallbackFrame.length() && !isspace((unsigned char)fallbackFrame[cursor])) cursor++;
        fields[fieldCount++] = fallbackFrame.substring(fieldStart, cursor);
    }

    // Fallback for whitespace-delimited test feeds.
    if (fieldCount != 8 || fields[0].indexOf(':') <= 0) return false;

    parseClockField(fields[0]);

    String clockStatus = fields[1];
    clockStatus.toUpperCase();
    clockRunning = clockStatus == "R" || clockStatus == "1" || clockStatus == "RUN";

    homeScore = clampInt(parseIntSafe(fields[2], homeScore), 0, 199);
    awayScore = clampInt(parseIntSafe(fields[3], awayScore), 0, 199);
    homeShots = clampInt(parseIntSafe(fields[4], homeShots), 0, 199);
    awayShots = clampInt(parseIntSafe(fields[5], awayShots), 0, 199);
    currentPeriod = clampInt(parseIntSafe(fields[6], currentPeriod), 1, 9);
    return true;
}

// -----------------------------------------------------------------------------
// Helper & Parsing Functions
// -----------------------------------------------------------------------------
static void processIncomingSerialByte(uint8_t byteIn) {
    serialRxByteCount++;
    serialLastRxMillis = millis();

    // AUTO-DISABLE EMULATOR MODE WHEN HARDWARE DATA ARRIVES ON MAX3232
    if (emulatorModeActive) {
        emulatorModeActive = false;
        Serial.println("[Scoreboard] Physical MAX3232 feed detected! Disabling Emulator Mode.");
    }

    // Keep control/framing bytes visible in a fixed ring buffer.
    if (byteIn == '\r') {
        appendSerialTrace("<CR>\n", 5);
    } else if (byteIn == '\n') {
        appendSerialTrace("<LF>\n", 5);
    } else if (isprint(byteIn)) {
        char printable = (char)byteIn;
        appendSerialTrace(&printable, 1);
    } else {
        char escapedByte[7];
        snprintf(escapedByte, sizeof(escapedByte), "<%02X>", byteIn);
        appendSerialTrace(escapedByte, 4);
    }

    if (serialMirroringEnabled) {
        Serial.write(byteIn);
    }

    // Native All Sport CG frames are delimited by SOH (0x01) and EOT (0x04).
    if (byteIn == 0x01) {
        dakFrameLength = 0;
        dakFrameBuffer[0] = '\0';
        dakFrameActive = true;
        return;
    }

    if (dakFrameActive) {
        if (byteIn == 0x04) {
            dakFrameBuffer[dakFrameLength] = '\0';
            parseDaktronicsCgFrame(dakFrameBuffer, dakFrameLength);
            dakFrameLength = 0;
            dakFrameActive = false;
            return;
        }

        if (isprint(byteIn) || byteIn == '\t') {
            if (dakFrameLength < DAK_FRAME_CAPACITY) {
                dakFrameBuffer[dakFrameLength++] = (char)byteIn;
            }
        }
        return;
    }

    // Line-oriented parser scaffold for Daktronics serial adapters.
    if (byteIn == '\r' || byteIn == '\n') {
        if (dakLineBuffer.length() > 0) {
            parseDaktronicsLine(dakLineBuffer);
            dakLineBuffer = "";
        }
        return;
    }

    if (isprint(byteIn)) {
        if (dakLineBuffer.length() > 220) {
            dakLineBuffer = dakLineBuffer.substring(dakLineBuffer.length() - 110);
        }
        dakLineBuffer += (char)byteIn;
    }
}

// Helper to decrement penalty vectors when clock is running
static void tickPenalties() {
    // Process Home Penalties
    for (auto& pen : homePenalties) {
        if (pen.active && pen.secondsRemaining > 0) {
            pen.secondsRemaining--;
            if (pen.secondsRemaining <= 0) {
                pen.active = false;
            }
        }
    }
    // Process Away Penalties
    for (auto& pen : awayPenalties) {
        if (pen.active && pen.secondsRemaining > 0) {
            pen.secondsRemaining--;
            if (pen.secondsRemaining <= 0) {
                pen.active = false;
            }
        }
    }
}

// -----------------------------------------------------------------------------
// Core API
// -----------------------------------------------------------------------------
void scoreboard_begin() {
    // All Sport CG CONTROL feed through MAX3232: 9600 baud, 8N1, no flow control.
    Serial1.begin(9600, SERIAL_8N1, 16, 17);
    penaltyCount = 0;
    clockRunning = false;
    serialMirroringEnabled = false;
}

void scoreboard_loop() {
    // Process physical MAX3232 hardware serial data
    while (Serial1.available()) {
        uint8_t b = Serial1.read();
        processIncomingSerialByte(b);
    }

    // Synthetic emulator logic (runs every 100ms when emulator is active and clock is running)
    if (emulatorModeActive && clockRunning) {
        if (millis() - lastClockTick >= 100) { // Tick every 10th of a second
            lastClockTick = millis();

            // Decrement Tenths of a second
            if (clockTenths > 0) {
                clockTenths--;
            } else {
                clockTenths = 9; // Reset tenths to 9 and decrement second

                if (clockSec > 0) {
                    clockSec--;
                    tickPenalties(); // Tick active penalty timers every full second
                } else if (clockMin > 0) {
                    clockMin--;
                    clockSec = 59;
                    tickPenalties(); // Tick active penalty timers every full second
                } else {
                    // Clock hit 00:00:0 -> Stop
                    clockSec = 0;
                    clockTenths = 0;
                    clockRunning = false;
                }
            }
        }
    }
}

// -----------------------------------------------------------------------------
// Control Handlers
// -----------------------------------------------------------------------------
void scoreboard_set_emulator(bool enable) {
    emulatorModeActive = enable;
    Serial.printf("[Scoreboard] Emulator Mode explicitly %s\n", enable ? "ENABLED" : "DISABLED");
}

void scoreboard_start_clock() {
    clockRunning = true;
    lastClockTick = millis();
}

void scoreboard_stop_clock() {
    clockRunning = false;
}

void scoreboard_set_state(int home, int away, int period) {
    homeScore = home;
    awayScore = away;
    currentPeriod = period;
}

void scoreboard_set_vendor(const String& vendorStr) {
    if (vendorStr == "dak" || vendorStr == "daktronics") currentVendor = VENDOR_DAKTRONICS;
    else if (vendorStr == "nevco")  currentVendor = VENDOR_NEVCO;
    else if (vendorStr == "fair")   currentVendor = VENDOR_FAIRPLAY;
    else if (vendorStr == "em")     currentVendor = VENDOR_ELECTRO_MECH;
}

void scoreboard_set_mirror(bool enable) {
    serialMirroringEnabled = enable;
}

String scoreboard_get_serial_trace() {
    String trace;
    trace.reserve(serialTraceLength);

    for (size_t i = 0; i < serialTraceLength; i++) {
        trace += serialTraceBuffer[(serialTraceStart + i) % SERIAL_TRACE_CAPACITY];
    }

    return trace;
}