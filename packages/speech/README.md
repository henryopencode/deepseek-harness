# speech/ — local speech processing

English | [中文](README.zh.md)

The speech family owns human-audio processing that stays outside the Session log until a person accepts the resulting text.

| Package | Role | ctx key |
|---|---|---|
| [`speech-to-text-local/`](speech-to-text-local/README.md) | Bounded local Whisper transcription plus the `speechToTextLocal.describe/transcribe` Host Remote | `speechToTextLocal` |

The browser control is independently composed by [`dsh-client-ui-speech-input`](../client/ui-speech-input/README.md). The Host service owns model choice, upload admission, media-duration validation, temporary-file cleanup, and single-operation concurrency; the browser owns microphone permission, recording lifetime, visualization, and draft insertion.
