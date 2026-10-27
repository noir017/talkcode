import type { QuotaPool } from '../types.js';

/**
 * What agy tells the footer about a session — context, model, quota — now that its status line is
 * gone from the mode the daemon runs it in.
 *
 * ── Why this exists ───────────────────────────────────────────────────────────
 * All three used to arrive together, off the status line (agy-statusline.ts). agy 1.4.7
 * (2026-10-27) stopped running it in `-p`, which is the only way stream-json can be driven — its
 * changelog: headless runs "no longer start your custom status line and window title commands,
 * none of which print mode shows". Probed the same day, a turn put nothing at all on fd 3, and the
 * footer and the web UI's status strip lost the context bar, the default model's name and the
 * quota pools in one go. So each now comes from wherever agy still publishes it:
 *
 *   context  ← the stream itself: every `agent_response` step's DONE frame carries that model
 *              call's `usage` (new since the status line was built — it is what made it necessary)
 *   window   ← nowhere; agy names no window size on the wire, so it is the table below
 *   model    ← `init` when `--model=` was passed, else a one-shot `agy -p=/model`
 *   quota    ← a one-shot `agy -p=/usage`, the same command `/usage` in chat runs
 *
 * The one-shots are the expensive part (~3.5s each, a round trip to Google, measured on 1.4.7), so
 * the runtime starts them alongside the turn rather than after it; see agent-agy.ts.
 */

/**
 * Context window sizes, by model. agy reports none — not in the stream, not in `agy models`, not
 * in its hooks — so the only way to know one is to have seen agy's own status line draw it.
 *
 * Every entry was read off that status line under a PTY, where agy 1.4.7 still runs it, with no
 * prompt sent (2026-10-27, `project-scripts/talkcode-agy-147-usage/window.py`). The shim draws the
 * window to one decimal of a thousand, so the Claude and GPT-OSS figures are exact to within that:
 *
 *   Gemini 3.8 Flash (High)        → 1.0M     (1048576 exactly, from the raw snapshot on 1.2.0)
 *   Claude Sonnet / Opus 4.6       → 250.0k
 *   GPT-OSS 120B (Medium)          → 131.1k   (131072, the power of two that rounds there)
 *
 * Matched on either spelling, because agy names a model by id in `init` and by display name on
 * its default. A model in neither row gets no window and therefore no context numbers: a guessed
 * denominator would draw a confident percentage out of nothing, and the next model Google adds is
 * exactly the one nobody has measured.
 */
const CONTEXT_WINDOWS: ReadonlyArray<{ match: RegExp; size: number }> = [
  { match: /^gemini/i, size: 1_048_576 },
  { match: /^claude-(sonnet|opus)-4-6|^claude (sonnet|opus) 4\.6\b/i, size: 250_000 },
  { match: /^gpt-oss[- ]120b/i, size: 131_072 },
];

/** The window for a model, in either spelling; undefined for one nobody has measured. */
export function agyContextWindow(model: string | undefined): number | undefined {
  if (!model) return undefined;
  return CONTEXT_WINDOWS.find((w) => w.match.test(model.trim()))?.size;
}

/**
 * Tokens in context, from one `step_update` frame — an `agent_response` step that has finished,
 * its `input_tokens` plus its `cache_read_tokens` — and undefined for anything else.
 *
 * Captured on agy 1.4.7 (2026-10-27), one tool call then a reply, then a second turn, on Gemini:
 *
 *   step 1 agent_response DONE  usage.input_tokens 7454   (the step that chose the tool)
 *   step 3 agent_response DONE  usage.input_tokens 7672
 *   result                      usage.input_tokens 15126  ← 7454 + 7672
 *   step 5 agent_response DONE  usage.input_tokens 7760
 *   result                      usage.input_tokens 22886  ← all three
 *
 * So each step's figure is the prompt that model call was sent — the context as it stood — and the
 * `result`'s is a running total over the whole conversation, the same way its `status` is (see
 * settleErrorResult in agent-agy.ts). Reading `result` would put a number in the footer that only
 * ever grows, past the window, in a conversation that never came near it.
 *
 * The cached part is NOT in `input_tokens`. The same prompts on Claude Sonnet 4.6, once with no
 * cache hit and once with:
 *
 *   first step   input 8713, cache_read 0       vs   input 4566 + cache_read 4150 = 8716
 *   next turn    input 9004, cache_read 0       vs   input  776 + cache_read 8231 = 9007
 *
 * Read alone, the second turn's context came out as 157 tokens of a 250k window. `total_tokens` is
 * input + output with the cache left out too, so the split looks like agy's own schema rather than
 * Claude's, but on Gemini `cache_read_tokens` was 0 in every frame seen, so that is unconfirmed.
 *
 * Only `agent_response`: a subagent's steps would describe the subagent's own context, not this one.
 */
