# What the agent can do in the chat

English | [简体中文](zh-CN/agent-actions.md)

## Asking you something

When the agent needs a decision it cannot make for you, it asks — as buttons, in the
chat, and it waits for the tap:

> **Which database should this project use?**
> **PostgreSQL** — you already run pgvector here, so reusing it costs nothing.
> **MySQL** — wider ecosystem, but there is no instance on this box yet.
>
> `[ PostgreSQL ]` `[ MySQL ]`

This is the model's own question tool, not a gateway feature bolted on top: the daemon
advertises ACP's `elicitation.form` capability, which is what unlocks Claude Code's
`AskUserQuestion` (the adapter keeps it disabled otherwise). Nothing is injected into the
prompt to make it work.

**When none of the options fit, just type the answer.** A message sent while a question is on
screen is recorded as the answer to that question instead of starting a new turn — so a form that
asks three things still asks all three, even if you answer the second one in your own words. Either
way the question is edited in place: the buttons come off and what you answered is written onto it.
`/stop` (or `/new`) calls the question off if you would rather not answer it at all.

Harnesses that do not implement elicitation — `opencode` and `dsh`, as of 1.18.27 and
0.1.2-rc.1 — can still put buttons in front of you with the `ask` CLI, which their models find
through the bundled skill. Failing that, the model asks in plain text and ends its turn, and
you answer in the next message.

## Acting in the chat

Plain text streams back automatically. The gateway adds **nothing** to what the agent reads — no
preamble, no reminder about where it is running; it gets your words and your attachments. What
it can do beyond answering reaches it the way any capability does, through its own harness:

- **Two native tools**, `send_file` and `schedule`, on every ACP agent (Claude Code, Codex,
  OpenCode, …): the daemon hands each session a small MCP server, so they sit in the agent's tool
  list like any other.
- **A skill** for the rest — posting to other chats, reading history, replies, edits, threads,
  button questions, voice transcripts. The daemon links the bundled [skill](../skill/SKILL.md) where each harness
  reads skills — `~/.claude/skills` for Claude Code, `~/.agents/skills` for Codex and OpenCode,
  `~/.gemini/config/skills` for Antigravity — once that harness has been run on the machine. Until it is
  needed, it costs the one line of description every skill costs. Its body points at
  `talkcode help <topic>` — `files`, `schedule`, `channels`, `history`, `messages`,
  `threads`, `ask`, `voice` — which prints that topic's commands and rules.

Antigravity (`agy`) gets the skill only: it has no per-session way to add tools, and the gateway
will not edit its global MCP config. The same two commands are in its skill as CLI commands. See
[`src/ipc/README.md`](../src/ipc/README.md) for why exactly two tools, and how the prompt injection
this replaced was retired.

What the `schedule` tool registers is described in [Scheduled tasks](scheduled-tasks.md).
