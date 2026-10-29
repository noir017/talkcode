import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { RemoteArch, RemoteBinary, Transport } from './connection.js';

/**
 * Where this gateway's talkcode-remote builds are, and how a connection reaches a host.
 *
 * The builds are produced by `npm run build` (scripts/build-remote.mjs) into `dist/remote-bin/`, one
 * static binary per architecture, and ship inside the release tarball — a host never downloads
 * anything from anywhere but this gateway.
 */

/** `<package root>/dist/remote-bin`: two levels above this file both in `src/remote/` and `dist/remote/`. */
export function remoteBinDir(): string {
  return fileURLToPath(new URL('../../dist/remote-bin', import.meta.url));
}

const cache = new Map<string, RemoteBinary | null>();

/**
 * The build for `arch`, or undefined when this gateway carries none (a development build made for
 * one architecture only). Its version — the directory it is installed under on a host — is the
 * package version plus a prefix of its hash, so a rebuild under an unchanged version number still
 * lands in a new directory, and still retires the daemon of the old one.
 */
export function remoteBinary(arch: RemoteArch, packageVersion: string, dir = remoteBinDir()): RemoteBinary | undefined {
  const path = `${dir}/talkcode-remote-linux-${arch}`;
  const key = `${path}@${packageVersion}`;
  if (!cache.has(key)) {
    if (!existsSync(path)) cache.set(key, null);
    else {
      const sha256 = createHash('sha256').update(readFileSync(path)).digest('hex');
      cache.set(key, { path, sha256, version: `${packageVersion}-${sha256.slice(0, 12)}` });
    }
  }
  return cache.get(key) ?? undefined;
}

export interface SshTarget {
  /** `user@host`, `host`, either with `:port`. */
  destination: string;
  identityFile: string;
  knownHostsFile: string;
}

/** Split `user@host:port` into what ssh takes. A bracketed IPv6 literal keeps its colons. */
export function parseDestination(dest: string): { userHost: string; port?: number } {
  const m = /^(.*?)(?::(\d+))?$/.exec(dest.trim());
  let userHost = m?.[1] ?? dest;
  const port = m?.[2] ? Number(m[2]) : undefined;
  userHost = userHost.replace(/\[([^\]]+)\]$/, '$1').replace(/@\[([^\]]+)\]$/, '@$1');
  return { userHost, port };
}

/**
 * The ssh argv for one connection. Everything that matters is pinned here rather than read from an
 * ssh config file (`-F none`): the gateway's own key and known_hosts, strict host key checking — a
 * changed host key fails the connection instead of being learned — and keepalives, so a dead route
 * is noticed by ssh itself as well as by the link's own heartbeat.
 */
export function sshArgs(target: SshTarget, script: string): string[] {
  const { userHost, port } = parseDestination(target.destination);
  return [
    '-F', 'none',
    '-T',
    '-o', 'BatchMode=yes',
    '-o', 'IdentitiesOnly=yes',
    '-o', `IdentityFile=${target.identityFile}`,
    '-o', `UserKnownHostsFile=${target.knownHostsFile}`,
    '-o', 'StrictHostKeyChecking=yes',
    '-o', 'ConnectTimeout=15',
    '-o', 'ServerAliveInterval=10',
    '-o', 'ServerAliveCountMax=3',
    '-o', 'LogLevel=ERROR',
    ...(port ? ['-p', String(port)] : []),
    '--',
    userHost,
    `sh -c '${script}'`,
  ];
}

export function sshTransport(target: SshTarget, sshCommand = 'ssh'): Transport {
  return (script: string): ChildProcess =>
    spawn(sshCommand, sshArgs(target, script), { stdio: ['pipe', 'pipe', 'pipe'] });
}

/** The package version, for naming builds. */
export function packageVersion(): string {
  const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8')) as {
    version?: string;
  };
  return pkg.version ?? '0.0.0';
}
