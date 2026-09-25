#include <Arduino.h>
#include <WiFi.h>
#include <ESPAsyncWebServer.h>
#include <AsyncTCP.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <LittleFS.h>
#include <Adafruit_NeoPixel.h>
#include "scoreboard.h"
#include "esp_wifi.h"
#include "esp_wpa2.h"
#include "esp_heap_caps.h"
#include "esp_system.h"

// Hardware & Server Instances
constexpr uint16_t HTTP_SERVER_PORT = 80;
constexpr uint8_t STATUS_LED_PIN = 2;
constexpr uint16_t STATUS_LED_UPDATE_INTERVAL_MS = 25;
constexpr uint16_t STATUS_LED_PULSE_DURATION_MS = 1600;
constexpr uint8_t STATUS_LED_PULSE_MIN = 3;
constexpr uint8_t STATUS_LED_PULSE_MAX = 36;
constexpr uint8_t STATUS_LED_CONNECTED_BRIGHTNESS = 28;
AsyncWebServer server(HTTP_SERVER_PORT);
AsyncWebSocket ws("/ws");
Preferences prefs;
Adafruit_NeoPixel statusLed(1, STATUS_LED_PIN, NEO_GRB + NEO_KHZ800);

// Configuration Defaults
String adminUser = "admin";
String adminPass = "admin";
String wsAuthSecret = "NF-EMU-SECRET-2026";
String consoleLogs = "[System] Booting TipIn Scoring Gateway...\n";

// Timing & Broadcast Tracking
unsigned long lastWsBroadcast = 0;
const unsigned long WS_BROADCAST_INTERVAL = 100; // Broadcast state every 100ms

// BOOT (GPIO0) long-press reset: hold while firmware is running to clear settings.
constexpr int FACTORY_RESET_BUTTON_PIN = 0;
constexpr unsigned long FACTORY_RESET_HOLD_MS = 7000;
unsigned long factoryResetPressStartedMs = 0;
bool factoryResetInProgress = false;
constexpr unsigned long WIFI_RECONNECT_INTERVAL_MS = 10000;
unsigned long lastWifiReconnectAttemptMs = 0;
unsigned long wifiReconnectCount = 0;
bool stationModeConfigured = false;
constexpr unsigned long WIFI_TEST_TIMEOUT_MS = 30000;
constexpr char WIFI_CA_CERT_PATH[] = "/wifi-ca.pem";

struct WifiSettings {
    String ssid;
    String security = "personal";
    String password;
    String identity;
    String username;
    String caCertificate;
    bool dhcp = true;
    String ip = "192.168.1.150";
    String gateway = "192.168.1.1";
    String subnet = "255.255.255.0";
};

WifiSettings pendingWifi;
bool wifiTestActive = false;
unsigned long wifiTestStartedMs = 0;
String wifiTestState = "idle";
String wifiTestMessage;
String currentWifiSecurity = "personal";
bool wifiRestartScheduled = false;
unsigned long wifiRestartAtMs = 0;
bool bootWifiFallbackPending = false;
unsigned long bootWifiConnectionStartedMs = 0;
unsigned long lastStatusLedUpdateMs = 0;
wl_status_t lastStatusLedWifiState = WL_NO_SHIELD;

void updateStatusLed(bool force = false) {
    const unsigned long now = millis();
    const wl_status_t wifiState = WiFi.status();
    if (!force && wifiState == lastStatusLedWifiState && wifiState == WL_CONNECTED) {
        return;
    }
    if (!force && now - lastStatusLedUpdateMs < STATUS_LED_UPDATE_INTERVAL_MS) {
        return;
    }

    lastStatusLedUpdateMs = now;
    lastStatusLedWifiState = wifiState;

    if (wifiState == WL_CONNECTED) {
        statusLed.setPixelColor(0, statusLed.Color(0, STATUS_LED_CONNECTED_BRIGHTNESS, 0));
    } else if (stationModeConfigured) {
        const unsigned long pulsePosition = now % STATUS_LED_PULSE_DURATION_MS;
        const unsigned long halfPulse = STATUS_LED_PULSE_DURATION_MS / 2;
        const unsigned long rampPosition = pulsePosition <= halfPulse
            ? pulsePosition
            : STATUS_LED_PULSE_DURATION_MS - pulsePosition;
        const uint8_t brightness = STATUS_LED_PULSE_MIN +
            static_cast<uint8_t>((rampPosition * (STATUS_LED_PULSE_MAX - STATUS_LED_PULSE_MIN)) / halfPulse);
        statusLed.setPixelColor(0, statusLed.Color(0, 0, brightness));
    } else {
        statusLed.clear();
    }

    statusLed.show();
}

const char* getResetReasonName() {
    switch (esp_reset_reason()) {
        case ESP_RST_POWERON: return "power_on";
        case ESP_RST_EXT: return "external_reset";
        case ESP_RST_SW: return "software_restart";
        case ESP_RST_PANIC: return "panic";
        case ESP_RST_INT_WDT: return "interrupt_watchdog";
        case ESP_RST_TASK_WDT: return "task_watchdog";
        case ESP_RST_WDT: return "watchdog";
        case ESP_RST_DEEPSLEEP: return "deep_sleep";
        case ESP_RST_BROWNOUT: return "brownout";
        case ESP_RST_SDIO: return "sdio";
        default: return "unknown";
    }
}

void addHealthJson(JsonDocument &doc) {
    doc["uptimeMs"] = millis();
    doc["freeHeap"] = ESP.getFreeHeap();
    doc["minimumFreeHeap"] = ESP.getMinFreeHeap();
    doc["largestFreeHeapBlock"] = heap_caps_get_largest_free_block(MALLOC_CAP_8BIT);
    doc["resetReason"] = getResetReasonName();
    doc["wifiReconnectCount"] = wifiReconnectCount;
    doc["wsClientCount"] = ws.count();
}

