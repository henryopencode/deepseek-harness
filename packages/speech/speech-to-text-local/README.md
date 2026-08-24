# `@deepseek-ai/dsh-speech-to-text-local`

English | [中文](README.zh.md)

A Host-local Whisper transcription Remote for browser recordings. `speechToTextLocal.describe()` returns the resolved multilingual model, authoritative byte/duration limits, and whether its ggml file is already present. `speechToTextLocal.transcribe({ audio, mediaType })` accepts canonical base64 WebM/Ogg/MP4/WAV audio, probes the decoded file with `ffprobe`, serializes execution to one request, invokes `nodejs-whisper`, and removes the temporary recording after settlement.

## Configuration

| Field | Meaning |
|---|---|
| `model` | `auto`, `base`, or `small`; `auto` uses `process.constrainedMemory()` when available and selects `base` through 4 GiB, `small` above it. |
| `modelRootPath` | Directory for `ggml-base.bin` or `ggml-small.bin`. |
| `autoDownload` | Let `nodejs-whisper` download the selected model when absent. |
| `language` | Whisper language selector; `auto` detects the spoken language. |
| `maxAudioBytes` | Maximum decoded recording size. |
| `maxAudioDurationMs` | Maximum duration accepted after `ffprobe` inspection. |
| `ffprobePath` | `ffprobe` executable path or PATH name. |
| `probeTimeoutMs` | Duration-probe deadline. |
| `useGpu` | Allow whisper.cpp to use its available GPU backend. |

The shipped Web composition admits 4 MiB and 60 seconds, downloads models under the Harness home, and enables available GPU acceleration. First use requires `ffmpeg`, `ffprobe`, CMake, a C/C++ toolchain, and network access when `autoDownload` is true. `nodejs-whisper` compiles its bundled whisper.cpp checkout before the first transcription when no executable exists.

## Failure and lifetime behavior

Malformed base64, unsupported media types, oversized recordings, overlong media, and concurrent requests return explicit business failures. Provider, build, model, conversion, and probe failures collapse to `transcription-failed` while the Host log retains the underlying error. The service writes only inside one generated temporary directory plus `modelRootPath`; it removes the temporary directory after success or failure. Each transcription launches a finite whisper.cpp process, so model memory is released when that process exits.

## Model Experience

None, as this service returns text to a human-owned browser draft and never appends a Session event or model message.

#### KV Cache effect

None; only a later user submission through the ordinary composer can place accepted text in model history.

## Known Limitations and Deferred Work

- **First use can be slow** — model download and whisper.cpp compilation have no progress channel beyond the browser's preparing state.
- **A running transcription is not cancellable** — browser cancellation ends recording before upload, but `nodejs-whisper` does not expose an abort signal after the Remote starts.
- **The provider requires writable installed package files** — `nodejs-whisper` builds its bundled C++ source under its installed package directory; a read-only package installation must prebuild or replace the provider.
