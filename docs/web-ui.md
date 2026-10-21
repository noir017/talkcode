# Web UI

English | [简体中文](zh-CN/web-ui.md)

![The web UI: a topic sidebar, Claude Code's tool calls and its answer, and the status footer](images/webui.png)

A plain dark chat page the daemon serves itself. No bot to register, no account,
no upstream service — it is the fastest way to have a working gateway, and the
only one that works with no chat platform at all.

```yaml
platforms:
  web:
    type: webui
    token: ${WEB_TOKEN}       # required: the shared secret the login page asks for
    host: 0.0.0.0             # default; 127.0.0.1 to keep it to an SSH tunnel
    port: 8787                # default
    title: Chat               # default; the browser tab's title

access:
  allowFrom: ["web:owner"]    # the identity is always <instance id>:owner
```

Open `http://<host>:8787`, enter the token, and you have the same conversation
every other platform gets: streaming replies, tool bubbles, the `/model`, `/effort`,
`/cd` and `/setting` button menus, `ask` questions, file upload and download.

**Topics.** The sidebar on the left lists parallel conversations and switches between them,
the same way a Telegram forum topic or a Feishu 话题 does: each has its own agent
session and its own context, and each gets named automatically from what it turned
out to be about. `+` opens one; the agent can open one itself with
`talkcode create-thread`, and write into one with `--channel main/<topic id>`. On a narrow
screen the sidebar becomes a drawer.

**Stopping it.** While a reply is streaming, **Stop** beside Send ends the turn
(`/stop`) — and the same goes for an agent reporting back on background work after
its turn ended, which the topic shows as running too. While an agent process is up
behind the topic, the power button beside its title ends the process (`/kill`) — the
conversation is kept, and the next message picks up where it left off. Both simply
send the command, so a draft in the composer is left where it is.

**Tool calls, in full.** Each tool the agent runs is one row in its tool bubble, and here
a row carries the whole command — up to 2000 characters — where a chat app gets the
first 40 (`tools.previewLimit`). The row is cut at the edge of the bubble, so a wide
screen shows as much as fits, and the ✓ and duration at its end always stay visible.
Click a row to read it in full, and again to fold it; **Show all** under the bubble
opens every row, including the ones the agent adds after you press it.

**Pictures.** Paste a screenshot (Ctrl-V) or attach one and it shows as a thumbnail in the
composer, with an × to take it back off the message. Once sent, your message shows it too, and a
tap fills the screen with it. The daemon keeps that copy only while it is running: after a
restart, a message from before it keeps the picture's name but not the picture.

**Built for a bad connection.** Replies are sent when they settle rather than on
every keystroke of the stream, everything on the wire is compressed, and a dropped
connection resumes from where it left off instead of re-downloading the
conversation. In a 30-second streamed answer that is 13 updates collapsed to 3, at
about a quarter of the bytes. Sends carry a nonce, so the page retries safely on a
link that drops them. A send that gets no answer at all does not stay grey: after 15
seconds (longer for a big attachment, up to 5 minutes) it turns red with **Retry**,
**Copy** and **Discard**. A message that is still grey after that has not left the
browser.

## Terminal

Turned on, the chat header grows a `>_` button that
opens a real shell on the machine the daemon runs on — so you can drive *any*
coding-agent CLI, TUI and all, from the same page. It is a window per topic, and
its two buttons mean different things: minimize hides it while everything keeps
running and stays attached, close ends the session for good. The topic list marks
which topics have a terminal open. The daemon does not implement a terminal: it
proxies, behind the same login, to a
[`ttyd`](https://github.com/tsl0922/ttyd) you run on a unix socket. Off unless you
ask for it.

```yaml
platforms:
  web:
    type: webui
    token: ${WEB_TOKEN}
    terminal:
      enabled: true
      socket: ~/.config/talkcode/webui-term-web.sock   # where your ttyd listens
      # Optional: how to END a session. Without it the window has no close button,
      # only minimize — because what holds a session open on the far side is your
      # arrangement, not this daemon's. argv, never a shell string.
      endCommand: ["tmux", "-L", "aa-web", "kill-session", "-t", "aa-{topic}"]
```

```bash
# The other half, which is not this package's job to run. The wrapper should put the
# session in tmux — otherwise closing the tab kills whatever was running in it.
printf '#!/bin/sh\nexec tmux -L aa-web new -A -s "aa-$1"\n' > /usr/local/bin/aa-terminal.sh
chmod +x /usr/local/bin/aa-terminal.sh
ttyd -i ~/.config/talkcode/webui-term-web.sock -b /term -W -a -O \
     -T xterm-256color /usr/local/bin/aa-terminal.sh
```

## Exposing it

> [!WARNING]
> The default binds every interface and speaks plain HTTP, so the token is the
> only thing between your network and an agent with full tool access. Put a
> reverse proxy with TLS in front of it before exposing it beyond a network you
> control, or set `host: 127.0.0.1` and reach it over an SSH tunnel.
> If you do proxy it, turn response buffering **off** (`proxy_buffering off;` in
> nginx) — buffered server-sent events show nothing until the turn ends, and pass
> `Upgrade`/`Connection` through if you enable the terminal.
> Enabling the terminal moves that token from guarding *a conversation with an
> agent* to guarding *a shell*. Same ceiling, much shorter path.

## Single sign-on

When a token is not enough. One shared secret has no name on
it, never expires, and cannot be revoked for one person. If the page already sits
behind an identity-aware proxy — Cloudflare Access, Teleport's Application
Service — that proxy has authenticated a *person*, with SSO and MFA, and says so
in a JWT it signed. Point `sso:` at the proxy's public keys and the daemon checks
that signature instead of asking for a password a second time.

```yaml
platforms:
  web:
    type: webui
    token: ${WEB_TOKEN}
    sso:
      # Cloudflare Access. For Teleport: header Teleport-Jwt-Assertion,
      # jwksUrl https://<proxy>/.well-known/jwks.json, claim username.
      header: Cf-Access-Jwt-Assertion          # default
      cookie: CF_Authorization                 # the WebSocket handshake's copy
      jwksUrl: https://<team>.cloudflareaccess.com/cdn-cgi/access/certs
      issuer: https://<team>.cloudflareaccess.com
      audience: <the application's AUD tag>    # NOT optional: it is what stops a
                                               # token for another app of the same
                                               # provider from opening this one
      claim: email                             # default
      allow: ["you@example.com"]
      from: ["172.24.0.0/16"]                  # the proxy, and nothing else
      password: false                          # once sso works, close the old door
```

`from` is required, and is the reason a forged header is not interesting even if
something above it is misconfigured: the signature makes forgery useless, and
`from` makes a mistake in the four fields above it survivable. A refusal logs the
address it came from, which is how you find what to put there. `talkcode
doctor` fetches the JWKS and reports how many keys it found — do that before
setting `password: false`, because with the password door shut a provider outage
means nobody opens the page at all.

## What to expect

Everyone who knows the token shares the same topics. And a daemon restart does not replay
what was said: the daemon keeps the transcript in memory, while the agent's session is on
disk. The browser keeps a copy of its own, so a topic you have opened before still shows its
messages after a restart — above a divider saying where they came from — and the agent
carries on below them with its context intact.
