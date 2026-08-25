import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { nodewhisper } from 'nodejs-whisper'
import SpeechToTextLocalService from '../src/index.ts'
import type { Config } from '../src/index.ts'

vi.mock('nodejs-whisper', () => ({
  nodewhisper: vi.fn(),
}))

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
    useGpu: true,
    ...overrides,
  }
}

function service(overrides: Partial<Config> = {}): SpeechToTextLocalService {
  const ctx = new Context()
  contexts.push(ctx)
  return new SpeechToTextLocalService(ctx, config(overrides))
}

function wav(samples = 100): Buffer {
  const data = Buffer.alloc(samples * 2)
  const header = Buffer.alloc(44)
  header.write('RIFF')
  header.writeUInt32LE(36 + data.byteLength, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(16_000, 24)
  header.writeUInt32LE(32_000, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.byteLength, 40)
  return Buffer.concat([header, data])
}

function audio(bytes = wav()): string {
  return bytes.toString('base64')
}

beforeEach(async () => {
  modelRoot = await mkdtemp(join(tmpdir(), 'dsh-speech-models-'))
  await writeFile(join(modelRoot, 'ggml-base.bin'), 'model')
  whisper.mockResolvedValue('[00:00:00.000 --> 00:00:01.000] 你好，世界。\n')
})

afterEach(async () => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  if (modelRoot !== undefined) await rm(modelRoot, { recursive: true, force: true })
  modelRoot = undefined
})