bool parseIpStrict(const String &value, IPAddress &outIp) {
    String trimmed = value;
    trimmed.trim();
    return trimmed.length() > 0 && outIp.fromString(trimmed);
}

void logMsg(const String &msg) {
    Serial.println(msg);
    consoleLogs += msg + "\n";
    if (consoleLogs.length() > 4000) {
        consoleLogs = consoleLogs.substring(consoleLogs.length() - 2000);
    }
}

String readTextFile(const char *path) {
    File file = LittleFS.open(path, "r");
    if (!file) return "";
    String value = file.readString();
    file.close();
    return value;
}

WifiSettings loadWifiSettings() {
    WifiSettings settings;
    prefs.begin("netfront", true);
    settings.ssid = prefs.getString("wifi_ssid", "");
    settings.security = prefs.getString("wifi_security", "personal");
    settings.password = prefs.getString("wifi_pass", "");
    settings.identity = prefs.getString("wifi_identity", "");
    settings.username = prefs.getString("wifi_username", "");
    settings.dhcp = prefs.getBool("wifi_dhcp", true);
    settings.ip = prefs.getString("wifi_ip", "192.168.1.150");
    settings.gateway = prefs.getString("wifi_gw", "192.168.1.1");
    settings.subnet = prefs.getString("wifi_sn", "255.255.255.0");
    prefs.end();
    settings.caCertificate = readTextFile(WIFI_CA_CERT_PATH);
    return settings;
}

bool applyStaticIp(const WifiSettings &settings) {
    if (settings.dhcp) return true;

    IPAddress ip;
    IPAddress gateway;
    IPAddress subnet;
    if (!parseIpStrict(settings.ip, ip) ||
        !parseIpStrict(settings.gateway, gateway) ||
        !parseIpStrict(settings.subnet, subnet)) {
        return false;
    }
    return WiFi.config(ip, gateway, subnet);
}

void beginWifiConnection(const WifiSettings &settings, bool keepSetupAp) {
    WiFi.disconnect(false, true);
    esp_wifi_sta_wpa2_ent_disable();
    WiFi.mode(keepSetupAp ? WIFI_AP_STA : WIFI_STA);
    if (keepSetupAp) {
        WiFi.softAP("TipIn-Scoring-Gateway", "12345678");
    }
    WiFi.setSleep(false);
    esp_wifi_set_ps(WIFI_PS_NONE);

    if (!applyStaticIp(settings)) {
        logMsg("[WiFi] Invalid static configuration. Using DHCP.");
    }

    stationModeConfigured = true;
    currentWifiSecurity = settings.security;
    if (settings.security == "enterprise") {
        const char *caCertificate = settings.caCertificate.length() > 0
            ? settings.caCertificate.c_str()
            : nullptr;
        WiFi.begin(
            settings.ssid.c_str(),
            WPA2_AUTH_PEAP,
            settings.identity.c_str(),
            settings.username.c_str(),
            settings.password.c_str(),
            caCertificate
        );
    } else if (settings.security == "open") {
        WiFi.begin(settings.ssid.c_str());
    } else {
        WiFi.begin(settings.ssid.c_str(), settings.password.c_str());
    }
    logMsg("[WiFi] Connecting to " + settings.ssid + " using " + settings.security + " authentication.");
}

void saveWifiSettings(const WifiSettings &settings) {
    prefs.begin("netfront", false);
    prefs.putString("wifi_ssid", settings.ssid);
    prefs.putString("wifi_security", settings.security);
    prefs.putString("wifi_pass", settings.password);
    prefs.putString("wifi_identity", settings.identity);
    prefs.putString("wifi_username", settings.username);
    prefs.putBool("wifi_dhcp", settings.dhcp);
    prefs.putString("wifi_ip", settings.ip);
    prefs.putString("wifi_gw", settings.gateway);
    prefs.putString("wifi_sn", settings.subnet);
    prefs.end();

    if (settings.caCertificate.length() > 0) {
        File file = LittleFS.open(WIFI_CA_CERT_PATH, "w");
        if (file) {
            file.print(settings.caCertificate);
            file.close();
        }
    } else {
        LittleFS.remove(WIFI_CA_CERT_PATH);
    }
}

const char *wifiSecurityName(wifi_auth_mode_t mode) {
    switch (mode) {
        case WIFI_AUTH_OPEN: return "open";
        case WIFI_AUTH_WPA2_ENTERPRISE: return "enterprise";
        default: return "personal";
    }
}

void triggerRestart(int delayMs) {
    delay(delayMs);
    ESP.restart();
}

void clearFactorySettingsAndRestart(const String &reason) {
    logMsg("[Factory Reset] " + reason + " - clearing stored settings...");

    prefs.begin("netfront", false);
    prefs.clear();
    prefs.end();
    LittleFS.remove(WIFI_CA_CERT_PATH);

    // Clear ESP32 Wi-Fi credential cache to ensure true out-of-box networking state.
    WiFi.disconnect(true, true);

    logMsg("[Factory Reset] Complete. Rebooting...");
    triggerRestart(500);
}

bool ensureAdminAuth(AsyncWebServerRequest *req) {
    if (req->authenticate(adminUser.c_str(), adminPass.c_str())) {
        return true;
    }

    req->requestAuthentication();
    return false;
}

int getLegacyVendorCode() {
    switch (currentVendor) {
        case VENDOR_DAKTRONICS: return 1;
        case VENDOR_NEVCO: return 2;
        case VENDOR_ELECTRO_MECH: return 3;
        case VENDOR_FAIRPLAY:
        default:
            return 0;
    }
}

String maskSecret(const String &secret) {
    if (secret.length() <= 8) {
        return "********";
    }

    String prefix = secret.substring(0, 4);
    String suffix = secret.substring(secret.length() - 4);
    return prefix + "********" + suffix;
}

