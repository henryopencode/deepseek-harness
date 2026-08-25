# Agent Note: Electron desktop packages

Status: implemented

[中文](2026-08-24-electron-desktop-packaging.zh.md)

## Problem

The browser profile needs a native application that owns its local web process and can ship on macOS, Linux, and Windows. The existing Swift launcher only runs on macOS and relies on a checkout-local Node installation.

## Decision

`apps/desktop` provides an Electron main process that reserves a private loopback port, starts the packaged `dsh web` CLI with a clean environment that retains platform user-profile and temporary-directory variables, renders the local URL in a sandboxed `BrowserWindow`, grants microphone access only to that loopback page, and terminates its owned process tree on quit.

The package script first runs `pnpm deploy` from the desktop dependency root with pnpm's hoisted node linker. This produces a platform-matched, self-contained runtime closure under Electron resources rather than copying pnpm workspace links that point back to a build machine or preserving deep virtual-store paths that Windows Explorer cannot extract. The package also carries a matching Node executable. macOS archives an ARM64 `.app`; Linux archives an x64 executable folder as `.tar.gz`; Windows archives an x64 folder containing the `.exe` and packages it into a per-user NSIS installer that creates desktop and Start Menu shortcuts and registers an Installed apps entry. The GitHub `Desktop Packages` workflow uses a short Windows staging path, verifies archive paths stay within 220 characters, installs and uninstalls the Windows installer while checking its shortcuts and registration, and uploads all artifacts to the desktop release.

## Alternatives considered

**Keep the Swift launcher.** Rejected because its AppKit implementation cannot produce Linux or Windows executables.

**Copy the checkout and its `node_modules` directory.** Rejected because workspace links can contain absolute build-machine paths and do not produce a portable archive.

**Use Electron's Node runtime for the Harness child.** Rejected because native modules must match the packaged Node ABI; the launcher instead carries the Node runtime that built the staged dependency closure.

## Consequences

The desktop archive is large because it intentionally includes the Harness runtime and Node executable. Builds take place on native macOS ARM64, Linux x64, and Windows x64 runners so each archive includes the matching native addons. The release workflow caches platform Electron downloads, while each package still stages and compresses its self-contained runtime. The repository does not contain Developer ID, Linux package-signing, or Authenticode credentials, so downloaded archives and the Windows installer can trigger platform trust warnings before their first launch.
