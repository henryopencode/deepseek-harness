import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { runNativeCommand } from '@deepseek-ai/dsh-native-command'
import { nodewhisper } from 'nodejs-whisper'
import SpeechToTextLocalService from '../src/index.ts'
import type { Config } from '../src/index.ts'

vi.mock('@deepseek-ai/dsh-native-command', () => ({
  runNativeCommand: vi.fn(),
}))
vi.mock('nodejs-whisper', () => ({
  nodewhisper: vi.fn(),
}))

const probe = vi.mocked(runNativeCommand)
const whisper = vi.mocked(nodewhisper)
const contexts: Context[] = []
let modelRoot: string | undefined

function config(overrides: Partial<Config> = {}): Config {
  if (modelRoot === undefined) throw new Error('model root not initialized')
  return {
    model: 'base',
    modelRootPath: modelRoot,
    autoDownload: true,
    language: 'auto',
    maxAudioBytes: 1024,
    maxAudioDurationMs: 60_000,
    ffprobePath: 'ffprobe',
    probeTimeoutMs: 1_000,
    useGpu: true,
    ...overrides,
  }
}

function service(overrides: Partial<Config> = {}): SpeechToTextLocalService {
  const ctx = new Context()
  contexts.push(ctx)
  return new SpeechToTextLocalService(ctx, config(overrides))
}

function audio(bytes = Buffer.from('fixture audio')): string {
  return bytes.toString('base64')
}

beforeEach(async () => {
  modelRoot = await mkdtemp(join(tmpdir(), 'dsh-speech-models-'))
  probe.mockResolvedValue({ stdout: '1.25\n', stderr: '' })
  whisper.mockResolvedValue('[00:00:00.000 --> 00:00:01.000] 你好，世界。\n')
})

afterEach(async () => {
  vi.clearAllMocks()
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  if (modelRoot !== undefined) await rm(modelRoot, { recursive: true, force: true })
  modelRoot = undefined
})

describe('local speech transcription service', () => {
  it('describes the resolved model and first-use readiness', async () => {
    await expect(service().describe()).resolves.toEqual({
      model: 'base',
      maxAudioBytes: 1024,
      maxAudioDurationMs: 60_000,
      modelReady: false,
    })
  })

  it('rejects unsupported and non-canonical wire audio before subprocess work', async () => {
    const local = service()
    await expect(local.transcribe({ audio: audio(), mediaType: 'audio/aac' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-audio' },
    })
    await expect(local.transcribe({ audio: 'not base64', mediaType: 'audio/webm' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-audio' },
    })
    expect(probe).not.toHaveBeenCalled()
    expect(whisper).not.toHaveBeenCalled()
  })

  it('enforces decoded bytes and probed duration', async () => {
    const bytes = service({ maxAudioBytes: 4 })
    await expect(bytes.transcribe({ audio: audio(Buffer.alloc(5)), mediaType: 'audio/webm' }))
      .resolves.toMatchObject({ ok: false, error: { code: 'audio-too-large', maxBytes: 4 } })

    probe.mockResolvedValueOnce({ stdout: '61\n', stderr: '' })
    const duration = service()
    await expect(duration.transcribe({ audio: audio(), mediaType: 'audio/webm' }))
      .resolves.toMatchObject({ ok: false, error: { code: 'audio-too-long', maxDurationMs: 60_000 } })
    expect(whisper).not.toHaveBeenCalled()
  })

  it('uses audio packet timestamps when a fragmented recording omits container duration', async () => {
    probe
      .mockResolvedValueOnce({ stdout: 'N/A\n', stderr: '' })
      .mockResolvedValueOnce({ stdout: '0.000000,0.021333\n0.021333,0.021333\n', stderr: '' })
    await expect(service().transcribe({ audio: audio(), mediaType: 'audio/mp4' }))
      .resolves.toMatchObject({ ok: true, value: { text: '你好，世界。' } })
    expect(probe).toHaveBeenNthCalledWith(
      2,
      'ffprobe',
      expect.arrayContaining(['-show_entries', 'packet=pts_time,duration_time']),
      expect.any(AbortSignal),
    )
  })

  it('transcribes one recording and strips whisper timestamp prefixes', async () => {
    const local = service()
    await expect(local.transcribe({
      audio: audio(),
      mediaType: 'audio/webm;codecs=opus',
    })).resolves.toEqual({
      ok: true,
      value: { text: '你好，世界。', model: 'base' },
    })
    expect(probe).toHaveBeenCalledWith(
      'ffprobe',
      expect.arrayContaining(['-show_entries', 'format=duration']),
      expect.any(AbortSignal),
    )
    expect(whisper).toHaveBeenCalledWith(expect.stringMatching(/recording\.webm$/), expect.objectContaining({
      modelName: 'base',
      autoDownloadModelName: 'base',
      modelRootPath: modelRoot,
    }))
  })

  it('admits only one transcription at a time', async () => {
    let settle: ((text: string) => void) | undefined
    whisper.mockImplementationOnce(() => new Promise((resolve) => { settle = resolve }))
    const local = service()
    const first = local.transcribe({ audio: audio(), mediaType: 'audio/webm' })
    await vi.waitFor(() => { expect(whisper).toHaveBeenCalledTimes(1) })
    await expect(local.transcribe({ audio: audio(), mediaType: 'audio/webm' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'busy' },
    })
    settle?.('[00:00:00.000 --> 00:00:01.000] 完成。')
    await expect(first).resolves.toMatchObject({ ok: true, value: { text: '完成。' } })
  })

  it('fails load-time strings and folds provider errors into a stable result', async () => {
    expect(() => service({ language: '  ' })).toThrow('language must not be empty')
    whisper.mockRejectedValueOnce(new Error('CMake unavailable'))
    await expect(service().transcribe({ audio: audio(), mediaType: 'audio/webm' }))
      .resolves.toMatchObject({ ok: false, error: { code: 'transcription-failed' } })
  })

  it('separates a completed silent recording from provider failure', async () => {
    whisper.mockResolvedValueOnce('[BLANK_AUDIO]\n')
    await expect(service().transcribe({ audio: audio(), mediaType: 'audio/webm' }))
      .resolves.toEqual({
        ok: false,
        error: { code: 'no-speech', message: 'No speech was recognized in the recording.' },
      })
  })
})