// Helper: Package state JSON for REST and WebSocket
void buildStateJson(JsonDocument &doc) {
    // Hardware / System State
    doc["device"] = "TipIn Scoring Gateway";
    doc["ssid"] = WiFi.SSID();
    doc["ip"] = (WiFi.status() == WL_CONNECTED) ? WiFi.localIP().toString() : WiFi.softAPIP().toString();
    String deviceMac = WiFi.macAddress();
    if (deviceMac.length() == 0 || deviceMac == "00:00:00:00:00:00") {
        deviceMac = WiFi.softAPmacAddress();
    }
    doc["deviceMac"] = deviceMac;
    doc["staConnected"] = (WiFi.status() == WL_CONNECTED);
    doc["wifiRssi"] = (WiFi.status() == WL_CONNECTED) ? WiFi.RSSI() : 0;
    doc["wifiSecurity"] = currentWifiSecurity;
    doc["emulator"] = emulatorModeActive;
    doc["httpPort"] = HTTP_SERVER_PORT;
    doc["wsPort"] = HTTP_SERVER_PORT;
    doc["wsPath"] = "/ws";
    doc["wsAuthSecretMasked"] = maskSecret(wsAuthSecret);
    doc["wsRequiresAuth"] = true;
    doc["vendor"] = (currentVendor == VENDOR_DAKTRONICS) ? "Daktronics" :
                    (currentVendor == VENDOR_NEVCO) ? "Nevco" :
                    (currentVendor == VENDOR_FAIRPLAY) ? "Fair-Play" : "Electro-Mech";
    addHealthJson(doc);

    // Formatted Clocks
    char clockBuf[12];
    snprintf(clockBuf, sizeof(clockBuf), "%02d:%02d", clockMin, clockSec);
    doc["clock"] = clockBuf; // "17:00"

    char lastMinBuf[16];
    snprintf(lastMinBuf, sizeof(lastMinBuf), "%02d:%02d.%01d", clockMin, clockSec, clockTenths);
    doc["lastMinuteClock"] = lastMinBuf; // "17:00.0"

    // Dynamic Display Format (Switches to sub-seconds when clock < 1 minute)
    if (clockMin == 0) {
        char subSecBuf[12];
        snprintf(subSecBuf, sizeof(subSecBuf), "%02d.%01d", clockSec, clockTenths);
        doc["clockFormatted"] = subSecBuf;
    } else {
        doc["clockFormatted"] = clockBuf;
    }

    // Scoreboard Numerical Fields
    doc["clockRunning"] = clockRunning;
    doc["clockMin"] = clockMin;
    doc["clockSec"] = clockSec;
    doc["clockTenths"] = clockTenths;
    doc["homeScore"] = homeScore;
    doc["awayScore"] = awayScore;
    doc["homeShots"] = homeShots;
    doc["awayShots"] = awayShots;
    doc["period"] = currentPeriod;

    // --- HOME PENALTIES ---
    if (homePenalties.size() > 0 && homePenalties[0].active) {
        doc["homePen1Player"] = homePenalties[0].playerNumber;
        char penBuf[8];
        snprintf(penBuf, sizeof(penBuf), "%02d:%02d", homePenalties[0].secondsRemaining / 60, homePenalties[0].secondsRemaining % 60);
        doc["homePen1Time"] = penBuf;
    } else {
        doc["homePen1Player"] = 0;
        doc["homePen1Time"] = "00:00";
    }

    if (homePenalties.size() > 1 && homePenalties[1].active) {
        doc["homePen2Player"] = homePenalties[1].playerNumber;
        char penBuf[8];
        snprintf(penBuf, sizeof(penBuf), "%02d:%02d", homePenalties[1].secondsRemaining / 60, homePenalties[1].secondsRemaining % 60);
        doc["homePen2Time"] = penBuf;
    } else {
        doc["homePen2Player"] = 0;
        doc["homePen2Time"] = "00:00";
    }

    // --- AWAY PENALTIES ---
    if (awayPenalties.size() > 0 && awayPenalties[0].active) {
        doc["awayPen1Player"] = awayPenalties[0].playerNumber;
        char penBuf[8];
        snprintf(penBuf, sizeof(penBuf), "%02d:%02d", awayPenalties[0].secondsRemaining / 60, awayPenalties[0].secondsRemaining % 60);
        doc["awayPen1Time"] = penBuf;
    } else {
        doc["awayPen1Player"] = 0;
        doc["awayPen1Time"] = "00:00";
    }

    if (awayPenalties.size() > 1 && awayPenalties[1].active) {
        doc["awayPen2Player"] = awayPenalties[1].playerNumber;
        char penBuf[8];
        snprintf(penBuf, sizeof(penBuf), "%02d:%02d", awayPenalties[1].secondsRemaining / 60, awayPenalties[1].secondsRemaining % 60);
        doc["awayPen2Time"] = penBuf;
    } else {
        doc["awayPen2Player"] = 0;
        doc["awayPen2Time"] = "00:00";
    }

    // Legacy aliases used by existing dashboard and bridge clients.
    doc["home"] = homeScore;
    doc["away"] = awayScore;
    doc["running"] = clockRunning;
    doc["shotsHome"] = homeShots;
    doc["shotsAway"] = awayShots;
    doc["schema"] = "netfront.full.v1";
}

