/*
 * The C boundary between the Swift CoreBluetooth core (the .swift files next to it)
 * and the N-API glue (noble_mac.cc).
 *
 * - The glue includes this header as C++.
 * - Swift imports it as its bridging header (-import-objc-header) and
 *   implements the "requests" half with @_cdecl.
 *
 * Conventions:
 * - peripheral ids and UUIDs are lowercase hex without dashes, in both
 *   directions (Swift also accepts dashed / uppercase input);
 * - every pointer is only valid for the duration of the call: the callee
 *   copies whatever it wants to keep;
 * - `context` is the opaque pointer passed to noble_mac_create(). Swift hands
 *   it back verbatim and never calls into the glue again once
 *   noble_mac_destroy() has returned.
 */
#ifndef NOBLE_MAC_BRIDGE_H
#define NOBLE_MAC_BRIDGE_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* ------------------------------------------------------------------------ */
/* Value types                                                              */
/* ------------------------------------------------------------------------ */

typedef struct NobleMacCharacteristic
{
    const char* uuid;
    /* CBCharacteristicProperties raw value (bit 0 = broadcast, 1 = read, ...). */
    uint32_t properties;
} NobleMacCharacteristic;

typedef struct NobleMacServiceData
{
    const char* uuid;
    const uint8_t* data;
    size_t length;
} NobleMacServiceData;

typedef struct NobleMacDiscovery
{
    const char* peripheralId;
    /* "" when CoreBluetooth does not know the MAC address. */
    const char* address;
    /* "public", "random" or "unknown". */
    const char* addressType;
    bool connectable;
    /* NULL when the advertisement carries no name. */
    const char* localName;
    bool hasTxPowerLevel;
    int32_t txPowerLevel;
    bool hasManufacturerData;
    const uint8_t* manufacturerData;
    size_t manufacturerDataLength;
    const NobleMacServiceData* serviceData;
    size_t serviceDataCount;
    const char* const* serviceUuids;
    size_t serviceUuidCount;
    int32_t rssi;
} NobleMacDiscovery;

/* ------------------------------------------------------------------------ */
/* Results and notifications: implemented by the glue, called by Swift      */
/* from any thread.                                                         */
/* ------------------------------------------------------------------------ */

void noble_mac_resolve_void(void* context, uint64_t requestId);
void noble_mac_resolve_number(void* context, uint64_t requestId, int32_t value);
void noble_mac_resolve_data(void* context, uint64_t requestId, const uint8_t* data, size_t length);
void noble_mac_resolve_strings(void* context, uint64_t requestId, const char* const* values, size_t count);
void noble_mac_resolve_characteristics(void* context, uint64_t requestId,
                                       const NobleMacCharacteristic* characteristics, size_t count);
void noble_mac_reject(void* context, uint64_t requestId, const char* message);
/* Rejects with an Error that also carries the NSError it stems from, as
 * `nativeErrorDomain` (string) and `nativeErrorCode` (number). A NULL or empty
 * `domain` means there is no native error: same as noble_mac_reject(). */
void noble_mac_reject_native(void* context, uint64_t requestId, const char* message, const char* domain,
                             int64_t code);

void noble_mac_on_state_change(void* context, const char* state);
void noble_mac_on_scan_start(void* context, bool filterDuplicates);
void noble_mac_on_scan_stop(void* context);
void noble_mac_on_discover(void* context, const NobleMacDiscovery* discovery);
void noble_mac_on_connect(void* context, const char* peripheralId);
void noble_mac_on_disconnect(void* context, const char* peripheralId, const char* reason);
void noble_mac_on_mtu(void* context, const char* peripheralId, int32_t mtu);
void noble_mac_on_rssi(void* context, const char* peripheralId, int32_t rssi);
void noble_mac_on_notification(void* context, const char* peripheralId, const char* serviceUuid,
                               const char* characteristicUuid, const uint8_t* data, size_t length);

/* ------------------------------------------------------------------------ */
/* Requests: implemented by Swift (@_cdecl in Exports.swift), called by the */
/* glue on the JS thread. Hidden from Swift itself so the declarations and  */
/* their definitions can never clash in the importer.                       */
/* ------------------------------------------------------------------------ */

#ifndef NOBLE_MAC_IMPORTING_INTO_SWIFT

/* Returns the manager handle expected by every function below. */
void* noble_mac_create(void* context);
/* Blocks until the core is quiescent; `context` is not used afterwards. */
void noble_mac_destroy(void* manager);

void noble_mac_start_scanning(void* manager, uint64_t requestId, const char* const* serviceUuids,
                              size_t serviceUuidCount, bool allowDuplicates);
void noble_mac_stop_scanning(void* manager, uint64_t requestId);

void noble_mac_connect(void* manager, uint64_t requestId, const char* peripheralId);
void noble_mac_cancel_connect(void* manager, const char* peripheralId);
void noble_mac_disconnect(void* manager, const char* peripheralId);
void noble_mac_update_rssi(void* manager, uint64_t requestId, const char* peripheralId);

void noble_mac_discover_services(void* manager, uint64_t requestId, const char* peripheralId,
                                 const char* const* serviceUuids, size_t serviceUuidCount);
void noble_mac_discover_included_services(void* manager, uint64_t requestId, const char* peripheralId,
                                          const char* serviceUuid, const char* const* serviceUuids,
                                          size_t serviceUuidCount);
void noble_mac_discover_characteristics(void* manager, uint64_t requestId, const char* peripheralId,
                                        const char* serviceUuid, const char* const* characteristicUuids,
                                        size_t characteristicUuidCount);

void noble_mac_read(void* manager, uint64_t requestId, const char* peripheralId, const char* serviceUuid,
                    const char* characteristicUuid);
void noble_mac_write(void* manager, uint64_t requestId, const char* peripheralId, const char* serviceUuid,
                     const char* characteristicUuid, const uint8_t* data, size_t length,
                     bool withoutResponse);
void noble_mac_notify(void* manager, uint64_t requestId, const char* peripheralId, const char* serviceUuid,
                      const char* characteristicUuid, bool enable);

void noble_mac_discover_descriptors(void* manager, uint64_t requestId, const char* peripheralId,
                                    const char* serviceUuid, const char* characteristicUuid);
void noble_mac_read_value(void* manager, uint64_t requestId, const char* peripheralId,
                          const char* serviceUuid, const char* characteristicUuid,
                          const char* descriptorUuid);
void noble_mac_write_value(void* manager, uint64_t requestId, const char* peripheralId,
                           const char* serviceUuid, const char* characteristicUuid,
                           const char* descriptorUuid, const uint8_t* data, size_t length);

void noble_mac_read_handle(void* manager, uint64_t requestId, const char* peripheralId, int32_t handle);
void noble_mac_write_handle(void* manager, uint64_t requestId, const char* peripheralId, int32_t handle,
                            const uint8_t* data, size_t length, bool withoutResponse);

#endif /* NOBLE_MAC_IMPORTING_INTO_SWIFT */

#ifdef __cplusplus
}
#endif

#endif /* NOBLE_MAC_BRIDGE_H */
