# DeepSeek Harness 桌面端

[English](README.md) | 中文

这个 Electron 外壳拥有一个私有 `dsh web` 子进程，把匹配的 Node runtime 和已构建 Harness 一起嵌入，然后在原生窗口展示该 loopback 服务。关闭窗口会停止它拥有的子进程树。

## 构建安装包

先运行 `pnpm run build`，再构建当前平台：

```sh
pnpm --filter @deepseek-ai/dsh-desktop run package -- --platform darwin --arch arm64
```

打包脚本会在 `release/` 下生成可直接运行的归档。它支持 `darwin/arm64` 与 `win32/x64`；Windows 包必须在 Windows 上构建，确保暂存的 Node 原生依赖匹配平台。GitHub `Desktop Packages` workflow 会构建两个原生产物。

仓库未提供 Developer ID 或 Authenticode 证书，因此下载归档首次启动时可能出现平台信任警告。macOS 可按住 Control 点击 → 打开，Windows 可选择更多信息 → 仍要运行。