void buildClockOnlyJson(JsonDocument &doc) {
    char clockBuf[12];
    snprintf(clockBuf, sizeof(clockBuf), "%02d:%02d", clockMin, clockSec);

    char formattedBuf[12];
    if (clockMin == 0) {
        snprintf(formattedBuf, sizeof(formattedBuf), "%02d.%01d", clockSec, clockTenths);
    } else {
        snprintf(formattedBuf, sizeof(formattedBuf), "%02d:%02d", clockMin, clockSec);
    }

    doc["clock"] = clockBuf;
    doc["clockFormatted"] = formattedBuf;
    doc["clockRunning"] = clockRunning;
    doc["clockMin"] = clockMin;
    doc["clockSec"] = clockSec;
    doc["clockTenths"] = clockTenths;
    doc["period"] = currentPeriod;
    doc["schema"] = "netfront.clock.v1";
}

void buildLegacySerialJson(JsonDocument &doc) {
    doc["vendor"] = getLegacyVendorCode();
    doc["rxPin"] = 16;
    doc["txPin"] = 17;
    doc["baud"] = 9600;
    doc["format"] = "8N1";
    doc["flowControl"] = "None";
    doc["rxByteCount"] = serialRxByteCount;
    doc["lastRxMillis"] = serialLastRxMillis;
    doc["receiving"] = serialRxByteCount > 0 && millis() - serialLastRxMillis < 3000;
    addHealthJson(doc);

    char clockBuf[12];
    snprintf(clockBuf, sizeof(clockBuf), "%02d:%02d", clockMin, clockSec);
    doc["clock"] = clockBuf;
    doc["running"] = clockRunning;
    doc["home"] = homeScore;
    doc["away"] = awayScore;
    doc["period"] = currentPeriod;
    doc["shotsHome"] = homeShots;
    doc["shotsAway"] = awayShots;
    doc["serialTrace"] = scoreboard_get_serial_trace();

    JsonArray penalties = doc["penalties"].to<JsonArray>();

    for (size_t index = 0; index < homePenalties.size(); index++) {
        const auto &p = homePenalties[index];
        if (!p.active) continue;
        JsonObject item = penalties.add<JsonObject>();
        item["team"] = 0;
        item["slot"] = index + 1;
        item["player"] = p.playerNumber;
        item["minutes"] = p.secondsRemaining / 60;
        item["seconds"] = p.secondsRemaining % 60;
    }

    for (size_t index = 0; index < awayPenalties.size(); index++) {
        const auto &p = awayPenalties[index];
        if (!p.active) continue;
        JsonObject item = penalties.add<JsonObject>();
        item["team"] = 1;
        item["slot"] = index + 1;
        item["player"] = p.playerNumber;
        item["minutes"] = p.secondsRemaining / 60;
        item["seconds"] = p.secondsRemaining % 60;
    }
}

// Broadcast JSON State via WebSocket
void broadcastStateWs() {
    if (ws.count() == 0) return;

    JsonDocument doc;
    buildStateJson(doc);
    String response;
    serializeJson(doc, response);
    ws.textAll(response);
}

// Handle WebSocket Inbound Messages
void handleWsMessage(void *arg, uint8_t *data, size_t len, AsyncWebSocketClient *client) {
    AwsFrameInfo *info = (AwsFrameInfo*)arg;
    if (info->final && info->index == 0 && info->len == len && info->opcode == WS_TEXT) {
        JsonDocument doc;
        DeserializationError error = deserializeJson(doc, data, len);
        if (error) return;

        // Authentication Handshake
        if (doc.containsKey("auth")) {
            String token = doc["auth"] | "";
            if (token == wsAuthSecret) {
                client->_tempObject = (void*)1; // Mark client as authenticated
                
                JsonDocument ack;
                ack["status"] = "authenticated";
                ack["client"] = doc["client"] | "unknown";
                String ackStr;
                serializeJson(ack, ackStr);
                client->text(ackStr);
                logMsg("[WS] Client authenticated: ID " + String(client->id()));
                return;
            } else {
                client->text("{\"error\":\"invalid_auth\"}");
                client->close(4001, "Unauthorized");
                return;
            }
        }

        // Verify Authentication for Command Processing
        if (client->_tempObject == nullptr) {
            client->text("{\"type\":\"AUTH_REQUIRED\"}");
            return;
        }

        // Process Commands
        String cmd = doc["command"] | doc["cmd"] | "";

        // Dynamic Mode Switching
        if (cmd == "emuOn" || doc["setMode"] == "emulator" || doc["mode"] == "emulator") {
            scoreboard_set_emulator(true);
            logMsg("[Mode] Switched to EMULATOR");
            client->text("{\"status\":\"ok\",\"emulator\":true}");
        } 
        else if (cmd == "emuOff" || doc["setMode"] == "live" || doc["mode"] == "live") {
            scoreboard_set_emulator(false);
            logMsg("[Mode] Switched to LIVE SERIAL");
            client->text("{\"status\":\"ok\",\"emulator\":false}");
        } 
        else if (cmd == "clockStart") {
            scoreboard_start_clock();
        } 
        else if (cmd == "clockStop") {
            scoreboard_stop_clock();
        } 
        else if (cmd == "setClock") {
            clockMin = doc["min"] | clockMin;
            clockSec = doc["sec"] | clockSec;
            clockTenths = doc["tenths"] | clockTenths;
        } 
        else if (cmd == "setState" || cmd == "setScore") {
            if (doc.containsKey("homeScore")) homeScore = doc["homeScore"];
            if (doc.containsKey("awayScore")) awayScore = doc["awayScore"];
            if (doc.containsKey("period")) currentPeriod = doc["period"];
            if (doc.containsKey("homeShots")) homeShots = doc["homeShots"];
            if (doc.containsKey("awayShots")) awayShots = doc["awayShots"];
        }

        // Immediate Broadcast post-command
        broadcastStateWs();
    }
}

