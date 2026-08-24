# Agent Note: Electron desktop packages

Status: implemented

[中文](2026-08-24-electron-desktop-packaging.zh.md)

## Problem

The browser profile needs a native application that owns its local web process and can ship on macOS and Windows. The existing Swift launcher only runs on macOS and relies on a checkout-local Node installation.

## Decision

`apps/desktop` provides an Electron main process that reserves a private loopback port, starts the packaged `dsh web` CLI with a clean environment, renders the local URL in a sandboxed `BrowserWindow`, grants microphone access only to that loopback page, and terminates its owned process tree on quit.

The package script first runs `pnpm deploy` from the desktop dependency root. This produces a platform-matched, self-contained runtime closure under Electron resources rather than copying pnpm workspace links that point back to a build machine. The package also carries a matching Node executable. macOS archives an ARM64 `.app`; Windows archives an x64 folder containing the `.exe`. The GitHub `Desktop Packages` workflow builds each platform on its native runner.

## Alternatives considered

**Keep the Swift launcher.** Rejected because its AppKit implementation cannot produce a Windows executable.

**Copy the checkout and its `node_modules` directory.** Rejected because workspace links can contain absolute build-machine paths and do not produce a portable archive.

**Use Electron's Node runtime for the Harness child.** Rejected because native modules must match the packaged Node ABI; the launcher instead carries the Node runtime that built the staged dependency closure.

## Consequences

The desktop archive is large because it intentionally includes the Harness runtime and Node executable. Builds take place on native macOS ARM64 and Windows x64 runners so each archive includes the matching native addons. The repository does not contain Developer ID or Authenticode signing credentials, so downloaded archives can trigger platform trust warnings before their first launch.
