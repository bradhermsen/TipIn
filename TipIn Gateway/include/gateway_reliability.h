#ifndef TIPIN_GATEWAY_RELIABILITY_H
#define TIPIN_GATEWAY_RELIABILITY_H

#include <stdint.h>
#include <stddef.h>
#include <stdio.h>
#include <string.h>

namespace tipin {

constexpr uint32_t HTTP_RECENT_MS = 60000;
constexpr uint32_t WS_PING_MS = 10000;
constexpr uint32_t WS_PONG_TIMEOUT_MS = 30000;
constexpr uint32_t WS_AUTH_TIMEOUT_MS = 10000;
constexpr uint32_t WS_CONGESTION_TIMEOUT_MS = 10000;
constexpr size_t MAX_CLIENT_HISTORY = 20;
constexpr size_t MAX_WS_CLIENTS = 8;

struct RemoteClient {
    bool used = false;
    bool websocket = false;
    bool open = false;
    bool authenticated = false;
    bool seen = false;
    bool pingPending = false;
    bool congested = false;
    uint32_t id = 0;
    uint32_t openedAt = 0;
    uint32_t lastSeenAt = 0;
    uint32_t changedAt = 0;
    uint32_t pingAt = 0;
    uint32_t pingNonce = 0;
    uint32_t congestionAt = 0;
    char ip[48] = {};
    char name[49] = {};
};

inline const char* closeReason(const RemoteClient& item, uint32_t now) {
    if (!item.authenticated && now - item.openedAt >= WS_AUTH_TIMEOUT_MS) return "Authentication timeout";
    if (item.pingPending && now - item.pingAt >= WS_PONG_TIMEOUT_MS) return "Pong timeout";
    if (item.congested && now - item.congestionAt >= WS_CONGESTION_TIMEOUT_MS) return "Slow client";
    return nullptr;
}

inline bool pingDue(const RemoteClient& item, uint32_t now) {
    return item.authenticated && !item.pingPending && now - item.pingAt >= WS_PING_MS;
}

inline void recordSend(RemoteClient& item, bool sent, uint32_t now) {
    if (sent) {
        item.congested = false;
    } else if (!item.congested) {
        item.congested = true;
        item.congestionAt = now;
    }
}

struct RemoteDevice {
    bool used = false;
    bool websocket = false;
    bool http = false;
    bool authenticated = false;
    bool seen = false;
    bool lastSeenWasPong = false;
    uint32_t lastSeenAt = 0;
    uint32_t httpSeenAt = 0;
    uint32_t changedAt = 0;
    char ip[48] = {};
    char lastClient[49] = {};
};

class ClientHistory {
public:
    RemoteDevice records[MAX_CLIENT_HISTORY];
    RemoteClient sessions[MAX_WS_CLIENTS];

    RemoteClient* find(uint32_t id) {
        for (auto& item : sessions) {
            if (item.open && item.id == id) return &item;
        }
        return nullptr;
    }

    size_t openCount() const {
        size_t count = 0;
        for (const auto& item : sessions) if (item.open) count++;
        return count;
    }

    size_t openCount(const char* ip) const {
        size_t count = 0;
        for (const auto& item : sessions) if (item.open && strcmp(item.ip, ip) == 0) count++;
        return count;
    }

    RemoteClient* connected(uint32_t id, const char* ip, uint32_t now) {
        if (find(id) || openCount() >= MAX_WS_CLIENTS) return nullptr;
        auto* device = allocate(ip, now);
        if (!device) return nullptr;
        device->websocket = true;
        device->changedAt = now;
        for (auto& item : sessions) {
            if (item.open) continue;
            item = RemoteClient();
            item.used = item.websocket = item.open = true;
            item.id = id;
            item.openedAt = item.changedAt = now;
            snprintf(item.ip, sizeof(item.ip), "%s", ip);
            snprintf(item.name, sizeof(item.name), "%s", "WebSocket viewer");
            return &item;
        }
        return nullptr;
    }