// WebSocket Event Handler
void onWsEvent(AsyncWebSocket *server, AsyncWebSocketClient *client, AwsEventType type, void *arg, uint8_t *data, size_t len) {
    switch (type) {
        case WS_EVT_CONNECT:
            logMsg("[WS] Client connected: ID " + String(client->id()));
            client->_tempObject = nullptr; // Unauthenticated by default
            client->text("{\"type\":\"AUTH_REQUIRED\"}");
            break;
        case WS_EVT_DISCONNECT:
            logMsg("[WS] Client disconnected: ID " + String(client->id()));
            break;
        case WS_EVT_DATA:
            handleWsMessage(arg, data, len, client);
            break;
        case WS_EVT_PONG:
        case WS_EVT_ERROR:
            break;
    }
}

void setup() {
    Serial.begin(115200);

    statusLed.begin();
    statusLed.clear();
    statusLed.show();

    pinMode(FACTORY_RESET_BUTTON_PIN, INPUT_PULLUP);

    // Initialize LittleFS
    if (!LittleFS.begin(true)) {
        Serial.println("[System] LittleFS Mount Failed!");
    }

    scoreboard_begin();

    // Load credentials from NVS
    prefs.begin("netfront", false);
    adminPass = prefs.getString("admin_pass", "admin");
    wsAuthSecret = prefs.getString("ws_secret", wsAuthSecret);
    prefs.end();

    // Configure WiFi
    WifiSettings storedWifi = loadWifiSettings();
    if (storedWifi.ssid.length() > 0) {
        beginWifiConnection(storedWifi, false);
        bootWifiFallbackPending = true;
        bootWifiConnectionStartedMs = millis();

    } else {

        WiFi.mode(WIFI_AP);

        // AP mode also benefits from disabling sleep
        WiFi.setSleep(false);
        esp_wifi_set_ps(WIFI_PS_NONE);

        WiFi.softAP("TipIn-Scoring-Gateway", "12345678");
        logMsg("Started AP Mode: TipIn-Scoring-Gateway");
    }


    // Initialize WebSocket
    ws.onEvent(onWsEvent);
    server.addHandler(&ws);

    // --- REST API ENDPOINTS ---

    // Get Current System State
    server.on("/api/state", HTTP_GET, [](AsyncWebServerRequest *req) {
        JsonDocument doc;
        buildStateJson(doc);
        String response;
        serializeJson(doc, response);
        req->send(200, "application/json", response);
    });

    // Clock-only payload for Game Manager / minimal overlays.
    server.on("/api/state/clock", HTTP_GET, [](AsyncWebServerRequest *req) {
        JsonDocument doc;
        buildClockOnlyJson(doc);
        String response;
        serializeJson(doc, response);
        req->send(200, "application/json", response);
    });

    // Explicit full payload endpoint for full VMix templates.
    server.on("/api/state/full", HTTP_GET, [](AsyncWebServerRequest *req) {
        JsonDocument doc;
        buildStateJson(doc);
        String response;
        serializeJson(doc, response);
        req->send(200, "application/json", response);
    });

    // Compatibility endpoint used by debug page.
    server.on("/admin.json", HTTP_GET, [](AsyncWebServerRequest *req) {
        JsonDocument doc;
        buildStateJson(doc);
        String response;
        serializeJson(doc, response);
        req->send(200, "application/json", response);
    });

    // Compatibility endpoint used by serial analyzer page.
    server.on("/serial.json", HTTP_GET, [](AsyncWebServerRequest *req) {
        JsonDocument doc;
        buildLegacySerialJson(doc);
        String response;
        serializeJson(doc, response);
        req->send(200, "application/json", response);
    });

    // Lightweight in-memory gateway logs.
    server.on("/api/logs", HTTP_GET, [](AsyncWebServerRequest *req) {
        req->send(200, "text/plain", consoleLogs);
    });

    // Authenticated token detail endpoint for admin reveal action.
    server.on("/api/ws-secret", HTTP_GET, [](AsyncWebServerRequest *req) {
        if (!ensureAdminAuth(req)) {
            return;
        }

        JsonDocument doc;
        doc["wsAuthSecret"] = wsAuthSecret;
        doc["wsAuthSecretMasked"] = maskSecret(wsAuthSecret);
        String response;
        serializeJson(doc, response);
        req->send(200, "application/json", response);
    });

    server.on("/api/wifi/scan", HTTP_GET, [](AsyncWebServerRequest *req) {
        if (!ensureAdminAuth(req)) return;

        int16_t resultCount = WiFi.scanComplete();
        if (resultCount == WIFI_SCAN_FAILED) {
            if (WiFi.getMode() == WIFI_AP) {
                WiFi.mode(WIFI_AP_STA);
            }
            WiFi.scanDelete();
            WiFi.scanNetworks(true, true);
            req->send(202, "application/json", "{\"status\":\"scanning\"}");
            return;
        }
        if (resultCount == WIFI_SCAN_RUNNING) {
            req->send(202, "application/json", "{\"status\":\"scanning\"}");
            return;
        }

        JsonDocument doc;
        doc["status"] = "complete";
        JsonArray networks = doc["networks"].to<JsonArray>();
        for (int16_t index = 0; index < resultCount; index++) {
            String ssid = WiFi.SSID(index);
            bool strongerDuplicateExists = false;
            for (int16_t other = 0; other < resultCount; other++) {
                if (other != index && WiFi.SSID(other) == ssid && WiFi.RSSI(other) > WiFi.RSSI(index)) {
                    strongerDuplicateExists = true;
                    break;
                }
            }
            if (strongerDuplicateExists) continue;

            JsonObject network = networks.add<JsonObject>();
            network["ssid"] = ssid;
            network["rssi"] = WiFi.RSSI(index);
            network["channel"] = WiFi.channel(index);
            network["security"] = wifiSecurityName(WiFi.encryptionType(index));
            network["hidden"] = ssid.length() == 0;
        }
        String response;
        serializeJson(doc, response);
        WiFi.scanDelete();
        req->send(200, "application/json", response);
    });

    server.on("/api/wifi/status", HTTP_GET, [](AsyncWebServerRequest *req) {
        if (!ensureAdminAuth(req)) return;
        JsonDocument doc;
        doc["state"] = wifiTestState;
        doc["message"] = wifiTestMessage;
        doc["connected"] = WiFi.status() == WL_CONNECTED;
        doc["ssid"] = WiFi.SSID();
        doc["ip"] = WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString() : "";
        doc["rssi"] = WiFi.status() == WL_CONNECTED ? WiFi.RSSI() : 0;
        String response;
        serializeJson(doc, response);
        req->send(200, "application/json", response);
    });

    // Test WiFi configuration, then save only after a successful connection.
    server.on("/api/wifi", HTTP_POST, [](AsyncWebServerRequest *req) {}, nullptr,
        [](AsyncWebServerRequest *req, uint8_t *data, size_t len, size_t index, size_t total) {
            constexpr size_t MAX_WIFI_REQUEST_BYTES = 12288;
            if (index == 0) {
                if (!ensureAdminAuth(req)) return;
                if (total == 0 || total > MAX_WIFI_REQUEST_BYTES) {
                    req->send(413, "application/json", "{\"error\":\"request_too_large\"}");
                    return;
                }
                req->_tempObject = malloc(total + 1);
                if (req->_tempObject == nullptr) {
                    req->send(503, "application/json", "{\"error\":\"insufficient_memory\"}");
                    return;
                }
            }
            if (req->_tempObject == nullptr) {
                return;
            }
            memcpy(static_cast<uint8_t *>(req->_tempObject) + index, data, len);
            if (index + len < total) return;

            static_cast<uint8_t *>(req->_tempObject)[total] = 0;

            JsonDocument doc;
            DeserializationError jsonError = deserializeJson(doc, static_cast<uint8_t *>(req->_tempObject), total);
            free(req->_tempObject);
            req->_tempObject = nullptr;
            if (jsonError) {
                req->send(400, "application/json", "{\"error\":\"invalid_json\"}");
                return;
            }

            pendingWifi = WifiSettings();
            pendingWifi.ssid = doc["ssid"] | "";
            pendingWifi.security = doc["security"] | "personal";
            pendingWifi.password = doc["pass"] | "";
            pendingWifi.identity = doc["identity"] | "";
            pendingWifi.username = doc["username"] | "";
            pendingWifi.caCertificate = doc["caCertificate"] | "";
            pendingWifi.dhcp = doc["dhcp"] | true;
            pendingWifi.ip = doc["ip"] | "";
            pendingWifi.gateway = doc["gw"] | "";
            pendingWifi.subnet = doc["sub"] | "";

            pendingWifi.ssid.trim();
            pendingWifi.security.trim();
            pendingWifi.identity.trim();
            pendingWifi.username.trim();
            pendingWifi.ip.trim();
            pendingWifi.gateway.trim();
            pendingWifi.subnet.trim();

            if (pendingWifi.ssid.length() == 0 || pendingWifi.ssid.length() > 32) {
                req->send(400, "application/json", "{\"error\":\"invalid_ssid\",\"message\":\"SSID is required and must be 1-32 characters.\"}");
                return;
            }

            if (pendingWifi.security != "open" && pendingWifi.security != "personal" && pendingWifi.security != "enterprise") {
                req->send(400, "application/json", "{\"error\":\"invalid_security\"}");
                return;
            }

            if (pendingWifi.security == "personal" &&
                (pendingWifi.password.length() < 8 || pendingWifi.password.length() > 63)) {
                req->send(400, "application/json", "{\"error\":\"invalid_wifi_password\",\"message\":\"Personal WiFi passwords must be 8-63 characters.\"}");
                return;
            }

            if (pendingWifi.security == "enterprise" &&
                (pendingWifi.identity.length() == 0 || pendingWifi.identity.length() > 64 ||
                 pendingWifi.username.length() == 0 || pendingWifi.username.length() > 64 ||
                 pendingWifi.password.length() == 0 || pendingWifi.password.length() > 64)) {
                req->send(400, "application/json", "{\"error\":\"invalid_enterprise_credentials\",\"message\":\"Enterprise identity, username, and password are required and limited to 64 characters.\"}");
                return;
            }

            if (pendingWifi.caCertificate.length() > 8192 ||
                (pendingWifi.caCertificate.length() > 0 &&
                 (!pendingWifi.caCertificate.startsWith("-----BEGIN CERTIFICATE-----") ||
                  pendingWifi.caCertificate.indexOf("-----END CERTIFICATE-----") < 0))) {
                req->send(400, "application/json", "{\"error\":\"invalid_ca_certificate\"}");
                return;
            }

            if (!pendingWifi.dhcp) {
                IPAddress ip, gw, sub;
                if (!parseIpStrict(pendingWifi.ip, ip) ||
                    !parseIpStrict(pendingWifi.gateway, gw) ||
                    !parseIpStrict(pendingWifi.subnet, sub)) {
                    req->send(400, "application/json", "{\"error\":\"invalid_static_ip\",\"message\":\"Static IP, gateway, and subnet must be valid IPv4 values.\"}");
                    return;
                }
            }

            wifiTestActive = true;
            wifiTestStartedMs = millis();
            wifiTestState = "connecting";
            wifiTestMessage = "Testing connection before saving.";
            bootWifiFallbackPending = false;
            beginWifiConnection(pendingWifi, true);
            req->send(202, "application/json", "{\"status\":\"testing\",\"message\":\"Testing WiFi connection.\"}");
        }
    );

    // Command Endpoint (Admin REST Actions)
    server.on("/api/cmd", HTTP_POST, [](AsyncWebServerRequest *req) {}, nullptr, 
        [](AsyncWebServerRequest *req, uint8_t *data, size_t len, size_t index, size_t total) {
            if (!ensureAdminAuth(req)) {
                return;
            }

            JsonDocument doc;
            if (deserializeJson(doc, data, len)) {
                req->send(400, "application/json", "{\"error\":\"invalid_json\"}");
                return;
            }

            String cmd = doc["command"] | "";

            if (cmd == "changePass") {
                String newPass = doc["newPass"] | "";
                if (newPass.length() > 0) {
                    prefs.begin("netfront", false);
                    prefs.putString("admin_pass", newPass);
                    prefs.end();
                    adminPass = newPass;
                    logMsg("Admin password successfully updated.");
                    req->send(200, "application/json", "{\"status\":\"ok\",\"message\":\"Password updated\"}");
                } else {
                    req->send(400, "application/json", "{\"error\":\"invalid_password\"}");
                }
            } else if (cmd == "setWsToken") {
                String newToken = doc["wsToken"] | doc["token"] | "";
                newToken.trim();

                if (newToken.length() < 8) {
                    req->send(400, "application/json", "{\"error\":\"invalid_ws_token\",\"message\":\"Token must be at least 8 characters.\"}");
                    return;
                }

                prefs.begin("netfront", false);
                prefs.putString("ws_secret", newToken);
                prefs.end();
                wsAuthSecret = newToken;

                logMsg("WebSocket security token updated from admin UI.");

                JsonDocument responseDoc;
                responseDoc["status"] = "ok";
                responseDoc["message"] = "WebSocket token updated.";
                responseDoc["wsAuthSecretMasked"] = maskSecret(wsAuthSecret);
                String response;
                serializeJson(responseDoc, response);
                req->send(200, "application/json", response);
            } else if (cmd == "emuOn" || cmd == "setModeEmu") {
                scoreboard_set_emulator(true);
                req->send(200, "application/json", "{\"status\":\"ok\",\"emulator\":true}");
            } else if (cmd == "emuOff" || cmd == "setModeLive") {
                scoreboard_set_emulator(false);
                req->send(200, "application/json", "{\"status\":\"ok\",\"emulator\":false}");
            } else if (cmd == "clockStart") {
                scoreboard_start_clock();
                req->send(200, "application/json", "{\"status\":\"ok\"}");
            } else if (cmd == "clockStop") {
                scoreboard_stop_clock();
                req->send(200, "application/json", "{\"status\":\"ok\"}");
            } else if (cmd == "setClock") {
                clockMin = doc["min"] | clockMin;
                clockSec = doc["sec"] | clockSec;
                clockTenths = doc["tenths"] | clockTenths;
                req->send(200, "application/json", "{\"status\":\"ok\"}");
            } else if (cmd == "setState" || cmd == "setScore") {
                if (doc.containsKey("homeScore")) homeScore = doc["homeScore"];
                else if (doc.containsKey("home")) homeScore = doc["home"];

                if (doc.containsKey("awayScore")) awayScore = doc["awayScore"];
                else if (doc.containsKey("away")) awayScore = doc["away"];

                if (doc.containsKey("period")) currentPeriod = doc["period"];

                if (doc.containsKey("homeShots")) homeShots = doc["homeShots"];
                else if (doc.containsKey("shotsHome")) homeShots = doc["shotsHome"];

                if (doc.containsKey("awayShots")) awayShots = doc["awayShots"];
                else if (doc.containsKey("shotsAway")) awayShots = doc["shotsAway"];

                req->send(200, "application/json", "{\"status\":\"ok\"}");
            } else if (cmd == "addPenalty" || cmd == "addHomePenalty" || cmd == "addAwayPenalty") {
                String team = doc["team"] | "";
                if (cmd == "addHomePenalty") team = "home";
                if (cmd == "addAwayPenalty") team = "away";

                int player = doc["player"] | 0;
                int minutes = doc["minutes"] | 2;

                Penalty p;
                p.playerNumber = player;
                p.secondsRemaining = minutes * 60;
                p.active = true;

                if (team == "home") {
                    auto inactive = std::find_if(
                        homePenalties.begin(),
                        homePenalties.end(),
                        [](const Penalty &item) { return !item.active; }
                    );
                    if (inactive != homePenalties.end()) *inactive = p;
                    else if (homePenalties.size() < 2) homePenalties.push_back(p);
                } else if (team == "away") {
                    auto inactive = std::find_if(
                        awayPenalties.begin(),
                        awayPenalties.end(),
                        [](const Penalty &item) { return !item.active; }
                    );
                    if (inactive != awayPenalties.end()) *inactive = p;
                    else if (awayPenalties.size() < 2) awayPenalties.push_back(p);
                }
                req->send(200, "application/json", "{\"status\":\"ok\"}");
            } else if (cmd == "deletePenalty") {
                String team = doc["team"] | "";
                int idx = doc["index"] | 0;
                if (team == "home" && idx < homePenalties.size()) {
                    homePenalties.erase(homePenalties.begin() + idx);
                } else if (team == "away" && idx < awayPenalties.size()) {
                    awayPenalties.erase(awayPenalties.begin() + idx);
                }
                req->send(200, "application/json", "{\"status\":\"ok\"}");
            } else if (cmd == "clearPenalties") {
                homePenalties.clear();
                awayPenalties.clear();
                req->send(200, "application/json", "{\"status\":\"ok\"}");
            } else if (cmd == "vendorSet") {
                scoreboard_set_vendor(doc["vendor"] | "auto");
                req->send(200, "application/json", "{\"status\":\"ok\"}");
            } else if (cmd == "mirrorOn") {
                scoreboard_set_mirror(true);
                req->send(200, "application/json", "{\"status\":\"ok\"}");
            } else if (cmd == "mirrorOff") {
                scoreboard_set_mirror(false);
                req->send(200, "application/json", "{\"status\":\"ok\"}");
            } else if (cmd == "reboot") {
                req->send(200, "application/json", "{\"status\":\"rebooting\"}");
                triggerRestart(500);
            } else if (cmd == "factory") {
                req->send(200, "application/json", "{\"status\":\"cleared\"}");
                clearFactorySettingsAndRestart("factory command");
            } else {
                req->send(400, "application/json", "{\"error\":\"unknown_command\"}");
            }
            
            // Broadcast state updates after REST command executes
            broadcastStateWs();
        }
    );

    // Safe mode: require admin auth for all interactive admin pages.
    server.on("/", HTTP_GET, [](AsyncWebServerRequest *req) {
        if (!ensureAdminAuth(req)) return;
        req->send(LittleFS, "/admin.html", "text/html");
    });

    server.on("/admin", HTTP_GET, [](AsyncWebServerRequest *req) {
        if (!ensureAdminAuth(req)) return;
        req->redirect("/");
    });

    server.on("/admin.html", HTTP_GET, [](AsyncWebServerRequest *req) {
        if (!ensureAdminAuth(req)) return;
        req->send(LittleFS, "/admin.html", "text/html");
    });

    server.on("/scoreboard-simulator.html", HTTP_GET, [](AsyncWebServerRequest *req) {
        if (!ensureAdminAuth(req)) return;
        req->send(LittleFS, "/scoreboard-simulator.html", "text/html");
    });

    server.on("/serial-analyzer.html", HTTP_GET, [](AsyncWebServerRequest *req) {
        if (!ensureAdminAuth(req)) return;
        req->send(LittleFS, "/serial-analyzer.html", "text/html");
    });

    server.on("/ws-diag.html", HTTP_GET, [](AsyncWebServerRequest *req) {
        if (!ensureAdminAuth(req)) return;
        req->send(LittleFS, "/ws-diag.html", "text/html");
    });

    server.on("/scoreboard-debug.html", HTTP_GET, [](AsyncWebServerRequest *req) {
        if (!ensureAdminAuth(req)) return;
        req->send(LittleFS, "/scoreboard-debug.html", "text/html");
    });

    // Best-effort logout for browser Basic Auth.
    server.on("/logout", HTTP_GET, [](AsyncWebServerRequest *req) {
        req->requestAuthentication();
    });

    // Serve static assets (favicon/images/scripts), while protected pages are handled above.
    server.serveStatic("/", LittleFS, "/");

    server.begin();
    logMsg("HTTP & WebSocket Server Started on Port " + String(HTTP_SERVER_PORT));
}

