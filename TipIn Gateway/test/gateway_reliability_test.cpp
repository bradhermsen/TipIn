#include "gateway_reliability.h"
#include <assert.h>
#include <stdio.h>
#include <limits.h>

using namespace tipin;

void testHttpHistory() {
    ClientHistory history;
    history.http("192.168.1.10", 100);
    auto& http = history.records[0];
    assert(http.used && http.http && http.authenticated && http.seen && !http.websocket);
    assert(strcmp(history.status(http, 60099), "recent") == 0);
    assert(strcmp(history.status(http, 60100), "inactive") == 0);
    history.http("192.168.1.10", 500);
    assert(http.lastSeenAt == 500 && !history.records[1].used);
    history.http("192.168.1.11", UINT32_MAX - 100);
    assert(strcmp(history.status(history.records[1], 500), "recent") == 0);
}

void testLiveness() {
    ClientHistory history;
    auto* item = history.connected(42, "192.168.1.42", 100);
    assert(item && !item->seen && !item->authenticated);
    assert(strcmp(history.status(history.records[0], 100), "pending") == 0);
    assert(closeReason(*item, 10099) == nullptr);
    assert(strcmp(closeReason(*item, 10100), "Authentication timeout") == 0);
    uint32_t nonce = 0x12345678;
    item->pingNonce = nonce;
    item->pingPending = true;
    const auto* payload = reinterpret_cast<const uint8_t*>(&nonce);
    assert(!history.pong(42, payload, sizeof(nonce), 200));
    history.authenticated(42, "Clock Display", 200);
    item->pingAt = 200;
    assert(!history.pong(42, payload, 0, 201));
    assert(!history.pong(41, payload, sizeof(nonce), 201));
    uint32_t wrong = nonce + 1;
    assert(!history.pong(42, reinterpret_cast<const uint8_t*>(&wrong), sizeof(wrong), 201));
    assert(!item->seen);
    assert(history.pong(42, payload, sizeof(nonce), 202));
    assert(item->seen && item->lastSeenAt == 202 && !item->pingPending);
    assert(strcmp(history.status(history.records[0], 202), "connected") == 0);
    assert(history.records[0].lastSeenAt == 202 && history.records[0].lastSeenWasPong);
    assert(!history.pong(42, payload, sizeof(nonce), 203));
    assert(!pingDue(*item, 10199));
    assert(pingDue(*item, 10200));
    item->pingPending = true;
    item->pingAt = 10200;
    assert(!pingDue(*item, 50000));
    assert(closeReason(*item, 40199) == nullptr);
    assert(strcmp(closeReason(*item, 40200), "Pong timeout") == 0);
    history.disconnected(42, 40200);
    assert(history.find(42) == nullptr && history.openCount() == 0);
    assert(strcmp(history.status(history.records[0], 40200), "disconnected") == 0);
    assert(!history.pong(42, payload, sizeof(nonce), 40201));
}

void testBackpressureAndRollover() {
    RemoteClient item;
    item.authenticated = true;
    recordSend(item, false, 100);
    assert(item.congested && item.congestionAt == 100);
    recordSend(item, false, 200);
    assert(item.congestionAt == 100);
    assert(closeReason(item, 10099) == nullptr);
    assert(strcmp(closeReason(item, 10100), "Slow client") == 0);
    recordSend(item, true, 10101);
    assert(!item.congested && closeReason(item, 20000) == nullptr);
    item.pingPending = true;
    item.pingAt = UINT32_MAX - 20000;
    assert(closeReason(item, 9998) == nullptr);
    assert(strcmp(closeReason(item, 9999), "Pong timeout") == 0);
    item.pingPending = false;
    item.pingAt = UINT32_MAX - 5000;
    assert(!pingDue(item, 4998));
    assert(pingDue(item, 4999));
}

void testBoundedHistory() {
    ClientHistory history;
    for (uint32_t id = 1; id <= MAX_WS_CLIENTS; id++) {
        char ip[48];
        snprintf(ip, sizeof(ip), "192.168.1.%u", static_cast<unsigned>(id));
        assert(history.connected(id, ip, id));
    }
    assert(!history.connected(100, "192.168.1.2", 100));
    for (uint32_t id = 0; id < 40; id++) {
        char ip[48];
        snprintf(ip, sizeof(ip), "192.168.2.%u", static_cast<unsigned>(id));
        history.http(ip, id + 100);
    }
    size_t used = 0;
    for (const auto& entry : history.records) if (entry.used) used++;
    assert(used == MAX_CLIENT_HISTORY && history.openCount() == MAX_WS_CLIENTS);
    for (uint32_t id = 1; id <= MAX_WS_CLIENTS; id++) assert(history.find(id));
    history.disconnected(3, 150);
    assert(history.connected(100, "192.168.1.2", 151));
    assert(history.openCount() == MAX_WS_CLIENTS);

    ClientHistory rollover;
    for (uint32_t index = 0; index < MAX_CLIENT_HISTORY; index++) {
        char ip[48];
        snprintf(ip, sizeof(ip), "10.0.0.%u", static_cast<unsigned>(index));
        rollover.http(ip, UINT32_MAX - 1000 + index);
    }
    rollover.http("10.0.1.1", 10);
    assert(strcmp(rollover.records[0].ip, "10.0.1.1") == 0);
    assert(strcmp(rollover.records[1].ip, "10.0.0.1") == 0);
}

size_t usedCount(const ClientHistory& history) {
    size_t count = 0;
    for (const auto& entry : history.records) if (entry.used) count++;
    return count;
}

