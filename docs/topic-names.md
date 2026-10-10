# Topic names (`/title`)

English | [简体中文](zh-CN/topic-names.md)

A Telegram forum topic keeps whatever name it was created with for as long as it
exists, so a topic-per-task workflow becomes a column of names typed *before* any
of the work happened. So the gateway names it: the opening message is summarised
into a name, **once**.

The summary is asked for the moment the turn starts, not when it ends, and the
topic is renamed as soon as the answer comes back — a second or two in, while the
agent is still working. Waiting for the turn would mean waiting out the work
itself, and the topic column is least useful when it is stale about the thing
happening right now.

```
/title                  →  what this topic was last named, and by whom
/title ask 超时          →  name it yourself instead
/title auto             →  forget that name; the next message names it afresh
```

Once, deliberately. An earlier version followed the harness's own session title,
which is regenerated as a session moves on — so topic names drifted to whatever
had been discussed most recently, which is not what a name is for. You navigate
the topic column by memory of where things are, so a name that keeps moving costs
more than one that is slightly off. `platforms.<id>.autoRenameThread: false`
turns naming off entirely.

The summary comes from any OpenAI-compatible endpoint you point it at:

```yaml
title:
  llm:
    baseUrl: https://api.example.com/v1   # up to and including /v1
    apiKey: ${SOME_KEY}                   # ${VAR} expands from the .env sidecar
    model: gemini-3-flash-lite            # a flash-tier model is the right size
```

A flash-tier model answers in a second or two and costs ~60 tokens per
conversation — one call for the life of the topic, not one per turn. Leave
`title.llm` out and the name is the opening message cut to 40 characters, which
is a substring rather than a summary and reads like one. A call that fails takes
the same fallback, so naming never depends on the endpoint being up.

One limit worth knowing: Telegram offers no way to read a topic's current name
back, so a rename done in the Telegram UI is invisible here. It will not be
overwritten (nothing renames a named topic), but `/title` will report the name it
set rather than the one you see.
