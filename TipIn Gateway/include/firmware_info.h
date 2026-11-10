#ifndef TIPIN_FIRMWARE_INFO_H
#define TIPIN_FIRMWARE_INFO_H

#include <ArduinoJson.h>
#include "firmware_build.h"

namespace tipin {

constexpr const char* FIRMWARE_VERSION = "1.1.0";

inline void addFirmwareJson(JsonDocument& doc) {
    doc["firmwareVersion"] = FIRMWARE_VERSION;
    doc["firmwareBuildTimestamp"] = TIPIN_BUILD_TIMESTAMP;
    doc["firmwareGitRevision"] = TIPIN_GIT_REVISION;
    doc["firmwareGitDirty"] = TIPIN_GIT_DIRTY;
}

}

#endif
