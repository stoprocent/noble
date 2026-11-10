import createDebug from 'debug';
import { platform } from 'os';

import type { ConnectionParameterUpdateRequest, L2capChannelHandler } from './types';

const debug = createDebug('signaling');

const CONNECTION_PARAMETER_UPDATE_REQUEST = 0x12;
const CONNECTION_PARAMETER_UPDATE_RESPONSE = 0x13;

const SIGNALING_CID = 0x0005;

/** The slice of `AclStream` that `Signaling` drives. */
export interface SignalingChannel {
  registerChannel (cid: number, handler: L2capChannelHandler): void;
  write (cid: number, data: Buffer): void;
}

/** L2CAP LE signaling channel: answers connection parameter update requests. */
export class Signaling {
  constructor (
    private readonly handle: number,
    private readonly aclStream: SignalingChannel,
    private readonly userChannel: boolean,
    private readonly onConnectionParameterUpdateRequest: (request: ConnectionParameterUpdateRequest) => void
  ) {
    this.aclStream.registerChannel(SIGNALING_CID, (data) => this.onAclStreamData(data));
  }

  private onAclStreamData (data: Buffer): void {
    debug(`onAclStreamData: ${data.toString('hex')}`);

    const code = data.readUInt8(0);
    const identifier = data.readUInt8(1);
    const length = data.readUInt16LE(2);
    const signalingData = data.slice(4);

    debug(`\tcode = ${code}`);
    debug(`\tidentifier = ${identifier}`);
    debug(`\tlength = ${length}`);

    if (code === CONNECTION_PARAMETER_UPDATE_REQUEST) {
      this.processConnectionParameterUpdateRequest(identifier, signalingData);
    }
  }

  private processConnectionParameterUpdateRequest (identifier: number, data: Buffer): void {
    const minInterval = data.readUInt16LE(0) * 1.25;
    const maxInterval = data.readUInt16LE(2) * 1.25;
    const latency = data.readUInt16LE(4);
    const supervisionTimeout = data.readUInt16LE(6) * 10;

    debug('\t\tmin interval = ', minInterval);
    debug('\t\tmax interval = ', maxInterval);
    debug('\t\tlatency = ', latency);
    debug('\t\tsupervision timeout = ', supervisionTimeout);

    // On Linux the kernel answers the request itself, unless we own the
    // adapter exclusively through the HCI user channel.
    if (platform() !== 'linux' || this.userChannel) {
      const response = Buffer.alloc(6);

      response.writeUInt8(CONNECTION_PARAMETER_UPDATE_RESPONSE, 0); // code
      response.writeUInt8(identifier, 1); // identifier
      response.writeUInt16LE(2, 2); // length
      response.writeUInt16LE(0, 4);

      this.aclStream.write(SIGNALING_CID, response);

      this.onConnectionParameterUpdateRequest({
        handle: this.handle,
        minInterval,
        maxInterval,
        latency,
        supervisionTimeout
      });
    }
  }
}
