# `@deepseek-ai/dsh-client-ui-speech-input`

English | [中文](README.zh.md)

Browser microphone input contributed to `conversation.input.right`. The idle entry is a microphone button. Recording replaces the resident tool row with a Codex-style strip while preserving the composer textarea and primary send circle: cancel on the left, a 96-point live amplitude history in the center, and stop on the right. Stopping submits one bounded recording to `speechToTextLocal`; success appends recognized text to the latest draft and never sends it automatically.

The control reads authoritative duration and byte limits before requesting microphone access. It stops automatically at the Host duration limit, distinguishes first-use model preparation from ordinary transcription, closes every media track and AudioContext on cancel/unmount, and maps browser permission, device, admission, provider, and transport failures to localized composer feedback.

## Model Experience

None, as recording state and recognized text remain in the human-owned draft until the ordinary composer submits them.

#### KV Cache effect

None; an accepted transcript has the same cache behavior as manually typed text after the user submits it.

## Known Limitations and Deferred Work

- **Draft insertion appends at the end** — the public composer action accepts a complete draft but does not expose the textarea selection to sibling plugins.
- **No partial transcript** — the local provider returns only after a stopped recording settles.
- **Browser permission remains authoritative** — missing `MediaRecorder`, unavailable devices, and denied microphone permission disable the interaction regardless of Host readiness.
