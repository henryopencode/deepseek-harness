import electron from 'electron'
import { createServer } from 'node:net'
import { appendFile, mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const { app, BrowserWindow, Menu, session, shell, systemPreferences } = electron

const appDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryDirectory = resolve(appDirectory, '../..')
const packagedHarnessDirectory = join(process.resourcesPath, 'harness')
const harnessDirectory = app.isPackaged ? packagedHarnessDirectory : repositoryDirectory
const nodeExecutable = app.isPackaged
  ? join(process.resourcesPath, 'node', process.platform === 'win32' ? 'node.exe' : 'node')
  : process.env.DSH_DESKTOP_NODE ?? process.env.npm_node_execpath ?? process.execPath
const inheritedEnvironment = process.env
const childPath = process.platform === 'win32'
  ? `${dirname(nodeExecutable)};${inheritedEnvironment.SystemRoot ?? 'C:\\Windows'}\\System32;${inheritedEnvironment.SystemRoot ?? 'C:\\Windows'}`
  : `${dirname(nodeExecutable)}:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`

let mainWindow
let harnessProcess
let harnessPort
let harnessLog

/** Escape one diagnostic value before rendering it into the local status page. */
function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character])
}

/** Render a small local launcher status page before Harness has its own UI. */
async function showStatus(title, detail) {
  await mainWindow.loadURL(`data:text/html,${encodeURIComponent(`<!doctype html>
<meta charset="utf-8">
<main style="font:16px -apple-system,BlinkMacSystemFont,sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#fff;color:#202124">
  <section style="max-width:560px;text-align:center">
    <h1>${escapeHtml(title)}</h1>
    <p style="color:#5f6368;line-height:1.6">${escapeHtml(detail)}</p>
  </section>
</main>`)} `)
}

/** Persist child output without exposing it to the rendered local page. */
function appendHarnessLog(value) {
  if (harnessLog === undefined) return
  void appendFile(harnessLog, value).catch(() => {
    // The launcher keeps running if the optional diagnostic file cannot be written.
  })
}

/** Reserve one loopback port before the owned child starts its web listener. */
async function reservePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        server.close()
        reject(new Error('could not reserve a loopback port'))
        return
      }
      const { port } = address
      server.close((error) => error === undefined ? resolvePort(port) : reject(error))
    })
  })
}

/** Wait for the private Harness server to return its first successful response. */
async function waitForHarness(url) {
  const deadline = Date.now() + 60_000
  let lastError = 'server did not respond'
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) })
      if (response.ok) return
      lastError = `HTTP ${response.status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 350))
  }
  throw new Error(`DeepSeek Harness did not start: ${lastError}`)
}

/** Stop the child process and all children it owns. */
function stopHarness() {
  if (harnessProcess?.pid === undefined) return
  const { pid } = harnessProcess
  harnessProcess = undefined
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { windowsHide: true }).unref()
    return
  }
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    // The child already exited, so there is no owned process group left to stop.
  }
}

/** Start the packaged CLI as an owned private loopback server. */
async function startHarness() {
  harnessPort = await reservePort()
  const logDirectory = join(app.getPath('userData'), 'logs')
  await mkdir(logDirectory, { recursive: true })
  harnessLog = join(logDirectory, 'harness.log')
  const cli = app.isPackaged
    ? join(harnessDirectory, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    : join(harnessDirectory, 'apps', 'cli', 'lib', 'bin.js')
  harnessProcess = spawn(nodeExecutable, [cli, '--profile', 'web', '--no-open', '--port', String(harnessPort)], {
    cwd: harnessDirectory,
    detached: process.platform !== 'win32',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      HOME: inheritedEnvironment.HOME,
      USER: inheritedEnvironment.USER,
      LOGNAME: inheritedEnvironment.LOGNAME,
      LANG: inheritedEnvironment.LANG ?? 'en_US.UTF-8',
      TMPDIR: inheritedEnvironment.TMPDIR,
      PATH: childPath,
      ...process.platform === 'win32' ? {
        SystemRoot: inheritedEnvironment.SystemRoot,
        WINDIR: inheritedEnvironment.WINDIR,
        ComSpec: inheritedEnvironment.ComSpec,
        PATHEXT: inheritedEnvironment.PATHEXT,
      } : {},
      ...Object.fromEntries(['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY'].flatMap(name => {
        const value = inheritedEnvironment[name] ?? inheritedEnvironment[name.toLowerCase()]
        return value === undefined || value === '' ? [] : [[name, value]]
      })),
    },
  })
  harnessProcess.stdout.on('data', data => appendHarnessLog(String(data)))
  harnessProcess.stderr.on('data', data => {
    appendHarnessLog(String(data))
    console.error(`[harness] ${String(data).trimEnd()}`)
  })
  harnessProcess.on('exit', (code, signal) => {
    if (harnessProcess === undefined || mainWindow?.isDestroyed()) return
    void showStatus('DeepSeek Harness 已停止', `code: ${String(code)}，signal: ${String(signal)}。日志：${harnessLog ?? '不可用'}`)
  })
  await waitForHarness(`http://127.0.0.1:${String(harnessPort)}/`)
}

/** Create the shell window and attach it to the locally owned Harness server. */
async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: 'DeepSeek Harness',
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  await showStatus('正在启动 DeepSeek Harness…', '正在准备本地服务。')
  await startHarness()
  await mainWindow.loadURL(`http://127.0.0.1:${String(harnessPort)}/`)
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const allowed = permission === 'media'
      && details.mediaTypes?.includes('audio') === true
      && webContents.getURL() === `http://127.0.0.1:${String(harnessPort)}/`
    callback(allowed)
  })
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
  ]))
  try {
    await createWindow()
    if (process.platform === 'darwin') void systemPreferences.askForMediaAccess('microphone')
  } catch (error) {
    console.error(error)
    if (mainWindow !== undefined && !mainWindow.isDestroyed()) {
      await showStatus('DeepSeek Harness 启动失败', error instanceof Error ? error.message : String(error))
    }
  }
})

app.on('window-all-closed', () => app.quit())
app.on('before-quit', stopHarness)

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow()
})