describe('local speech transcription service', () => {
  it('describes the resolved model and first-use readiness', async () => {
    if (modelRoot === undefined) throw new Error('model root not initialized')
    await rm(join(modelRoot, 'ggml-base.bin'))
    await expect(service().describe()).resolves.toEqual({
      model: 'base',
      maxAudioBytes: 1024,
      maxAudioDurationMs: 60_000,
      modelReady: false,
    })
  })

  it('rejects unsupported, non-canonical, and malformed WAV audio before subprocess work', async () => {
    const local = service()
    await expect(local.transcribe({ audio: audio(), mediaType: 'audio/aac' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-audio' },
    })
    await expect(local.transcribe({ audio: 'not base64', mediaType: 'audio/wav' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-audio' },
    })
    await expect(local.transcribe({ audio: audio(Buffer.alloc(43)), mediaType: 'audio/wav' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-audio' },
    })
    const malformed = wav()
    malformed.writeUInt16LE(2, 22)
    await expect(local.transcribe({ audio: audio(malformed), mediaType: 'audio/wav' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-audio' },
    })
    const truncated = wav()
    truncated.writeUInt32LE(1_000, 40)
    await expect(local.transcribe({ audio: audio(truncated), mediaType: 'audio/wav' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-audio' },
    })
    await expect(local.transcribe({ audio: audio(wav(0)), mediaType: 'audio/wav' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-audio' },
    })
    expect(whisper).not.toHaveBeenCalled()
  })

  it('enforces decoded bytes and WAV-header duration', async () => {
    const bytes = service({ maxAudioBytes: 4 })
    await expect(bytes.transcribe({ audio: audio(Buffer.alloc(5)), mediaType: 'audio/wav' }))
      .resolves.toMatchObject({ ok: false, error: { code: 'audio-too-large', maxBytes: 4 } })

    await expect(bytes.transcribe({ audio: audio(Buffer.alloc(7)), mediaType: 'audio/wav' }))
      .resolves.toMatchObject({ ok: false, error: { code: 'audio-too-large', maxBytes: 4 } })

    const duration = service({ maxAudioDurationMs: 2 })
    await expect(duration.transcribe({ audio: audio(), mediaType: 'audio/wav' }))
      .resolves.toMatchObject({ ok: false, error: { code: 'audio-too-long', maxDurationMs: 2 } })
    expect(whisper).not.toHaveBeenCalled()
  })

  it('transcribes one recording and strips whisper timestamp prefixes', async () => {
    const local = service()
    await expect(local.transcribe({
      audio: audio(),
      mediaType: 'audio/wav',
    })).resolves.toEqual({
      ok: true,
      value: { text: '你好，世界。', model: 'base' },
    })
    expect(whisper).toHaveBeenCalledWith(expect.stringMatching(/recording\.wav$/), expect.objectContaining({
      modelName: 'base',
      modelRootPath: modelRoot,
    }))
  })

  it('downloads a missing model without asking nodejs-whisper to rebuild its executable', async () => {
    if (modelRoot === undefined) throw new Error('model root not initialized')
    await rm(join(modelRoot, 'ggml-base.bin'))
    const fetchModel = vi.fn(() => Promise.resolve(new Response('downloaded model')))
    vi.stubGlobal('fetch', fetchModel)

    await expect(service().transcribe({ audio: audio(), mediaType: 'audio/wav' })).resolves.toMatchObject({ ok: true })
    expect(fetchModel).toHaveBeenCalledWith('https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin')
    await expect(readFile(join(modelRoot, 'ggml-base.bin'), 'utf8')).resolves.toBe('downloaded model')
    expect(whisper).toHaveBeenCalledWith(expect.any(String), expect.not.objectContaining({ autoDownloadModelName: 'base' }))
  })

  it('folds a missing-model download failure without leaving a partial model', async () => {
    if (modelRoot === undefined) throw new Error('model root not initialized')
    await rm(join(modelRoot, 'ggml-base.bin'))
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 503, body: null })))

    await expect(service().transcribe({ audio: audio(), mediaType: 'audio/wav' }))
      .resolves.toMatchObject({ ok: false, error: { code: 'transcription-failed' } })
    await expect(readFile(join(modelRoot, 'ggml-base.bin'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('folds a model response without a body', async () => {
    if (modelRoot === undefined) throw new Error('model root not initialized')
    await rm(join(modelRoot, 'ggml-base.bin'))
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, body: null })))

    await expect(service().transcribe({ audio: audio(), mediaType: 'audio/wav' }))
      .resolves.toMatchObject({ ok: false, error: { code: 'transcription-failed' } })
  })

  it('rejects a missing model when automatic download is disabled', async () => {
    if (modelRoot === undefined) throw new Error('model root not initialized')
    await rm(join(modelRoot, 'ggml-base.bin'))

    await expect(service({ autoDownload: false }).transcribe({ audio: audio(), mediaType: 'audio/wav' }))
      .resolves.toMatchObject({ ok: false, error: { code: 'transcription-failed' } })
    expect(whisper).not.toHaveBeenCalled()
  })

  it('admits only one transcription at a time', async () => {
    let settle: ((text: string) => void) | undefined
    whisper.mockImplementationOnce(() => new Promise((resolve) => { settle = resolve }))
    const local = service()
    const first = local.transcribe({ audio: audio(), mediaType: 'audio/wav' })
    await vi.waitFor(() => { expect(whisper).toHaveBeenCalledTimes(1) })
    await expect(local.transcribe({ audio: audio(), mediaType: 'audio/wav' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'busy' },
    })
    settle?.('[00:00:00.000 --> 00:00:01.000] 完成。')
    await expect(first).resolves.toMatchObject({ ok: true, value: { text: '完成。' } })
  })

  it('fails load-time strings and folds provider errors into a stable result', async () => {
    expect(() => service({ language: '  ' })).toThrow('language must not be empty')
    whisper.mockRejectedValueOnce(new Error('Whisper executable failed'))
    await expect(service().transcribe({ audio: audio(), mediaType: 'audio/wav' }))
      .resolves.toMatchObject({ ok: false, error: { code: 'transcription-failed' } })
  })

  it('separates a completed silent recording from provider failure', async () => {
    whisper.mockResolvedValueOnce('[BLANK_AUDIO]\n')
    await expect(service().transcribe({ audio: audio(), mediaType: 'audio/wav' }))
      .resolves.toEqual({
        ok: false,
        error: { code: 'no-speech', message: 'No speech was recognized in the recording.' },
      })
  })

  it('forwards Whisper logger output and normalizes non-Error failures', async () => {
    whisper.mockImplementationOnce(async (_input, options) => {
      options.logger?.debug('debug line')
      options.logger?.log('log line')
      options.logger?.error('error line')
      return '[00:00:00.000 --> 00:00:01.000] 完成。\n'
    })
    await expect(service().transcribe({ audio: audio(), mediaType: 'audio/wav' }))
      .resolves.toMatchObject({ ok: true, value: { text: '完成。' } })

    whisper.mockRejectedValueOnce('untyped failure')
    await expect(service().transcribe({ audio: audio(), mediaType: 'audio/wav' }))
      .resolves.toMatchObject({ ok: false, error: { code: 'transcription-failed' } })
  })
})
