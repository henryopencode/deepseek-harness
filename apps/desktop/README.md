# DeepSeek Harness Desktop

English | [中文](README.zh.md)

This Electron shell owns one private `dsh web` child process, embeds a matching Node runtime and built Harness tree, then displays that loopback server in a native window. Closing the window stops the owned child process tree.

## Build packages

Run `pnpm run build` first, then build the current platform:

```sh
pnpm --filter @deepseek-ai/dsh-desktop run package -- --platform darwin --arch arm64
```

The package script writes a directly runnable archive under `release/`. It supports `darwin/arm64`, `linux/x64`, and `win32/x64`; each package must be built on its matching operating system so the staged Node native dependencies match that platform. The Linux x64 archive extracts to one executable folder; run `./DeepSeek\ Harness-linux-x64/DeepSeek\ Harness` from the extraction directory. The GitHub `Desktop Packages` workflow builds all three native artifacts.

Windows users should download `DeepSeek-Harness-Setup-x64.exe`. It installs the app under the current user's local programs directory, creates desktop and Start Menu shortcuts, and includes an uninstaller. The ZIP is a portable fallback. The artifacts are unsigned because this repository does not carry a Developer ID, Linux package signature, or Authenticode certificate. macOS may require Control-click → Open, Windows may require More info → Run anyway, and Linux desktops may require marking the extracted executable as trusted.

The first local speech transcription still needs `ffmpeg`, `ffprobe`, CMake, and a C/C++ toolchain on the host; the Whisper model downloads under the Harness home.
