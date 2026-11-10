#ifndef TIPIN_GATEWAY_CLIENTS_JSON_H
#define TIPIN_GATEWAY_CLIENTS_JSON_H

#include <ArduinoJson.h>
#include "gateway_reliability.h"

namespace tipin {

inline void buildClientsJson(JsonDocument& doc, const ClientHistory& history, uint32_t now) {
    doc["uptimeMs"] = now;
    doc["capacity"] = MAX_CLIENT_HISTORY;
    doc["retention"] = "ram_until_restart";
    JsonArray clients = doc["clients"].to<JsonArray>();
    for (const auto& item : history.records) {
        if (!item.used) continue;
        JsonObject row = clients.add<JsonObject>();
        row["ip"] = item.ip;
        row["transport"] = item.websocket ? (item.http ? "http + websocket" : "websocket") : "http";
        JsonArray names = row["clientNames"].to<JsonArray>();
        auto addName = [&names](const char* name) {
            for (JsonVariant existing : names) if (strcmp(existing.as<const char*>(), name) == 0) return;
            names.add(name);
        };
        if (item.http) addName("Admin / authenticated API");
        size_t active = 0;
        uint32_t connectedAge = 0;
        for (const auto& session : history.sessions) {
            if (!session.open || strcmp(session.ip, item.ip) != 0) continue;
            active++;
            const uint32_t age = now - session.openedAt;
            if (age > connectedAge) connectedAge = age;
            addName(session.name);
        }
        if (!active && item.websocket) addName(item.lastClient[0] ? item.lastClient : "WebSocket viewer");
        row["activeConnections"] = active;
        row["client"] = names.size() ? names[0].as<const char*>() : "";
        row["status"] = history.status(item, now);
        if (item.seen) row["lastSeenAgeMs"] = now - item.lastSeenAt;
        else row["lastSeenAgeMs"] = nullptr;
        if (active) row["connectedAgeMs"] = connectedAge;
        else row["connectedAgeMs"] = nullptr;
        row["authenticated"] = item.authenticated;
        row["lastSeenBasis"] = !item.seen ? "none" :
            item.lastSeenWasPong ? "websocket_pong" : "authenticated_request";
    }
}

}

#endif
