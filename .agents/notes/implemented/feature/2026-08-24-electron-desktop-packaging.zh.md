# Agent Note: Electron 桌面包

Status: implemented

[English](2026-08-24-electron-desktop-packaging.md) | 中文

## Problem

浏览器 profile 需要一个拥有本地 Web 进程、且可在 macOS、Linux 与 Windows 发布的原生应用。现有 Swift 启动器只能运行在 macOS 上，并依赖检出目录本地安装的 Node。

## Decision

`apps/desktop` 提供一个 Electron 主进程：它保留私有 loopback 端口，在保留平台用户目录和临时目录变量的干净环境中启动打包后的 `dsh web` CLI，在沙箱化 `BrowserWindow` 中渲染本地 URL，只向该 loopback 页面授予麦克风权限，并在退出时终止它拥有的进程树。

打包脚本先从桌面依赖根以 pnpm 的 hoisted node linker 运行 `pnpm deploy`。这会在 Electron resources 下生成平台匹配、自包含的运行时闭包，不复制会回指构建机器的 pnpm 工作区链接，也不会保留 Windows 资源管理器无法解压的深层虚拟仓库路径。包还携带匹配的 Node 可执行文件。macOS 归档 ARM64 `.app`；Linux 将 x64 可执行文件夹归档为 `.tar.gz`；Windows 归档包含 `.exe` 的 x64 文件夹。GitHub `Desktop Packages` workflow 在各自原生 runner 上构建三个平台，验证 Windows 归档路径不超过 220 个字符，并将全部归档上传到桌面 Release。

## Alternatives considered

**保留 Swift 启动器。** 拒绝，因为 AppKit 实现无法生成 Linux 或 Windows 可执行文件。

**复制检出目录及其 `node_modules`。** 拒绝，因为工作区链接可能包含构建机器的绝对路径，无法生成可携带归档。

**使用 Electron 的 Node runtime 运行 Harness 子进程。** 拒绝，因为原生模块必须匹配打包后的 Node ABI；启动器改为携带构建暂存依赖闭包的 Node runtime。

## Consequences

桌面归档体积较大，因为它有意包含 Harness runtime 与 Node 可执行文件。构建在原生 macOS ARM64、Linux x64 和 Windows x64 runner 上进行，因此每个归档都包含匹配的原生 addon。发布 workflow 会缓存各平台 Electron 下载文件，但每个包仍需暂存并压缩自包含 runtime。仓库没有 Developer ID、Linux 包签名或 Authenticode 签名凭证，所以下载后的归档首次启动时可能触发平台信任警告。
