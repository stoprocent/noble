import { Deferred } from '../../common/deferred';
import { NobleError } from '../../common/errors';
import { Smp } from './smp';
import type { AclController, HciAddressType, L2capChannelHandler } from './types';

/**
 * One LE ACL link: demultiplexes inbound L2CAP payloads to the handler
 * registered for their channel, and owns the link's security manager.
 */
export class AclStream {
  private readonly channels = new Map<number, L2capChannelHandler>();
  private readonly smp: Smp;
  private pendingEncrypt: Deferred<void> | null = null;
  private closed = false;

  constructor (
    private readonly hci: AclController,
    private readonly handle: number,
    localAddressType: HciAddressType,
    localAddress: string,
    remoteAddressType: HciAddressType,
    remoteAddress: string
  ) {
    this.smp = new Smp(this, localAddressType, localAddress, remoteAddressType, remoteAddress, {
      onStk: (stk) => this.onSmpStk(stk),
      onFail: () => this.onSmpFail()
    });
  }

  /** Routes the payloads of one L2CAP channel to `handler` (one handler per CID). */
  registerChannel (cid: number, handler: L2capChannelHandler): void {
    this.channels.set(cid, handler);
  }

  write (cid: number, data: Buffer): void {
    this.hci.writeAclDataPkt(this.handle, cid, data);
  }

  /**
   * Starts SMP pairing. Resolves once the controller reports the link as
   * encrypted, rejects when pairing fails or the link goes away. Concurrent
   * callers share one attempt.
   */
  encrypt (): Promise<void> {
    if (this.closed) {
      return Promise.reject(new NobleError('Cannot encrypt: the link is closed'));
    }

    if (this.pendingEncrypt === null) {
      this.pendingEncrypt = new Deferred<void>();
      const { promise } = this.pendingEncrypt;

      this.smp.sendPairingRequest();

      return promise;
    }

    return this.pendingEncrypt.promise;
  }

  /** Inbound L2CAP payload for this link. */
  push (cid: number, data: Buffer): void {
    this.channels.get(cid)?.(data);
  }

  /** HCI Encryption Change for this link. */
  pushEncrypt (encrypt: number): void {
    if (encrypt && this.pendingEncrypt !== null) {
      const pending = this.pendingEncrypt;
      this.pendingEncrypt = null;
      pending.resolve();
    }
  }

  /** The link is gone. */
  close (): void {
    this.closed = true;
    this.channels.clear();

    if (this.pendingEncrypt !== null) {
      const pending = this.pendingEncrypt;
      this.pendingEncrypt = null;
      pending.reject(new NobleError('Encryption failed: the link was closed'));
    }
  }

  private onSmpStk (stk: Buffer): void {
    const random = Buffer.from('0000000000000000', 'hex');
    const diversifier = Buffer.from('0000', 'hex');

    this.hci.startLeEncryption(this.handle, random, diversifier, stk);
  }

  private onSmpFail (): void {
    if (this.pendingEncrypt !== null) {
      const pending = this.pendingEncrypt;
      this.pendingEncrypt = null;
      pending.reject(new NobleError('Encryption failed: pairing was rejected'));
    }
  }
}
