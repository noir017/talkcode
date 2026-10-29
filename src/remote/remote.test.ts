import { describe, expect, it } from 'vitest';
import { FrameDecoder, encodeFrame } from './frame.js';
import { ReliableLink } from './link.js';
import { parseDestination, sshArgs } from './binaries.js';

describe('frame', () => {
  it('round-trips headers and raw bodies, across arbitrary chunk boundaries', () => {
    const a = encodeFrame({ t: 'out', s: 1, id: 'p1', fd: 2 }, Buffer.from('héllo\0'));
    const b = encodeFrame({ t: 'ping', n: 3 });
    const all = Buffer.concat([a, b]);
    const dec = new FrameDecoder();
    const frames = [];
    for (let i = 0; i < all.length; i += 3) frames.push(...dec.push(all.subarray(i, i + 3)));
    expect(frames).toHaveLength(2);
    expect(frames[0]!.h).toEqual({ t: 'out', s: 1, id: 'p1', fd: 2 });
    expect(frames[0]!.body.toString()).toBe('héllo\0');
    expect(frames[1]!.h).toEqual({ t: 'ping', n: 3 });
    expect(frames[1]!.body.length).toBe(0);
    expect(dec.pending).toBe(0);
  });

  it('rejects a zero-length or oversized header', () => {
    expect(() => new FrameDecoder().push(Buffer.alloc(8))).toThrow(/malformed/);
    const big = Buffer.alloc(8);
    big.writeUInt32BE(0xffffffff, 0);
    expect(() => new FrameDecoder().push(big)).toThrow(/malformed/);
  });
});

describe('ReliableLink', () => {
  const written = (): { bufs: Buffer[]; write(b: Buffer): void } => {
    const bufs: Buffer[] = [];
    return { bufs, write: (b) => bufs.push(b) };
  };
  const types = (bufs: Buffer[]): string[] =>
    new FrameDecoder().push(Buffer.concat(bufs)).map((f) => `${f.h.t}${f.h.s ? `#${f.h.s}` : ''}`);

  it('queues while disconnected and resends exactly what the peer has not seen', () => {
    const link = new ReliableLink();
    link.send({ t: 'stdin', id: 'p1' }, Buffer.from('a'));
    link.send({ t: 'stdin', id: 'p1' }, Buffer.from('b'));
    link.send({ t: 'signal', id: 'p1', sig: 'SIGINT' });
    const t = written();
    link.attach(t, 1);
    expect(types(t.bufs)).toEqual(['stdin#2', 'signal#3']);
    expect(link.backlogBytes).toBeGreaterThan(0);
    link.receive({ t: 'ack', a: 3 }, 0);
    expect(link.backlogBytes).toBe(0);
  });

  it('delivers in order, drops duplicates, and refuses a gap', () => {
    const link = new ReliableLink();
    expect(link.receive({ t: 'out', s: 1 }, 0)).toBe(true);
    expect(link.receive({ t: 'out', s: 1 }, 0)).toBe(false);
    expect(link.receive({ t: 'pong', n: 1 }, 0)).toBe(false);
    expect(() => link.receive({ t: 'out', s: 3 }, 0)).toThrow(/gap/);
    expect(link.recvSeq).toBe(1);
  });

  it('acknowledges promptly once enough has arrived', () => {
    const link = new ReliableLink();
    const t = written();
    link.attach(t, 0);
    link.receive({ t: 'out', s: 1 }, 70 << 10);
    expect(types(t.bufs)).toEqual(['ack']);
  });

  it('remembers whether anything was ever exchanged, and forgets on reset', () => {
    const link = new ReliableLink();
    expect(link.hasState).toBe(false);
    link.send({ t: 'spawn', id: 'p1' });
    expect(link.hasState).toBe(true);
    link.reset();
    expect(link.hasState).toBe(false);
    expect(link.backlogBytes).toBe(0);
  });
});

describe('ssh', () => {
  it('parses destinations', () => {
    expect(parseDestination('user@host')).toEqual({ userHost: 'user@host', port: undefined });
    expect(parseDestination('user@host:2222')).toEqual({ userHost: 'user@host', port: 2222 });
    expect(parseDestination('[fe80::1]:22')).toEqual({ userHost: 'fe80::1', port: 22 });
    expect(parseDestination('me@[fe80::1]')).toEqual({ userHost: 'me@fe80::1', port: undefined });
  });

  it('pins the key, the known hosts and strict checking, and reads no ssh config', () => {
    const args = sshArgs({ destination: 'u@h:2200', identityFile: '/k', knownHostsFile: '/kh' }, 'echo hi');
    expect(args.slice(0, 2)).toEqual(['-F', 'none']);
    expect(args).toContain('StrictHostKeyChecking=yes');
    expect(args).toContain('IdentityFile=/k');
    expect(args).toContain('UserKnownHostsFile=/kh');
    expect(args.slice(-5)).toEqual(['-p', '2200', '--', 'u@h', `sh -c 'echo hi'`]);
  });
});
