# Chat commands

English | [简体中文](zh-CN/chat-commands.md)

Registered as native slash commands where the platform supports them (Telegram,
Discord, Slack), and equally usable as plain text everywhere else.

| | |
|---|---|
| `/help` | everything below, for the agent currently answering |
| `/new`, `/clear` | start a fresh conversation (clears context) |
| `/stop` | stop the current turn — or background work reporting in after one — keeping the conversation |
| `/kill` | end the agent process, keeping the conversation — the next message resumes it |
| `/cd` | choose the directory this conversation works in — see [Working directory](working-directory.md) |
| `/title` | name this topic; it is named automatically otherwise — see [Topic names](topic-names.md) |
| `/setting` | change a saved setting in config.yaml — see [Settings from chat](settings.md) |
| `/cc`, `/oc`, `/cx`, `/gm`, `/agy` | one per configured harness — see [below](#agent-commands) |
| `/compact`, `/context`, `/model`, `/effort`, `/usage`, `/doctor`, `/mcp`, `/init`, `/review` | a generic vocabulary, translated to each harness's own spelling — see [below](#generic-commands) |

`/usage` and `/context` sent while the agent is in the middle of a turn are answered by the
gateway itself — context, cost so far, how long the turn has run — instead of being passed to the
agent, which would interrupt the turn. Send them again once it finishes for the agent's own, fuller
answer.

## Agent commands

An **agent command** is named after its harness — `/cc` claude, `/oc` opencode,
`/cx` codex, `/gm` gemini, `/agy` Antigravity. Only the harnesses you configure
are registered. It does two things:

```
/oc fix the failing test    →  answer this conversation with opencode, and ask it
/oc                         →  choose opencode, then ask WHERE (a new conversation),
                               or list opencode's own commands (an ongoing one)
```

The binding is **sticky**: everything after `/oc` keeps going to opencode. And
once that agent has a session in the topic, **the topic keeps it** — naming a
different agent there is refused, with the session id and working directory of
the one that is answering. To carry the work on with another agent, open a new
topic, start it with that agent's command, and hand it the id: it can read the
earlier conversation itself. `/new` clears a topic, after which any agent can
take it. The full harness name (`/opencode`) still works if you type it — it is
just not registered, so it costs no slot in the platform menu.

A name whose harness you have **not** configured (`/agy` with no `harness: agy`
agent) is answered with exactly that, and runs no turn — otherwise it reaches
whichever agent is bound still spelled `/agy …`, which reads it as one of its own
slash commands, finds nothing, and replies that a command ran and produced no
output.

The bare form is also how you reach a harness's *own* commands
(`/customize-opencode`, and friends) — once the conversation is under way. They
are deliberately not registered globally: native slash is per-bot while agents
are per-conversation, so a merged menu could neither say who owned an entry nor
route it to them. A harness that reports no command list (`agy`) simply confirms
the switch.

## Generic commands

Generic commands are rewritten to the target harness's native spelling
(`/compact` → gemini's `/compress`), and a harness with no equivalent says so
instead of spending a turn on a prompt it will misread.

Some of them the gateway answers itself where the harness has no command for it,
because the capability is there over the protocol rather than as a slash:
`/context` prints the last usage the agent reported, `/model` shows and switches
the model, and `/effort` shows and switches the reasoning effort.

### `/model`

`/model` alone opens a **paginated button menu** of the models the agent offers,
starting on the page holding the current one; ◀ ▶ turn the page on the same
message, and tapping a model switches it for that conversation. On Discord,
Telegram, Slack and Lark, which is where a message's buttons can be replaced —
elsewhere it prints the same summary line as before. `/model <part of a name>`
switches by substring on every platform, listing the candidates when the query is
ambiguous rather than guessing. Both work on `opencode` and `claude`; neither
advertises a `/model` command, and both expose the selector over ACP.

### `/effort`

`/effort` works the same way on `claude`, `codex` and `opencode`: alone it opens a
menu of the levels with the current one marked (a line of text where buttons
cannot be edited), and `/effort high` — or any unique start of a level, `/effort x`
for `xhigh` — switches it for the conversation from the next message on. The
levels come from the model, not the harness, so they change with `/model`, and a
model can have none: opencode offers them only for models with reasoning variants,
and codex only for models in the installed codex-cli's own catalog (on 0.155.1,
`gpt-6-luna` is not one; 0.156.1 knows it). The reply says which case you are in.
The choice survives the agent being stopped for idleness — the gateway re-applies
it, since claude and codex come back at their default level — and ends with `/new`
or a daemon restart.
`agy` has no such setting; its thinking variants are separate models, under `/model`.
