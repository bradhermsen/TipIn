#include "firmware_info.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>

int main() {
    JsonDocument doc;
    doc["schema"] = "TipIn.clock.v1";
    doc["clock"] = "17:00";
    tipin::addFirmwareJson(doc);
    assert(doc.size() == 6);
    assert(doc["schema"] == "TipIn.clock.v1" && doc["clock"] == "17:00");
    assert(doc["firmwareVersion"] == "1.1.0");
    assert(doc["firmwareGitRevision"] == TIPIN_GIT_REVISION);
    assert(strlen(TIPIN_GIT_REVISION) == 12);
    assert(doc["firmwareGitDirty"].is<bool>());
    assert(doc["firmwareGitDirty"] == TIPIN_GIT_DIRTY);
    assert(doc["firmwareBuildTimestamp"] == TIPIN_BUILD_TIMESTAMP);
    assert(strlen(TIPIN_BUILD_TIMESTAMP) == 20 && TIPIN_BUILD_TIMESTAMP[19] == 'Z');
    puts("PASS: firmware metadata JSON types and existing state fields preserved.");
}
