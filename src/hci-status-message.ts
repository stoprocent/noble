import type { DisconnectReason } from './types';
import hciStatus from './bindings/hci/hci-status.json';

const HCI_STATUS: ReadonlyArray<string | undefined> = hciStatus;

/** Resolves a numeric HCI status code to its Bluetooth specification message. */
export function hciStatusMessage (reason: DisconnectReason): string {
  if (typeof reason !== 'number') {
    return String(reason);
  }

  const message = HCI_STATUS[reason];
  if (message) {
    return message;
  }

  const code = Number.isInteger(reason)
    ? `0x${reason.toString(16).padStart(2, '0')}`
    : String(reason);

  return `Unknown HCI status (${code})`;
}
