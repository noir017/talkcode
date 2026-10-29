import { encodeFrame, type FrameHeader } from './frame.js';

/**
 * The gateway's half of the reliable link — the mirror of remote/link.go. Read that file's header
 * for the scheme; in short: sequenced frames are numbered and kept until the peer acknowledges them,
 * so a dropped connection loses nothing, and the handshake on the next one says exactly what to
 * resend. Control frames (ping/pong/ack, hello/welcome) are unnumbered and never kept.
 *
 * What sits in `unacked` on THIS side is what the gateway asked of the host while the link was down
 * — a prompt typed during the outage, a `/stop`, an attachment being placed — and it is resent the
 * moment a connection is back, in order.
 */

/** Send an acknowledgement after this many received bytes, or ACK_DELAY_MS after the first. */
const ACK_EVERY_BYTES = 64 << 10;
const ACK_DELAY_MS = 100;

/** Above this, the backlog is worth a warning — not a limit: nothing the gateway sends is dropped. */
const BACKLOG_WARN_BYTES = 64 << 20;

export interface LinkTransport {
  write(buf: Buffer): void;
}

export class SequenceGapError extends Error {}

export class ReliableLink {
  private sendSeq = 0;
  private unacked: Array<{ seq: number; buf: Buffer }> = [];
  private unackedBytes = 0;
  private recv = 0;
  private pendingAck = 0;
  private ackTimer: ReturnType<typeof setTimeout> | undefined;
  private transport: LinkTransport | undefined;
  private warned = false;

  /** The highest contiguous sequence received from the host — what `hello.recv` reports. */
  get recvSeq(): number {
    return this.recv;
  }

  /** Whether anything has ever been exchanged: a host that comes back without it lost our state. */
  get hasState(): boolean {
    return this.sendSeq > 0 || this.recv > 0;
  }

  get backlogBytes(): number {
    return this.unackedBytes;
  }

  get connected(): boolean {
    return this.transport !== undefined;
  }

  /** Number, keep and (when connected) transmit one frame. */
  send(h: FrameHeader, body?: Uint8Array): void {
    this.sendSeq += 1;
    h.s = this.sendSeq;
    if (this.recv > 0) h.a = this.recv;
    const buf = encodeFrame(h, body);
    this.unacked.push({ seq: h.s, buf });
    this.unackedBytes += buf.length;
    if (this.unackedBytes > BACKLOG_WARN_BYTES && !this.warned) {
      this.warned = true;
      console.warn(`[remote] ${Math.round(this.unackedBytes / 1048576)} MiB waiting for a host that is not answering`);
    }
    if (this.transport) {
      this.transport.write(buf);
      this.pendingAck = 0;
    }
  }

  /** Transmit an unnumbered frame on the live connection; dropped while there is none. */
  control(h: FrameHeader): void {
    if (!this.transport) return;
    if (this.recv > 0) h.a = this.recv;
    this.transport.write(encodeFrame(h));
    if (this.recv > 0) this.pendingAck = 0;
  }

  /**
   * Account for one received frame: its acknowledgement, then its number. True means "deliver it";
   * false a control frame or a duplicate (already delivered before a reconnect). A gap throws — on
   * an ordered stream that resumed where we said we were, it means the stream is corrupt, and the
   * connection is dropped and re-established.
   */
  receive(h: FrameHeader, bodyBytes: number): boolean {
    if (h.a) this.ackUpTo(h.a);
    if (!h.s) return false;
    if (h.s <= this.recv) return false;
    if (h.s !== this.recv + 1) throw new SequenceGapError(`sequence gap: expected ${this.recv + 1}, got ${h.s}`);
    this.recv = h.s;
    this.pendingAck += bodyBytes + 1;
    if (this.pendingAck >= ACK_EVERY_BYTES) this.flushAck();
    else if (!this.ackTimer) {
      this.ackTimer = setTimeout(() => {
        this.ackTimer = undefined;
        if (this.pendingAck > 0) this.flushAck();
      }, ACK_DELAY_MS);
      this.ackTimer.unref?.();
    }
    return true;
  }

  /** Make `transport` the live connection and resend everything the host has not seen. */
  attach(transport: LinkTransport, peerRecv: number): void {
    this.ackUpTo(peerRecv);
    this.transport = transport;
    for (const f of this.unacked) transport.write(f.buf);
    this.pendingAck = 0;
  }

  detach(): void {
    this.transport = undefined;
  }

  /** Forget everything: the host on the other side has no memory of this link any more. */
  reset(): void {
    this.sendSeq = 0;
    this.unacked = [];
    this.unackedBytes = 0;
    this.recv = 0;
    this.pendingAck = 0;
    this.warned = false;
  }

  private ackUpTo(a: number): void {
    let i = 0;
    while (i < this.unacked.length && this.unacked[i]!.seq <= a) {
      this.unackedBytes -= this.unacked[i]!.buf.length;
      i++;
    }
    if (i > 0) this.unacked = this.unacked.slice(i);
    if (this.unackedBytes <= BACKLOG_WARN_BYTES / 2) this.warned = false;
  }

  private flushAck(): void {
    if (!this.transport) return;
    this.transport.write(encodeFrame({ t: 'ack', a: this.recv }));
    this.pendingAck = 0;
  }
}
