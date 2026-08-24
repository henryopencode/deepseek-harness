import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const desktopDirectory = resolve(scriptDirectory, '..')
const repositoryDirectory = resolve(desktopDirectory, '../..')
const args = new Map(process.argv.slice(2).flatMap((value, index, all) =>
  value.startsWith('--') ? [[value.slice(2), all[index + 1]]] : []))
const platform = args.get('platform') ?? process.platform
const arch = args.get('arch') ?? process.arch
const stageRoot = process.env.DSH_DESKTOP_STAGE_ROOT ?? join(tmpdir(), 'dsh-desktop-stage')
const stageDirectory = join(stageRoot, `${platform}-${arch}`)
const releaseDirectory = join(repositoryDirectory, 'release')
const packageName = 'DeepSeek Harness'
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const makensisExecutable = process.env.NSIS_MAKENSIS ?? 'makensis.exe'

/** Run one build command and reject with its exit status. */
function run(command, commandArgs, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, commandArgs, {
      stdio: 'inherit',
      ...options,
      ...process.platform === 'win32' && command === pnpmCommand ? { shell: true } : {},
    })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolveRun() : reject(new Error(`${command} exited with ${String(code)}`)))
  })
}

/** Copy the Node runtime that matches the dependencies staged for this platform. */
async function copyNodeRuntime(target) {
  if (platform !== 'win32') {
    await cp(process.execPath, join(target, 'node'), { force: true })
    return
  }
  await cp(dirname(process.execPath), target, { recursive: true, dereference: true })
}

/** Build the per-user Windows installer and its desktop and Start Menu shortcuts. */
async function packageWindowsInstaller(packageDirectory) {
  const installer = join(releaseDirectory, 'DeepSeek-Harness-Setup-x64.exe')
  const installerScript = join(stageDirectory, 'DeepSeek-Harness.nsi')
  await rm(installer, { force: true })
  await writeFile(installerScript, String.raw`Unicode true
!include "MUI2.nsh"
!define MUI_ABORTWARNING
Name "DeepSeek Harness"
OutFile "${installer}"
InstallDir "$LOCALAPPDATA\Programs\DeepSeek Harness"
RequestExecutionLevel user
SetCompressor /SOLID lzma
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"
Section "Install"
  SetShellVarContext current
  SetOutPath "$INSTDIR"
  File /r "${join(packageDirectory, '*')}"
  CreateDirectory "$SMPROGRAMS\DeepSeek Harness"
  CreateShortCut "$DESKTOP\DeepSeek Harness.lnk" "$INSTDIR\DeepSeek Harness.exe"
  CreateShortCut "$SMPROGRAMS\DeepSeek Harness\DeepSeek Harness.lnk" "$INSTDIR\DeepSeek Harness.exe"
  CreateShortCut "$SMPROGRAMS\DeepSeek Harness\卸载 DeepSeek Harness.lnk" "$INSTDIR\Uninstall DeepSeek Harness.exe"
  WriteUninstaller "$INSTDIR\Uninstall DeepSeek Harness.exe"
SectionEnd
Section "Uninstall"
  SetShellVarContext current
  Delete "$DESKTOP\DeepSeek Harness.lnk"
  RMDir /r "$SMPROGRAMS\DeepSeek Harness"
  RMDir /r "$INSTDIR"
SectionEnd
`)
  await run(makensisExecutable, [installerScript])
}

/** Package a runnable Electron shell, then add the built Harness and Node runtime. */
async function main() {
  if (!['darwin', 'linux', 'win32'].includes(platform)) {
    throw new Error(`desktop package only supports darwin, linux, or win32, got ${platform}`)
  }
  await rm(stageDirectory, { recursive: true, force: true })
  await mkdir(stageDirectory, { recursive: true })
  const harnessDirectory = join(stageDirectory, 'harness')
  await run(pnpmCommand, [
    '--config.node-linker=hoisted',
    '--filter', '@deepseek-ai/dsh-desktop',
    'deploy', '--legacy', harnessDirectory,
  ], { cwd: repositoryDirectory })
  const nodeDirectory = join(stageDirectory, 'node')
  await mkdir(nodeDirectory, { recursive: true })
  await copyNodeRuntime(nodeDirectory)
  const packagedDirectory = join(stageDirectory, 'electron')
  const electronPackage = JSON.parse(await readFile(
    join(repositoryDirectory, 'node_modules', 'electron', 'package.json'),
    'utf8',
  ))
  await run(process.execPath, [
    join(repositoryDirectory, 'node_modules', '@electron', 'packager', 'bin', 'electron-packager.mjs'),
    desktopDirectory,
    packageName,
    `--platform=${platform}`,
    `--arch=${arch}`,
    `--out=${packagedDirectory}`,
    '--overwrite',
    '--asar',
    '--ignore=node_modules',
    '--prune=false',
    `--electron-version=${electronPackage.version}`,
    ...process.env.ELECTRON_CACHE === undefined ? [] : [`--download.cacheRoot=${process.env.ELECTRON_CACHE}`],
    ...(platform === 'darwin' ? [`--extend-info=${join(desktopDirectory, 'build', 'Info.plist')}`] : []),
  ], { cwd: repositoryDirectory })
  const folderName = `${packageName}-${platform}-${arch}`
  const packageDirectory = join(packagedDirectory, folderName)
  const resourcesDirectory = platform === 'darwin'
    ? join(packageDirectory, `${packageName}.app`, 'Contents', 'Resources')
    : join(packageDirectory, 'resources')
  await cp(harnessDirectory, join(resourcesDirectory, 'harness'), { recursive: true })
  await cp(nodeDirectory, join(resourcesDirectory, 'node'), { recursive: true, dereference: true })
  if (platform === 'darwin') {
    await run('codesign', ['--force', '--deep', '--sign', '-', join(packageDirectory, `${packageName}.app`)])
  }
  await mkdir(releaseDirectory, { recursive: true })
  const archiveName = {
    darwin: 'DeepSeek-Harness-macos-arm64.zip',
    linux: 'DeepSeek-Harness-linux-x64.tar.gz',
    win32: 'DeepSeek-Harness-windows-x64.zip',
  }[platform]
  const archive = join(releaseDirectory, archiveName)
  await rm(archive, { force: true })
  if (platform === 'darwin') {
    await run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', join(packageDirectory, `${packageName}.app`), archive])
  } else if (platform === 'linux') {
    await run('tar', ['-c', '-z', '-f', archive, folderName], { cwd: packagedDirectory })
  } else {
    await run('tar', ['-a', '-c', '-f', archive, folderName], { cwd: packagedDirectory })
  }
  if (platform === 'win32') await packageWindowsInstaller(packageDirectory)
  process.stdout.write(`desktop package: ${archive}\n`)
}

await main()