void loop() {
    updateStatusLed();

    // Physical BOOT button factory reset (hold for FACTORY_RESET_HOLD_MS).
    if (!factoryResetInProgress) {
        const bool pressed = digitalRead(FACTORY_RESET_BUTTON_PIN) == LOW;
        if (pressed) {
            if (factoryResetPressStartedMs == 0) {
                factoryResetPressStartedMs = millis();
            } else if (millis() - factoryResetPressStartedMs >= FACTORY_RESET_HOLD_MS) {
                factoryResetInProgress = true;
                clearFactorySettingsAndRestart("BOOT held for 7 seconds");
                return;
            }
        } else {
            factoryResetPressStartedMs = 0;
        }
    }

    // Process scoreboard updates (either reading hardware serial or ticking emulator clock)
    scoreboard_loop();

    if (wifiTestActive) {
        if (WiFi.status() == WL_CONNECTED) {
            wifiTestActive = false;
            wifiTestState = "success";
            wifiTestMessage = "Connection verified. Settings saved; rebooting.";
            saveWifiSettings(pendingWifi);
            logMsg("[WiFi] Connection test succeeded. Saving settings.");
            wifiRestartScheduled = true;
            wifiRestartAtMs = millis() + 4000;
        }
        else if (millis() - wifiTestStartedMs >= WIFI_TEST_TIMEOUT_MS) {
            wifiTestActive = false;
            wifiTestState = "failed";
            wifiTestMessage = "Connection failed. Previous settings restored.";
            logMsg("[WiFi] Connection test failed. Restoring previous settings.");
            WifiSettings storedWifi = loadWifiSettings();
            if (storedWifi.ssid.length() > 0) {
                beginWifiConnection(storedWifi, true);
            } else {
                WiFi.disconnect(false, true);
                WiFi.mode(WIFI_AP);
                stationModeConfigured = false;
            }
        }
    }

    if (bootWifiFallbackPending) {
        if (WiFi.status() == WL_CONNECTED) {
            bootWifiFallbackPending = false;
        } else if (millis() - bootWifiConnectionStartedMs >= WIFI_TEST_TIMEOUT_MS) {
            bootWifiFallbackPending = false;
            WiFi.mode(WIFI_AP_STA);
            WiFi.softAP("TipIn-Scoring-Gateway", "12345678");
            logMsg("[WiFi] Stored network unavailable. Setup AP enabled while reconnecting.");
        }
    }

    if (wifiRestartScheduled && static_cast<long>(millis() - wifiRestartAtMs) >= 0) {
        ESP.restart();
        return;
    }

    if (
        stationModeConfigured &&
        !wifiTestActive &&
        WiFi.status() != WL_CONNECTED &&
        millis() - lastWifiReconnectAttemptMs >= WIFI_RECONNECT_INTERVAL_MS
    ) {
        lastWifiReconnectAttemptMs = millis();
        wifiReconnectCount++;
        WiFi.reconnect();
    }

    // Clean up closed WebSocket connections
    ws.cleanupClients();

    // High-frequency WebSocket state broadcasting (~100ms ticks for sub-second precision)
    if (millis() - lastWsBroadcast >= WS_BROADCAST_INTERVAL) {
        lastWsBroadcast = millis();
        broadcastStateWs();
    }
}