    void authenticated(uint32_t id, const char* name, uint32_t now) {
        auto* item = find(id);
        if (!item) return;
        if (!item->authenticated) item->pingAt = now - WS_PING_MS;
        item->authenticated = true;
        snprintf(item->name, sizeof(item->name), "%s", name);
        auto* device = allocate(item->ip, now);
        if (!device) return;
        device->authenticated = true;
        snprintf(device->lastClient, sizeof(device->lastClient), "%s", item->name);
    }

    void disconnected(uint32_t id, uint32_t now) {
        auto* item = find(id);
        if (!item) return;
        item->open = false;
        item->changedAt = now;
        auto* device = allocate(item->ip, now);
        if (device) device->changedAt = now;
    }

    bool pong(uint32_t id, const uint8_t* data, size_t length, uint32_t now) {
        auto* item = find(id);
        if (!item || !item->authenticated || !item->pingPending ||
            length != sizeof(item->pingNonce) ||
            memcmp(data, &item->pingNonce, length) != 0) return false;
        item->seen = true;
        item->lastSeenAt = item->changedAt = now;
        item->pingPending = false;
        auto* device = allocate(item->ip, now);
        if (device) {
            device->seen = device->lastSeenWasPong = true;
            device->lastSeenAt = device->changedAt = now;
        }
        return true;
    }

    void http(const char* ip, uint32_t now) {
        auto* entry = allocate(ip, now);
        if (!entry) return;
        entry->http = true;
        entry->authenticated = entry->seen = true;
        entry->lastSeenWasPong = false;
        entry->httpSeenAt = entry->lastSeenAt = entry->changedAt = now;
    }

    const char* status(const RemoteDevice& item, uint32_t now) const {
        bool pending = false;
        for (const auto& session : sessions) {
            if (!session.open || strcmp(session.ip, item.ip) != 0) continue;
            if (session.authenticated && session.seen) return "connected";
            pending = true;
        }
        if (item.http && now - item.httpSeenAt < HTTP_RECENT_MS) return "recent";
        if (pending) return "pending";
        return item.websocket ? "disconnected" : "inactive";
    }

private:
    RemoteDevice* allocate(const char* ip, uint32_t now) {
        RemoteDevice* oldest = nullptr;
        for (auto& item : records) {
            if (item.used && strcmp(item.ip, ip) == 0) return &item;
            if (!item.used) {
                if (!oldest || oldest->used) oldest = &item;
            } else if (openCount(item.ip) == 0 &&
                (!oldest || (oldest->used && now - item.changedAt > now - oldest->changedAt))) {
                oldest = &item;
            }
        }
        if (oldest) {
            *oldest = RemoteDevice();
            oldest->used = true;
            snprintf(oldest->ip, sizeof(oldest->ip), "%s", ip);
        }
        return oldest;
    }
};

enum class RecoveryAction { None, Reconnect, Reinitialize, EnableAp };

struct WifiRecovery {
    bool outage = false;
    bool fallbackAp = false;
    uint32_t outageAt = 0;
    uint32_t attemptedAt = 0;
    uint32_t reinitializedAt = 0;
    uint32_t apAttemptedAt = 0;

    void begin(uint32_t now, bool apActive) {
        outage = true;
        fallbackAp = apActive;
        outageAt = attemptedAt = reinitializedAt = apAttemptedAt = now;
    }

    RecoveryAction next(bool configured, bool testing, bool connected, uint32_t now) {
        if (!configured || testing) return RecoveryAction::None;
        if (connected) {
            outage = false;
            return RecoveryAction::None;
        }
        if (!outage) begin(now, fallbackAp);
        if (!fallbackAp && now - outageAt >= 120000 && now - apAttemptedAt >= 30000) {
            apAttemptedAt = now;
            fallbackAp = true;
            return RecoveryAction::EnableAp;
        }
        if (now - reinitializedAt >= 60000) {
            reinitializedAt = attemptedAt = now;
            return RecoveryAction::Reinitialize;
        }
        if (now - attemptedAt >= 10000) {
            attemptedAt = now;
            return RecoveryAction::Reconnect;
        }
        return RecoveryAction::None;
    }
};

}

#endif
