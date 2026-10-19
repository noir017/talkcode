# Agents

English | [简体中文](zh-CN/agents.md)

| Harness | Launches | Extra install | Auth |
|---|---|---|---|
| `claude` | bundled [claude-agent-acp](https://www.npmjs.com/package/@agentclientprotocol/claude-agent-acp) | none | `claude /login` or `ANTHROPIC_API_KEY` |
| `codex` | `codex-acp` | [@agentclientprotocol/codex-acp](https://www.npmjs.com/package/@agentclientprotocol/codex-acp) (`npm i -g`) | Codex CLI's login |
| `opencode` | `opencode acp` | OpenCode CLI | OpenCode's login |
| `agy` | `agy --input-format stream-json` | Antigravity CLI | `agy` Google sign-in (OS keyring) |
| `custom` | your `command` + `args` | any ACP executable | your agent's |

Each agent takes `cwd`, `env`, `args`, and a best-effort `model`. Sessions
persist where the agent supports it; the commands an agent advertises are
reachable through its own `/<agent>` menu rather than registered globally (see
[Chat commands](chat-commands.md#agent-commands)). `doctor` verifies every configured harness.

## Antigravity (`agy`)

`agy` is the only preset that does not speak ACP — it has no ACP mode — so it is
driven over its own documented
[headless stream-json protocol](https://antigravity.google/docs/cli/headless/)
instead. Streaming, tool bubbles, multi-turn context, post-restart resume, skills,
`/model`, `/context` and `/usage` all work as they do on the ACP harnesses. What
differs is how the last three are obtained, because agy publishes each somewhere
other than its session:

- **Its own slash commands run as separate processes.** In stream-json mode a
  CLI-answered slash (`/model`, `/usage`, `/credits`, …) aborts the whole session,
  so the daemon answers those eleven names with a one-shot `agy -p=/<name>` and
  never forwards them. Everything else — above all your **skills** — reaches the
  session and expands normally.
- **Context usage comes from agy's status line.** agy reports no token counts over
  its protocol, but it does hand a context snapshot to the `statusLine` command in
  `~/.gemini/antigravity-cli/settings.json`. On startup the daemon backs that file
  up once and points the setting at its own shim, which passes the numbers — and
  the name of agy's default model, which nothing else reports — straight back to
  the daemon over a pipe for the footer, and still draws a status line for your
  terminal. Set
  `TALKCODE_NO_AGY_STATUSLINE=1` to leave the setting alone and go without
  the numbers.
- **Skills** are read from `<cwd>/.agents/skills`, `~/.agents/skills`,
  `~/.gemini/antigravity-cli/skills`, `~/.gemini/skills` and
  `~/.gemini/config/skills`, so `/skills` lists them and `/<name> <request>` runs one.
- **`/new` starts a new conversation**, as with every harness. Stopping a
  turn (`/stop`) restarts the child and resumes the same conversation, so context survives.
- **A message sent mid-turn waits for the turn to end**: agy's stream-json input runs
  each message as a turn of its own, with no way to join one already running.
- **A picture you send reaches it as a path.** The stream-json input carries text only, so
  where the ACP harnesses are shown the picture itself, agy is told where it was saved.

Any of the daemon's default flags can be overridden through `args` (they are
appended after the defaults, and agy's flag parsing is last-wins).

> [!NOTE]
> Google's FAQ states that accessing Antigravity with third-party tools violates
> its Terms of Service and may lead to account suspension. This harness only
> calls agy's own official headless interface and never handles your credentials
> (sign-in stays entirely inside `agy`), but the daemon is still a non-Google
> client driving your account — decide accordingly.
