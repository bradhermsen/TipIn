#ifndef TIPIN_GATEWAY_LOCK_H
#define TIPIN_GATEWAY_LOCK_H

#include <mutex>

extern std::recursive_mutex gatewayStateMutex;
using GatewayGuard = std::lock_guard<std::recursive_mutex>;

#endif