void testSameIpReconnects() {
    ClientHistory history;
    history.http("192.168.68.69", 100);
    assert(history.connected(1, "192.168.68.67", 101));
    history.authenticated(1, "TipIn Clock Display", 102);
    for (uint32_t index = 2; index < MAX_CLIENT_HISTORY; index++) {
        char ip[48];
        snprintf(ip, sizeof(ip), "10.0.0.%u", static_cast<unsigned>(index));
        history.http(ip, 103 + index);
    }
    assert(usedCount(history) == MAX_CLIENT_HISTORY);
    for (uint32_t id = 2; id < 502; id++) {
        assert(history.connected(id, "192.168.68.69", id + 200));
        history.authenticated(id, "admin-ui", id + 201);
        history.http("192.168.68.69", id + 202);
        assert(usedCount(history) == MAX_CLIENT_HISTORY);
        assert(history.openCount("192.168.68.69") == 1);
        history.disconnected(id, id + 203);
    }
    assert(history.find(1) && history.openCount() == 1 && usedCount(history) == MAX_CLIENT_HISTORY);
    assert(strcmp(history.records[0].lastClient, "admin-ui") == 0);
    assert(strcmp(history.records[1].ip, "192.168.68.67") == 0);
    for (uint32_t index = 2; index < MAX_CLIENT_HISTORY; index++) {
        char ip[48];
        snprintf(ip, sizeof(ip), "10.0.0.%u", static_cast<unsigned>(index));
        assert(strcmp(history.records[index].ip, ip) == 0);
    }
    assert(history.connected(502, "192.168.68.69", 800));
    assert(history.connected(503, "192.168.68.69", 801));
    history.authenticated(502, "admin-ui", 802);
    history.authenticated(503, "ws-diag", 803);
    auto* a = history.find(502);
    auto* b = history.find(503);
    assert(a && b && a != b);
    a->pingPending = b->pingPending = true;
    a->pingNonce = 12;
    b->pingNonce = 34;
    uint32_t nonce = 12;
    assert(!history.pong(503, reinterpret_cast<uint8_t*>(&nonce), sizeof(nonce), 804));
    assert(history.pong(502, reinterpret_cast<uint8_t*>(&nonce), sizeof(nonce), 804));
    assert(a->seen && !b->seen && b->pingPending);
    assert(history.records[0].lastSeenAt == 804 && history.records[0].lastSeenWasPong);
    history.http("192.168.68.69", 805);
    assert(!history.records[0].lastSeenWasPong && history.records[0].lastSeenAt == 805);
    assert(strcmp(history.status(history.records[0], 805), "connected") == 0);
    history.disconnected(502, 806);
    assert(history.find(503) && history.openCount("192.168.68.69") == 1);
    assert(strcmp(history.status(history.records[0], 806), "recent") == 0);
    assert(strcmp(history.status(history.records[0], 60805), "pending") == 0);
    history.disconnected(503, 60806);
    assert(strcmp(history.status(history.records[0], 60806), "disconnected") == 0);
    assert(history.connected(504, "192.168.68.69", 61000));
    assert(strcmp(history.status(history.records[0], 61000), "pending") == 0);
    assert(usedCount(history) == MAX_CLIENT_HISTORY);
}

void testRecovery() {
    WifiRecovery recovery;
    recovery.begin(100, false);
    assert(recovery.next(false, false, false, 100000) == RecoveryAction::None);
    assert(recovery.next(true, true, false, 100000) == RecoveryAction::None);
    assert(recovery.next(true, false, false, 10099) == RecoveryAction::None);
    assert(recovery.next(true, false, false, 10100) == RecoveryAction::Reconnect);
    assert(recovery.next(true, false, false, 10101) == RecoveryAction::None);
    assert(recovery.next(true, false, false, 60099) == RecoveryAction::Reconnect);
    assert(recovery.next(true, false, false, 60100) == RecoveryAction::Reinitialize);
    assert(recovery.next(true, false, false, 120099) == RecoveryAction::Reconnect);
    assert(recovery.next(true, false, false, 120100) == RecoveryAction::EnableAp);
    assert(recovery.fallbackAp);
    assert(recovery.next(true, false, false, 120101) == RecoveryAction::Reinitialize);
    assert(recovery.next(true, false, true, 130000) == RecoveryAction::None);
    assert(!recovery.outage);
    assert(recovery.next(true, false, false, 140000) == RecoveryAction::None);
    assert(recovery.next(true, false, false, 150000) == RecoveryAction::Reconnect);
    assert(recovery.fallbackAp);

    recovery.begin(UINT32_MAX - 5000, false);
    assert(recovery.next(true, false, false, 4998) == RecoveryAction::None);
    assert(recovery.next(true, false, false, 4999) == RecoveryAction::Reconnect);
    assert(recovery.next(true, false, false, 54999) == RecoveryAction::Reinitialize);
    assert(recovery.next(true, false, false, 114999) == RecoveryAction::EnableAp);

    recovery.begin(0, true);
    assert(recovery.next(true, false, false, 120000) == RecoveryAction::Reinitialize);

    recovery.begin(0, false);
    assert(recovery.next(true, false, false, 120000) == RecoveryAction::EnableAp);
    recovery.fallbackAp = false; // Driver failed to start the AP.
    assert(recovery.next(true, false, false, 120001) != RecoveryAction::EnableAp);
    assert(recovery.next(true, false, false, 149999) != RecoveryAction::EnableAp);
    assert(recovery.next(true, false, false, 150000) == RecoveryAction::EnableAp);
}

int main() {
    testHttpHistory();
    testLiveness();
    testBackpressureAndRollover();
    testBoundedHistory();
    testSameIpReconnects();
    testRecovery();
    puts("PASS: 20-IP history, 500 admin reconnects, independent same-IP liveness, backpressure, eviction, Wi-Fi recovery and rollover.");
}
