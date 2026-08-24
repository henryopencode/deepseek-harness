# DeepSeek Harness Desktop

English | [中文](README.zh.md)

This Electron shell owns one private `dsh web` child process, embeds a matching Node runtime and built Harness tree, then displays that loopback server in a native window. Closing the window stops the owned child process tree.

## Build packages

Run `pnpm run build` first, then build the current platform:

```sh
pnpm --filter @deepseek-ai/dsh-desktop run package -- --platform darwin --arch arm64
```

The package script writes a directly runnable archive under `release/`. It supports `darwin/arm64` and `win32/x64`; Windows packages must be built on Windows so the staged Node native dependencies match that platform. The GitHub `Desktop Packages` workflow builds both native artifacts.

The artifacts are unsigned because this repository does not carry a Developer ID or Authenticode certificate. macOS may require Control-click → Open, and Windows may require More info → Run anyway.
