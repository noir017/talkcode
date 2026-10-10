# 配置

[English](../configuration.md) | 简体中文

`~/.config/talkcode/config.yaml`，或用 `--config <path>` 指定。`talkcode setup` 会写出一份能用的；
本页讲向导不问的那些——多个智能体、路由、同一平台多个账号。

```yaml
version: 1

platforms:                    # 命名实例；键即实例 id
  discord-main:
    type: discord             # discord|telegram|slack|lark|qq|line|wecom|dingtalk|webui
    token: ${DISCORD_TOKEN}   # 所有字符串支持 ${VAR}
    chat:
      requireMention: true    # 群聊需 @ 机器人
  telegram-bot:               # 同类型出现两次 = 多账号
    type: telegram
    token: ${TELEGRAM_TOKEN}

agents:                       # 至少一个；路由按 id 选取
  - id: claude
    harness: claude           # claude|codex|opencode|agy|custom
    cwd: ~/projects/main
  - id: codex
    harness: codex

routing:
  default: claude
  pipeline:                   # 有序；首个匹配生效
    - when: { platform: telegram-bot }
      use: { agent: codex }
    - when: { command: codex } # "/codex fix the tests" → codex 智能体
      use: { agent: codex }

session:
  scope: per_thread           # per_thread|per_channel|per_user|shared
  idleTimeoutMs: 3600000      # 闲置 1 小时后停掉该会话的智能体进程；0 = 从不

access:
  allowFrom: ["discord-main:123456"]   # <实例id>:userId；留空 = 任何人
```

`${VAR}` 从环境变量及 `<配置目录>/.env` 展开，YAML 本身可以提交进仓库。

> [!WARNING]
> 智能体拥有完整工具权限。`access.allowFrom` 留空意味着任何能给机器人发消息的人
> 都能在你的机器上执行命令——共享部署务必填写白名单。

其余配置在用到它的地方讲：各 harness 的选项见[智能体](agents.md)，网页端的 `terminal:`、`sso:`
见[网页端](web-ui.md)，`title:` 见[话题命名](topic-names.md)，`voice:` 见[语音消息](voice.md)。
其中几项也能在聊天里直接改、不用重启——见[在聊天里改配置](settings.md)。

## CLI

| 命令 | |
|---|---|
| `setup` | 交互式配置向导 |
| `doctor` | 自检（默认命令）；`--migrate-config` 升级 v0 配置文件 |
| `start` | 运行守护进程 |
| `<反向命令>` | 供智能体使用的聊天操作，见[在聊天中行动](agent-actions.md#在聊天中行动) |

所有命令均接受 `-c, --config <path>`，并将结构化输出写到 stdout。
