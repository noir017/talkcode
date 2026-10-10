# Voice messages

English | [简体中文](zh-CN/voice.md)

Send a voice note — or an audio file with no caption, or tap 🎤 in the web UI —
and the gateway transcribes it and shows you what it heard before anything
reaches the agent:

```
🎙️ Voice transcript · gemini-3-flash · 2.7s

帮我看下昨天那个 PR 的 CI 为什么挂了

Send this to the agent? Tap ✅ Send — or type a corrected version instead, and this one is dropped.
[✅ Send] [✖ Cancel]
```

✅ Send hands the words on exactly as if you had typed them — the agent is not
told they were spoken. Typing instead replaces the transcript; `/stop` and
`/new` call it off; an untouched card expires after 30 minutes. Every card keeps
its 🎙️ label after it is settled, so scrolling back always shows which messages
came from your voice and whether they were sent.

```yaml
voice:
  confirm: true                           # false = send each transcript on at once
  transcriber:                            # Gemini's generateContent format
    baseUrl: https://generativelanguage.googleapis.com/v1beta   # or a new-api gateway: http://newapi:3000/v1beta
    apiKey: ${GEMINI_API_KEY}
    model: gemini-3-flash
```

- Once transcripts have earned your trust, `/setting voice off` turns
  confirmation off from chat, live.
- Audio **with** a caption is left alone: "trim this" plus an mp3 is an
  instruction about a file, so the file goes to the agent as before.
- Ogg, WebM, MP4/M4A, MP3, WAV, AAC and FLAC are transcribed. QQ's and WeCom's
  voice codecs (SILK, AMR) are not — you are told so.
- Every transcription is logged to `~/.config/talkcode/voice-log.jsonl`
  with its saved audio file, and the agent can look its conversation's
  transcripts up with `talkcode voice-log` when a message reads like a
  mishearing.
- Platforms that cannot show buttons (QQ, LINE, WeCom, DingTalk) send on
  automatically, and the card says why.
- Leave `voice:` out and a voice note is an ordinary attachment, as before.
