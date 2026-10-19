# 智能体

[English](../agents.md) | 简体中文

| Harness | 启动方式 | 额外安装 | 认证 |
|---|---|---|---|
| `claude` | 内置 [claude-agent-acp](https://www.npmjs.com/package/@agentclientprotocol/claude-agent-acp) | 无 | `claude /login` 或 `ANTHROPIC_API_KEY` |
| `codex` | `codex-acp` | [@agentclientprotocol/codex-acp](https://www.npmjs.com/package/@agentclientprotocol/codex-acp)（`npm i -g`） | Codex CLI 登录态 |
| `opencode` | `opencode acp` | OpenCode CLI | OpenCode 登录态 |
| `agy` | `agy --input-format stream-json` | Antigravity CLI | `agy` 的 Google 登录态（系统钥匙串） |
| `custom` | 你的 `command` + `args` | 任意 ACP 可执行文件 | 由智能体自身决定 |

每个智能体可设 `cwd`、`env`、`args` 及尽力传递的 `model`。支持会话恢复
的智能体，上下文可跨重启保留；智能体自己声明的斜杠命令不会全局注册，而是通过
它的 `/<agent>` 菜单调出（见[聊天命令](chat-commands.md#智能体命令)）。
`doctor` 会逐一校验已配置的 harness。

## Antigravity（`agy`）

`agy` 是唯一不说 ACP 的预设——它根本没有 ACP 模式——因此改用它自带的
[headless stream-json 协议](https://antigravity.google/docs/cli/headless/)驱动。
流式输出、工具气泡、多轮上下文、重启续接、skills、`/model`、`/context`、`/usage`
都与 ACP 预设一致；不同的是后三者从哪里取——agy 把它们各自发布在会话之外：

- **它自带的斜杠命令改由独立进程应答。** 在 stream-json 模式下，由 CLI 自己应答的
  斜杠（`/model`、`/usage`、`/credits` 等）会直接中止整个会话，因此守护进程用一次性
  的 `agy -p=/<name>` 回答这十一个命令，绝不转发进会话。其余输入——首先是你的
  **skills**——照常进入会话并正常展开。
- **上下文占用来自 agy 的状态栏。** agy 的协议不上报 token 数，但它会把上下文快照
  交给 `~/.gemini/antigravity-cli/settings.json` 里配置的 `statusLine` 命令。守护进程
  启动时会先备份该文件一次，再把这项指向自己的 shim：既通过一条管道把数字——以及
  其他途径都拿不到的 agy 默认模型名——直接交回守护进程供页脚使用，也照样为你的终端
  画出状态栏。设 `TALKCODE_NO_AGY_STATUSLINE=1` 可以不动这项
  配置（代价是没有这些数字）。
- **skills** 从 `<cwd>/.agents/skills`、`~/.agents/skills`、
  `~/.gemini/antigravity-cli/skills`、`~/.gemini/skills`、`~/.gemini/config/skills`
  读取，所以 `/skills` 能列出它们，`/<名字> <请求>` 能直接调用。
- **`/new` 开启新对话**，与其他 harness 一致。停下当轮（`/stop`）会重启子进程并续接同一
  对话，因此上下文不会丢失。
- **一轮中途发的消息要等这一轮结束**：agy 的 stream-json 输入把每条消息当成单独的一轮，
  没有办法并入正在跑的那一轮。
- **你发的图片只以路径交给它。** stream-json 输入只收文字，所以走 ACP 的 harness 能直接看到图片，
  agy 拿到的是图片存放的位置。

守护进程的所有默认参数都可通过 `args` 覆盖（它们追加在默认值之后，而 agy 的
参数解析是后者生效）。

> [!NOTE]
> Google 的 FAQ 声明：用第三方工具访问 Antigravity 违反其服务条款，可能导致
> 账号封禁。本 harness 只调用 agy 官方自带的 headless 接口，且完全不接触你的
> 凭据（登录全程在 `agy` 内部完成），但守护进程终究是一个非 Google 客户端在
> 驱动你的账号——请自行判断。
