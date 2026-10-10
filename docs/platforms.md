# Platforms

English | [简体中文](zh-CN/platforms.md)

| | Discord | Telegram | Slack | Lark | QQ | LINE | WeCom | DingTalk | Web UI |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Streaming in-place edit | ✓ | ✓ | ✓ | ✓ | – | – | – | – | ✓ |
| Lifecycle reactions | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | – | ✓ |
| Typing indicator | ✓ | ✓ | – | – | – | ✓ | – | – | ✓ |
| Native reply | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | ✓ |
| Threads / auto-thread | ✓ | ✓ | ✓ | ✓ | – | – | – | – | ✓ |
| Buttons (`ask`) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | ✓ |
| Slash commands | ✓ | ✓ | ✓ | – | – | – | – | – | ✓ |

Markdown is rendered per platform; missing capabilities degrade gracefully (no
editing → chunked sends, no buttons → plain-text question). Slack, Lark, and
DingTalk connect over WebSocket by default — no public callback URL needed.

Every platform is an entry under `platforms:` in config.yaml, and the same type may appear
more than once for several accounts — see [Configuration](configuration.md). The web UI is
not a chat service but a page the daemon serves itself; it has [its own page](web-ui.md).
