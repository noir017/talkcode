import fs from 'node:fs';
import path from 'node:path';

/**
 * `${VAR}` environment-variable expansion over a parsed config tree, plus an optional
 * `.env` sidecar loader — so credentials can live outside the YAML (gitignorable /
 * injectable by a secret manager) while small deployments may still write them inline.
 *
 * Layering contract (see docs/config-redesign.md §3.2): expansion happens ONCE at load,
 * after YAML parse and before zod validation. The raw (unexpanded) object is what
 * setup/saveConfig operate on, so an expanded secret is never written back to disk.
 */

/** Matches `${VAR}` (expand) and `$${VAR}` (escape → literal `${VAR}`). Uppercase names only, like OpenClaw. */
const ENV_REF = /\$(\$?)\{([A-Z_][A-Z0-9_]*)\}/g;

/**
 * Recursively expand `${VAR}` references in every string of a parsed config tree.
 * Non-strings pass through untouched. All missing variables are collected and thrown
 * as ONE error (with their config paths), so the user fixes everything at once —
 * mirrors the aggregate style of loadConfig's zod error report.
 */
export function expandEnvVars(raw: unknown, env: NodeJS.ProcessEnv = process.env): unknown {
  const missing: string[] = [];

  const walk = (value: unknown, at: string): unknown => {
    if (typeof value === 'string') {
      return value.replace(ENV_REF, (_m, escape: string, name: string) => {
        if (escape) return `\${${name}}`; // $${VAR} → literal ${VAR}
        const v = env[name];
        if (v === undefined) {
          missing.push(`${at}: \${${name}}`);
          return '';
        }
        return v;
      });
    }
    if (Array.isArray(value)) return value.map((v, i) => walk(v, `${at}[${i}]`));
    if (value !== null && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = walk(v, at === '' ? k : `${at}.${k}`);
      }
      return out;
    }
    return value;
  };

  const expanded = walk(raw, '');
  if (missing.length) {
    throw new Error(
      `config references undefined environment variables:\n${missing.map((m) => `  - ${m}`).join('\n')}\n` +
        `export them, or put KEY=value lines in ${path.join('<configDir>', '.env')}`
    );
  }
  return expanded;
}

/**
 * Load `<dir>/.env` (if present) into process.env WITHOUT overriding variables that
 * are already set — the process environment wins, the sidecar only fills gaps.
 * Minimal dotenv dialect: `KEY=value` lines, `#` comments, optional single/double
 * quotes around the value, `export ` prefix tolerated. No interpolation.
 */
export function loadDotEnv(dir: string, env: NodeJS.ProcessEnv = process.env): void {
  applyDotEnvDelta(env, dotEnvDelta(dir, env));
}

/**
 * The variables each environment object took from the sidecar, as opposed to the ones it was
 * started with.
 *
 * "Already set" means "set by whoever started us" only at the first load. After it, every key the
 * sidecar filled in is set too — by us — so a reload that went by `env[key] === undefined` alone
 * could never change a value `.env` had already supplied, and would never drop one deleted from it.
 * Keyed by the env object so a test's throwaway env keeps its own record.
 */
const sidecarKeys = new WeakMap<NodeJS.ProcessEnv, Set<string>>();

/** What reading `<dir>/.env` (again) would do to an environment. */
export interface DotEnvDelta {
  /** Values to write: gaps the sidecar fills, and sidecar values that changed. */
  set: Record<string, string>;
  /** Keys the sidecar supplied before and no longer does. */
  unset: string[];
  /** Every key the sidecar supplies once this is applied. */
  owned: Set<string>;
}

/**
 * Compute, without touching `env`, what loading `<dir>/.env` would change. Split from applying it
 * so a config reload can validate against the candidate environment first and leave the process
 * exactly as it was when the new files do not load (see config/load.ts readConfig).
 */
export function dotEnvDelta(dir: string, env: NodeJS.ProcessEnv = process.env): DotEnvDelta {
  const before = sidecarKeys.get(env) ?? new Set<string>();
  const entries = readDotEnv(dir);
  const delta: DotEnvDelta = { set: {}, unset: [], owned: new Set() };
  for (const [key, value] of entries) {
    // The process environment still wins, but only over keys it really set.
    if (env[key] !== undefined && !before.has(key)) continue;
    delta.owned.add(key);
    if (env[key] !== value) delta.set[key] = value;
  }
  for (const key of before) if (!entries.has(key)) delta.unset.push(key);
  return delta;
}

/** Apply a delta from dotEnvDelta to the environment it was computed against. */
export function applyDotEnvDelta(env: NodeJS.ProcessEnv, delta: DotEnvDelta): void {
  for (const [key, value] of Object.entries(delta.set)) env[key] = value;
  for (const key of delta.unset) delete env[key];
  sidecarKeys.set(env, delta.owned);
}

/** The sidecar's `KEY=value` pairs, in file order; empty when there is no file. */
function readDotEnv(dir: string): Map<string, string> {
  const entries = new Map<string, string>();
  let text: string;
  try {
    text = fs.readFileSync(path.join(dir, '.env'), 'utf8');
  } catch {
    return entries; // no sidecar — fine
  }
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!;
    let value = m[2]!.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    entries.set(key, value);
  }
  return entries;
}
