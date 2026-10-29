import { describe, expect, it } from 'vitest';
import type { AgentDef } from '../config/schema.js';
import {
  agentGroups,
  agentListText,
  buildAgentMenu,
  flatAgents,
  LOCAL_GROUP,
  matchAgent,
  parseAgentButtonId,
} from './agent-menu.js';

const agent = (id: string, extra: Partial<AgentDef> = {}): AgentDef =>
  ({ id, harness: 'claude', args: [], env: {}, permissions: 'auto', ...extra }) as AgentDef;

const agents = [
  agent('cc'),
  agent('cc-ua', { host: 'uniagent' }),
  agent('oc-ua', { host: 'uniagent', harness: 'opencode' }),
  agent('cx-box', { host: 'box', group: 'build' }),
];

describe('agentGroups', () => {
  it('groups by group, else host, else this machine, in config order', () => {
    expect(agentGroups(agents).map((g) => [g.name, g.agents.map((a) => a.id)])).toEqual([
      [LOCAL_GROUP, ['cc']],
      ['uniagent', ['cc-ua', 'oc-ua']],
      ['build', ['cx-box']],
    ]);
  });
});

describe('buildAgentMenu', () => {
  const groups = agentGroups(agents);

  it('asks for the machine first when there is more than one, marking the current one', () => {
    const view = buildAgentMenu({ reqId: 'r1', groups, current: 'oc-ua', pageSize: 6 });
    expect(view.buttons.map((b) => b.label)).toEqual([`${LOCAL_GROUP} (1)`, '● uniagent (2)', 'build (1)']);
    expect(view.buttons.map((b) => parseAgentButtonId(b.id))).toEqual([
      { kind: 'group', reqId: 'r1', group: 0 },
      { kind: 'group', reqId: 'r1', group: 1 },
      { kind: 'group', reqId: 'r1', group: 2 },
    ]);
  });

  it("lists a group's agents with indexes into the flat list, and a way back", () => {
    const view = buildAgentMenu({ reqId: 'r1', groups, current: 'oc-ua', group: 1, pageSize: 6 });
    expect(view.text).toContain('on uniagent');
    expect(view.buttons.map((b) => b.label)).toEqual(['cc-ua · claude', '● oc-ua · opencode', '‹ machines']);
    const picks = view.buttons.map((b) => parseAgentButtonId(b.id));
    expect(picks[0]).toEqual({ kind: 'pick', reqId: 'r1', index: 1 });
    expect(flatAgents(groups)[1]!.id).toBe('cc-ua');
    expect(picks[2]).toEqual({ kind: 'back', reqId: 'r1' });
  });

  it('skips the machine question when there is only one group', () => {
    const one = agentGroups([agent('a'), agent('b')]);
    const view = buildAgentMenu({ reqId: 'r', groups: one, current: undefined, pageSize: 6 });
    expect(view.buttons.map((b) => b.label)).toEqual(['a · claude', 'b · claude']);
  });

  it('pages a long group', () => {
    const many = agentGroups(Array.from({ length: 8 }, (_, i) => agent(`a${i}`)));
    const view = buildAgentMenu({ reqId: 'r', groups: many, current: undefined, page: 1, pageSize: 6 });
    expect(view.buttons.map((b) => b.label)).toEqual(['a6 · claude', 'a7 · claude', '‹', '›']);
    expect(parseAgentButtonId(view.buttons[2]!.id)).toEqual({ kind: 'page', reqId: 'r', group: 0, page: 0 });
    expect(parseAgentButtonId(view.buttons[0]!.id)).toEqual({ kind: 'pick', reqId: 'r', index: 6 });
  });
});

describe('matchAgent and agentListText', () => {
  it('matches an exact id first, then a unique substring', () => {
    expect(matchAgent(agents, 'CC')).toMatchObject({ kind: 'one', def: { id: 'cc' } });
    expect(matchAgent(agents, 'box')).toMatchObject({ kind: 'one', def: { id: 'cx-box' } });
    expect(matchAgent(agents, 'ua')).toEqual({ kind: 'many', ids: ['cc-ua', 'oc-ua'] });
    expect(matchAgent(agents, 'zz')).toEqual({ kind: 'none' });
  });

  it('lists every agent under its group', () => {
    const text = agentListText(agentGroups(agents), 'cc-ua');
    expect(text).toContain('uniagent:\n  ● cc-ua — claude\n    oc-ua — opencode');
  });
});
