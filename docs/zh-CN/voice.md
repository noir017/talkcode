# 语音消息

[English](../voice.md) | 简体中文

发一条语音（或者不带说明文字的音频文件，或在网页端点 🎤 录音），网关会先把它转成文字，
在交给智能体之前给你看识别结果：

```
🎙️ Voice transcript · gemini-3-flash · 2.7s

帮我看下昨天那个 PR 的 CI 为什么挂了

Send this to the agent? Tap ✅ Send — or type a corrected version instead, and this one is dropped.
[✅ Send] [✖ Cancel]
```

点 ✅ Send 后，这段文字就像你亲手打的一样交给智能体——智能体不会被告知这是语音。
直接打字会替换掉这条识别结果；`/stop`、`/new` 会撤销它；30 分钟没人点就过期。
卡片处理完后 🎙️ 标记一直保留，往回翻就能看出哪些消息来自语音、有没有发出去。

```yaml
voice:
  confirm: true                           # false = 识别完直接发给智能体
  transcriber:                            # Gemini 的 generateContent 格式
    baseUrl: https://generativelanguage.googleapis.com/v1beta   # 或 new-api 网关：http://newapi:3000/v1beta
    apiKey: ${GEMINI_API_KEY}
    model: gemini-3-flash
```

- 识别质量信得过以后，在聊天里 `/setting voice off` 即可关掉确认，立即生效。
- **带**说明文字的音频不转写：「帮我剪一下」加一个 mp3 是针对文件的指令，文件照旧交给智能体。
- 支持 Ogg、WebM、MP4/M4A、MP3、WAV、AAC、FLAC。QQ 和企业微信的语音编码（SILK、AMR）不支持，会明确告诉你。
- 每次转写都记录在 `~/.config/talkcode/voice-log.jsonl`，附带保存的音频文件；
  智能体觉得某句话像是听错了时，可以用 `talkcode voice-log` 查本会话的转写记录。
- 不能显示按钮的平台（QQ、LINE、企业微信、钉钉）会自动发送，卡片上会写明原因。
- 不配 `voice:` 时，语音就是普通附件，和以前一样。
