# `@deepseek-ai/dsh-speech-to-text-local`

[English](README.md) | 中文

面向浏览器录音的 Host 本地 Whisper 转写 Remote。`speechToTextLocal.describe()` 返回解析后的多语言模型、权威字节／时长限制，以及对应 ggml 文件是否已经存在。`speechToTextLocal.transcribe({ audio, mediaType })` 接受规范 base64 编码的 WebM／Ogg／MP4／WAV 音频，用 `ffprobe` 检查解码后文件，只允许一个请求执行，调用 `nodejs-whisper`，并在结算后删除临时录音。

## 配置

| 字段 | 含义 |
|---|---|
| `model` | `auto`、`base` 或 `small`；`auto` 在可用时读取 `process.constrainedMemory()`，4 GiB 及以下选择 `base`，高于 4 GiB 选择 `small`。 |
| `modelRootPath` | `ggml-base.bin` 或 `ggml-small.bin` 所在目录。 |
| `autoDownload` | 模型缺失时允许 `nodejs-whisper` 下载所选模型。 |
| `language` | Whisper 语言选择器；`auto` 自动检测口语语言。 |
| `maxAudioBytes` | 解码后录音的最大字节数。 |
| `maxAudioDurationMs` | `ffprobe` 检查后允许的最大时长。 |
| `ffprobePath` | `ffprobe` 可执行文件路径或 PATH 名称。 |
| `probeTimeoutMs` | 时长检查的截止时间。 |
| `useGpu` | 允许 whisper.cpp 使用可用的 GPU 后端。 |

随附的 Web 组合允许 4 MiB 与 60 秒，把模型下载到 Harness home，并启用可用的 GPU 加速。首次使用需要 `ffmpeg`、`ffprobe`、CMake、C/C++ 工具链；`autoDownload` 为 true 时还需要网络。没有可执行文件时，`nodejs-whisper` 会在首次转写前编译其随附的 whisper.cpp checkout。

## 失败与生命周期行为

异常 base64、不支持的媒体类型、过大的录音、过长的媒体和并发请求都会返回明确的业务失败。提供方、构建、模型、转换和检查错误统一折叠为 `transcription-failed`，Host 日志保留底层错误。服务只会写入一个生成的临时目录和 `modelRootPath`；无论成功还是失败都会删除临时目录。每次转写启动一个有限生命周期的 whisper.cpp 进程，因此进程退出后会释放模型内存。

## 模型体验

无，因为该服务只把文字返回人类持有的浏览器草稿，不会追加 Session 事件或模型消息。

#### KV Cache 影响

无；只有人类之后通过普通输入框提交已接受文字，才会把它放入模型历史。

## 已知限制与延期工作

- **首次使用可能较慢**：模型下载和 whisper.cpp 编译没有进度通道，浏览器只能显示准备状态。
- **运行中的转写无法取消**：浏览器取消会在上传前结束录音，但 Remote 启动后，`nodejs-whisper` 不公开 abort signal。
- **提供方需要可写的已安装包文件**：`nodejs-whisper` 会在自身已安装包目录中构建随附的 C++ 源码；只读安装必须预构建或替换该提供方。
