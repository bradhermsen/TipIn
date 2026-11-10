#include "gateway_clients_json.h"
#include <assert.h>
#include <stdio.h>
#include <string>

int main() {
    tipin::ClientHistory history;
    JsonDocument empty;
    tipin::buildClientsJson(empty, history, 10);
    assert(empty["clients"].is<JsonArray>() && empty["clients"].size() == 0);

    auto* connected = history.connected(1, "192.168.1.1", 100);
    assert(connected);
    history.authenticated(1, "<img onerror=\"x\">", 110);
    connected->pingPending = true;
    connected->pingNonce = 123;
    uint32_t nonce = 123;
    assert(history.pong(1, reinterpret_cast<uint8_t*>(&nonce), sizeof(nonce), 120));
    history.http("192.168.1.2", 140);
    auto* pending = history.connected(2, "192.168.1.3", 150);
    assert(pending);

    JsonDocument doc;
    tipin::buildClientsJson(doc, history, 200);
    assert(doc.size() == 4 && !doc.overflowed());
    assert(doc["uptimeMs"] == 200 && doc["capacity"] == 20);
    assert(doc["retention"] == "ram_until_restart");
    assert(doc["clients"].size() == 3);
    JsonArray rows = doc["clients"].as<JsonArray>();
    for (JsonObject row : rows) assert(row.size() == 10);
    assert(rows[0]["ip"] == "192.168.1.1");
    assert(rows[0]["transport"] == "websocket" && rows[0]["status"] == "connected");
    assert(rows[0]["lastSeenAgeMs"] == 80 && rows[0]["connectedAgeMs"] == 100);
    assert(rows[0]["lastSeenBasis"] == "websocket_pong");
    assert(rows[0]["authenticated"] == true);
    assert(rows[0]["activeConnections"] == 1);
    assert(rows[0]["clientNames"].size() == 1);
    assert(rows[1]["transport"] == "http" && rows[1]["status"] == "recent");
    assert(rows[1]["lastSeenAgeMs"] == 60 && rows[1]["connectedAgeMs"].isNull());
    assert(rows[1]["lastSeenBasis"] == "authenticated_request");
    assert(rows[2]["status"] == "pending" && rows[2]["lastSeenBasis"] == "none");
    assert(rows[2]["lastSeenAgeMs"].isNull() && rows[2]["connectedAgeMs"] == 50);
    assert(rows[2]["authenticated"] == false);

    std::string serialized;
    serializeJson(doc, serialized);
    JsonDocument parsed;
    assert(!deserializeJson(parsed, serialized));
    assert(parsed["clients"][0]["client"] == "<img onerror=\"x\">");
    assert(serialized.find("\\\"x\\\"") != std::string::npos);
    assert(serialized.find("token") == std::string::npos && serialized.find("password") == std::string::npos);

    history.disconnected(1, 210);
    JsonDocument expired;
    tipin::buildClientsJson(expired, history, 60140);
    assert(expired["clients"][0]["status"] == "disconnected");
    assert(expired["clients"][0]["connectedAgeMs"].isNull());
    assert(expired["clients"][1]["status"] == "inactive");
    history.records[0].lastSeenAt = UINT32_MAX - 100;
    JsonDocument rollover;
    tipin::buildClientsJson(rollover, history, 20);
    assert(rollover["clients"][0]["lastSeenAgeMs"] == 121);

    history.http("192.168.1.1", 70000);
    assert(history.connected(3, "192.168.1.1", 70010));
    assert(history.connected(4, "192.168.1.1", 70020));
    assert(history.connected(5, "192.168.1.1", 70030));
    history.authenticated(3, "admin-ui", 70040);
    history.authenticated(4, "ws-diag", 70040);
    history.authenticated(5, "admin-ui", 70040);
    auto* admin = history.find(3);
    admin->pingPending = true;
    admin->pingNonce = 123;
    assert(history.pong(3, reinterpret_cast<uint8_t*>(&nonce), sizeof(nonce), 70050));
    JsonDocument grouped;
    tipin::buildClientsJson(grouped, history, 70100);
    assert(grouped["clients"].size() == 3);
    JsonObject row = grouped["clients"][0].as<JsonObject>();
    assert(row["transport"] == "http + websocket");
    assert(row["activeConnections"] == 3 && row["connectedAgeMs"] == 90);
    assert(row["status"] == "connected" && row["lastSeenAgeMs"] == 50);
    assert(row["lastSeenBasis"] == "websocket_pong");
    assert(row["clientNames"].size() == 3);
    assert(row["clientNames"][0] == "Admin / authenticated API");
    assert(row["clientNames"][1] == "admin-ui" && row["clientNames"][2] == "ws-diag");
    history.disconnected(3, 70110);
    history.http("192.168.1.1", 70120);
    JsonDocument partial;
    tipin::buildClientsJson(partial, history, 70200);
    assert(partial["clients"][0]["activeConnections"] == 2);
    assert(partial["clients"][0]["connectedAgeMs"] == 180);
    assert(partial["clients"][0]["lastSeenBasis"] == "authenticated_request");
    assert(partial["clients"][0]["status"] == "recent");
    history.disconnected(4, 70210);
    history.disconnected(5, 70220);
    JsonDocument closed;
    tipin::buildClientsJson(closed, history, 70230);
    assert(closed["clients"][0]["activeConnections"] == 0);
    assert(closed["clients"][0]["connectedAgeMs"].isNull());
    assert(closed["clients"][0]["clientNames"].size() == 2);
    assert(closed["clients"][0]["clientNames"][1] == "admin-ui");
    puts("PASS: per-IP API schema, mixed transports, deduplicated names, counts, latest activity, null ages, escaped names and rollover.");
}
