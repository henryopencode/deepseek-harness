# speech/：本地语音处理

[English](README.md) | 中文

语音家族负责处理人类音频；在人类接受转写文字之前，音频与结果都不会进入 Session 日志。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`speech-to-text-local/`](speech-to-text-local/README.md) | 有界的本地 Whisper 转写，以及 `speechToTextLocal.describe/transcribe` Host Remote | `speechToTextLocal` |

浏览器控件由 [`dsh-client-ui-speech-input`](../client/ui-speech-input/README.md) 独立组合。Host 服务负责模型选择、上传准入、媒体时长校验、临时文件清理和单操作并发；浏览器负责麦克风权限、录音生命周期、可视化与草稿插入。