export function agyStepContextTokens(step: {
  step_type?: string;
  usage?: { input_tokens?: unknown; cache_read_tokens?: unknown };
}): number | undefined {
  if (step.step_type !== 'agent_response') return undefined;
  const input = tokenCount(step.usage?.input_tokens);
  if (input === undefined) return undefined;
  return input + (tokenCount(step.usage?.cache_read_tokens) ?? 0);
}

function tokenCount(n: unknown): number | undefined {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : undefined;
}

/**
 * The model `agy -p=/model` names as the current default: its first row, `<id>\t<display name>`.
 * Verbatim on agy 1.4.7 (2026-10-27): `gemini-3.8-flash-high\tGemini 3.8 Flash (High)`. The id is
 * kept, because `init` and the `/model` menu both spell a model that way.
 */
export function parseAgyCurrentModel(output: string): string | undefined {
  const first = output
    .split('\n')
    .map((l) => l.trim())
    .find(Boolean);
  const id = first?.split('\t')[0]?.trim();
  // A model id is one token; anything with spaces is prose agy printed instead of the table.
  return id && !/\s/.test(id) && id.length <= 120 ? id : undefined;
}

/**
 * `agy -p=/usage`, as the pools the status line used to report. Verbatim on 1.4.7 (2026-10-27):
 *
 *   Gemini Models          Weekly Limit Remaining     74%   2026-10-31T04:24:11Z
 *   Gemini Models          Five Hour Limit Remaining  86%   2026-10-27T06:49:21Z
 *   Claude and GPT models  Weekly Limit Remaining     100%  2026-11-03T06:27:38Z
 *   Claude and GPT models  Five Hour Limit Remaining  100%  2026-10-27T11:27:38Z
 *
 * (tab-separated). The rows are renamed to the ids the status line used — `gemini-weekly`,
 * `3p-5h`, … — because the web UI's labels and markActivePools both key on that shape, and a pool
 * is the same pool whichever channel reported it. Sorted by id, which is also the order the status
 * line sent them in. A row whose family or window is not one of these is dropped and logged, not
 * renamed by guess: an unknown pool shown under a made-up id would be worse than one not shown.
 *
 * Coarser than the status line was — whole percentages, where it sent `0.7486224` — because that is
 * all this command prints.
 */
export function parseAgyUsagePools(output: string): QuotaPool[] | undefined {
  const pools: QuotaPool[] = [];
  for (const line of output.split('\n')) {
    if (!line.trim()) continue;
    const [family = '', metric = '', remaining = '', reset = ''] = line.split('\t').map((c) => c.trim());
    const fam = poolFamily(family);
    const win = poolWindow(metric);
    const pct = Number.parseFloat(remaining);
    if (!fam || !win || !Number.isFinite(pct)) {
      console.debug('[agy] /usage row not understood, left out of the quota:', line.slice(0, 120));
      continue;
    }
    const pool: QuotaPool = { id: `${fam}-${win}`, remaining: Math.min(1, Math.max(0, pct / 100)) };
    const at = Date.parse(reset);
    if (Number.isFinite(at)) pool.resetsAt = at;
    pools.push(pool);
  }
  pools.sort((a, b) => a.id.localeCompare(b.id));
  return pools.length ? pools : undefined;
}

/** `Gemini Models` → gemini, `Claude and GPT models` → 3p: the status line's family names. */
function poolFamily(name: string): string | undefined {
  if (/gemini/i.test(name)) return 'gemini';
  if (/claude|gpt/i.test(name)) return '3p';
  return undefined;
}

/** `Weekly Limit Remaining` → weekly, `Five Hour Limit Remaining` → 5h. */
function poolWindow(metric: string): string | undefined {
  if (/week/i.test(metric)) return 'weekly';
  if (/five hour|\b5 ?h/i.test(metric)) return '5h';
  if (/day/i.test(metric)) return 'daily';
  return undefined;
}
