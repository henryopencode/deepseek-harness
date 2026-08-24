// Web e2e scenario: the shipped speech-input plugin opens Chromium's fake
// microphone, replaces the composer tool row with the Codex-style recording
// strip, preserves the send circle, and cancels without invoking Whisper.
// This is the non-unit real-composition path for the product-visible plugin:
// the real Loader, generated Remote, HTTP carrier, dynamic client bundle,
// MediaRecorder, Web Audio setup, slot renderer, and composer all participate.
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspaceZh, saveFailureShot, ZH_BROWSER_LOCALE } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/speech-input', import.meta.url))
const LAYOUT_EXPECTED = fileURLToPath(new URL('./snapshots/speech-input/layout.expected.md', import.meta.url))
const MODE = webSnapshotMode()

describe('web e2e: local speech input recording state', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold()
    browser = await chromium.launch({
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    })
    page = await browser.newPage({
      viewport: { width: 1680, height: 1000 },
      locale: ZH_BROWSER_LOCALE,
    })
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    try {
      await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    } catch (error) {
      throw new Error([
        error instanceof Error ? error.message : String(error),
        `page errors: ${tripwire.pageErrors.join(' | ')}`,
        `console warnings: ${tripwire.warnings.join(' | ')}`,
        `body: ${(await page.locator('body').innerText()).slice(0, 1000)}`,
      ].join('\n'))
    }
    await connectFreshWorkspaceZh(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('records with cancel, waveform, and stop while leaving send visible', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-speech-input'))
    const card = page.locator('[data-composer-card]')
    const input = page.getByPlaceholder('描述你想要构建的内容')
    await input.fill('也可以以插件的形式，然后样式我想你的这个，也就是 Codex 的这个')
    const microphone = page.getByRole('button', { name: '开始语音输入' })
    const send = page.getByRole('button', { name: '发送消息' })
    await microphone.waitFor({ timeout: 15_000 })
    const microphoneVisible = await microphone.isVisible()

    await microphone.click()
    const strip = page.locator('[data-speech-state="recording"]')
    await strip.waitFor({ timeout: 15_000 })
    const cancel = page.getByRole('button', { name: '取消录音' })
    const stop = page.getByRole('button', { name: '停止并转写' })
    await cancel.waitFor()
    await stop.waitFor()

    const cardBox = await card.boundingBox()
    const stripBox = await strip.boundingBox()
    const sendBox = await send.boundingBox()
    expect(cardBox).not.toBeNull()
    expect(stripBox).not.toBeNull()
    expect(sendBox).not.toBeNull()
    const stripInsideCard = stripBox!.x >= cardBox!.x
      && stripBox!.x + stripBox!.width <= cardBox!.x + cardBox!.width
      && stripBox!.y >= cardBox!.y
      && stripBox!.y + stripBox!.height <= cardBox!.y + cardBox!.height
    const stripAndSendDisjoint = stripBox!.x + stripBox!.width <= sendBox!.x
    const golden = [
      '# Local speech input recording state',
      '',
      `- Microphone visible before recording: ${String(microphoneVisible)}`,
      `- Recording strip inside composer card: ${String(stripInsideCard)}`,
      `- Recording strip and send button disjoint: ${String(stripAndSendDisjoint)}`,
      `- Cancel button visible: ${String(await cancel.isVisible())}`,
      `- Stop button visible: ${String(await stop.isVisible())}`,
      `- Send button remains visible: ${String(await send.isVisible())}`,
    ].join('\n')
    await compareOrRefreshGolden(LAYOUT_EXPECTED, golden, MODE)
    expect(stripInsideCard).toBe(true)
    expect(stripAndSendDisjoint).toBe(true)

    await cancel.click()
    await microphone.waitFor({ state: 'visible', timeout: 10_000 })
    expect(await strip.count()).toBe(0)
    expect(await input.inputValue()).toBe('也可以以插件的形式，然后样式我想你的这个，也就是 Codex 的这个')
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 120_000)

  it('keeps the snapshot inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['layout.expected.md'])
  })
})
