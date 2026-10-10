import { describe, expect, it } from 'vitest';
import { ConversationRegistry } from './conversation.js';
import { withOutboundPacing } from './paced-adapter.js';
import { OutboundPacer } from '../core/outbound-pacer.js';
import { parseConfig, type Config } from '../config/schema.js';
import type { PlatformAdapter, PlatformCapabilities, SendOptions } from '../platform/adapter.js';
import type { AgentFactory, AgentSession, AgentStreamHandlers } from './agent.js';
import type { InboundMessage } from '../types.js';

/**
 * What a platform is told about a tool bubble, through the real wiring: ConversationRegistry →
 * TurnRunner → ToolRenderer → the paced adapter → a fake platform.
 *
 * Two things the web UI's foldable tool lines depend on, neither of which any one unit can see:
 * that the `{ kind: 'tools' }` mark given at the send survives the pacer (which re-invokes every
 * adapter method from a closure, and would silently drop a parameter it did not forward), and
 * that a platform's `toolPreviewLimit` is what the renderer actually cuts at.
 */

const LONG = `cd /home/user/workspace/project-scripts/dividend-backtest && python3 run.py ${'--flag '.repeat(40)}--end`;

function inbound(content: string): InboundMessage {
  return {
    conversation: { platform: 'p', channel: 'c1', kind: 'direct', user: 'u1' },
    messageId: 'm1',
    content,
    timestamp: 0,
  };
}

const tick = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function rig(caps: Partial<PlatformCapabilities> = {}, previewLimit?: number) {
  const parsed = parseConfig({
    platforms: { p: { type: 'telegram', token: 't' } },
    agents: [{ id: 'cc', harness: 'claude' }],
    routing: { default: 'cc', pipeline: [] },
    display: { header: { enabled: false }, footer: { enabled: false } },
  });
  const cfg: Config = {
    ...parsed,
    inbound: { ...parsed.inbound, mergeWindowMs: 1, maxMergeWindowMs: 1 },
    outbound: { ...parsed.outbound, ratePerSec: 1000 },
    tools: { ...parsed.tools, ...(previewLimit !== undefined ? { previewLimit } : {}) },
  };
  const clock = {
    now: () => Date.now(),
    schedule: (fn: () => void, ms: number) => {
      const timer = setTimeout(fn, ms);
      return () => clearTimeout(timer);
    },
  };

  /** Every send, with what it was told about itself; and the latest text of every message. */
  const sends: Array<{ id: string; text: string; opts: SendOptions | undefined }> = [];
  const latest = new Map<string, string>();
  let seq = 0;
  const platform = {
    platform: 'p',
    platformType: 'telegram',
    capabilities: { thread: false, editMessage: true, maxMessageLength: 20_000, ...caps },
    measureRendered: (s: string) => s.length,
    sendMessage: async (address: { channel: string }, text: string, opts?: SendOptions) => {
      const id = `m${++seq}`;
      sends.push({ id, text, opts });
      latest.set(id, text);
      return { address, messageId: id };
    },
    editMessage: async (ref: { messageId: string }, text: string) => {
      latest.set(ref.messageId, text);
    },
    addReaction: async () => {},
    removeReaction: async () => {},
    startTyping: async () => {},
    stopTyping: async () => {},
  } as unknown as PlatformAdapter;

  const factory: AgentFactory = {
    getOrCreate(conversationId): AgentSession {
      return {
        conversationId,
        runTurn: async (_input, h: AgentStreamHandlers) => {
          h.onText('Running it.');
          h.onToolStart({ name: 'Bash', inputPreview: LONG, index: 0 });
          h.onToolFinish({ name: 'Bash', ok: true, durationMs: 20, index: 0 });
          h.onSegmentBreak();
          h.onText('done');
        },
        abort: () => {},
        setFollowUpSink: () => {},
        dispose: () => {},
      };
    },
    peek: () => undefined,
    dispose: () => {},
  };

  const paced = withOutboundPacing(platform, new OutboundPacer(cfg.outbound, clock));
  const reg = new ConversationRegistry(cfg, new Map([['p', paced]]), factory, clock);
  return {
    sends,
    /** The tool bubble's final text, once the turn's reply and the bubble's ✓ have both landed. */
    async bubble(): Promise<string> {
      reg.route(inbound('go'));
      for (let i = 0; i < 300; i++) {
        const tool = sends.find((s) => s.text.includes('Bash:'));
        const text = tool ? latest.get(tool.id) ?? '' : '';
        if (sends.some((s) => s.text === 'done') && text.includes('✓')) return text;
        await tick(10);
      }
      throw new Error(`the turn never finished: ${JSON.stringify(sends)}`);
    },
  };
}

describe('a tool bubble tells the platform what it is', () => {
  it('marks the bubble as tools on its send, and nothing else', async () => {
    const h = rig();
    await h.bubble();
    // Marked through the pacer — the parameter is forwarded, not re-declared.
    expect(h.sends.filter((s) => s.opts?.kind === 'tools').map((s) => s.text.slice(0, 7))).toEqual(['💻 Bash']);
    // The reply's own messages are prose and say nothing about themselves.
    expect(h.sends.filter((s) => !s.text.includes('Bash:')).every((s) => s.opts === undefined)).toBe(true);
  });
});

describe('how much of a command a bubble line carries', () => {
  it('is the operator setting on a platform that declares nothing', async () => {
    const line = await rig().bubble();
    // The 40-character default: cut, and marked as cut.
    expect(line).toContain('…');
    expect(line).not.toContain('--end');
  });

  it('is the platform limit where it declares a larger one', async () => {
    const line = await rig({ toolPreviewLimit: 2_000 }).bubble();
    expect(line).toBe(`💻 Bash: "${LONG.replace(/\s+/g, ' ')}" ✓ 20ms`);
  });

  it('is never less than the operator set', async () => {
    // A platform limit is a floor it asks for, not a cap it imposes: an operator who already
    // raised previewLimit past it keeps what they chose.
    const line = await rig({ toolPreviewLimit: 20 }, 2_000).bubble();
    expect(line).toContain('--end');
  });
});
