# Configuration

English | [简体中文](zh-CN/configuration.md)

`~/.config/talkcode/config.yaml`, or `--config <path>`. `talkcode setup` writes a working one;
this page covers what the wizard does not ask about — several agents, routing, more than one
account per platform.

```yaml
version: 1

platforms:                    # named instances; the key is the instance id
  discord-main:
    type: discord             # discord|telegram|slack|lark|qq|line|wecom|dingtalk|webui
    token: ${DISCORD_TOKEN}   # every string supports ${VAR}
    chat:
      requireMention: true    # group channels need an @mention
  telegram-bot:               # same type twice = multi-account
    type: telegram
    token: ${TELEGRAM_TOKEN}

agents:                       # at least one; routing picks by id
  - id: claude
    harness: claude           # claude|codex|opencode|agy|custom
    cwd: ~/projects/main
  - id: codex
    harness: codex

routing:
  default: claude
  pipeline:                   # ordered; first match wins
    - when: { platform: telegram-bot }
      use: { agent: codex }
    - when: { command: codex } # "/codex fix the tests" → codex agent
      use: { agent: codex }

session:
  scope: per_thread           # per_thread|per_channel|per_user|shared
  idleTimeoutMs: 3600000      # stop an idle conversation's agent process after 1h; 0 = never

access:
  allowFrom: ["discord-main:123456"]   # <instanceId>:userId; empty = anyone
```

`${VAR}` expands from the environment plus a `<configDir>/.env` sidecar, so
the YAML can be committed.

> [!WARNING]
> Agents run with full tool access. An empty `access.allowFrom` lets anyone
> who can message the bot run commands on your machine — fill it in any
> shared deployment.

The rest is described where it is used: each harness's options in [Agents](agents.md), the web
UI's `terminal:` and `sso:` in [Web UI](web-ui.md), `title:` in [Topic names](topic-names.md),
and `voice:` in [Voice messages](voice.md). A handful of fields can also be changed from chat,
without a restart — see [Settings from chat](settings.md).

## CLI

| Command | |
|---|---|
| `setup` | configuration wizard |
| `doctor` | self-check (default); `--migrate-config` upgrades v0 files |
| `start` | run the daemon |
| `<reverse-command>` | chat actions for the agent — see [Acting in the chat](agent-actions.md#acting-in-the-chat) |

All commands accept `-c, --config <path>` and print structured output to
stdout.
