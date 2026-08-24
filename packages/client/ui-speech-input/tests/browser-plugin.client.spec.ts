// @vitest-environment jsdom
import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { SpeechInputInjected } from '../src/client/index.ts'
import { apply, inject } from '../src/client/index.ts'

async function bench() {
  const ctx = new Context()
  const describeRemote = vi.fn().mockResolvedValue({
    ok: true,
    value: {
      model: 'base', maxAudioBytes: 1024, maxAudioDurationMs: 60_000, modelReady: true,
    },
  })
  const transcribeRemote = vi.fn().mockResolvedValue({
    ok: true,
    value: { ok: true, value: { text: 'voice text', model: 'base' } },
  })
  class RemoteService extends Service {
    constructor(serviceCtx: Context) { super(serviceCtx, 'remote') }
  }
  new RemoteService(ctx)
  ctx.provide('remote.speechToTextLocal', {
    describe: describeRemote,
    transcribe: transcribeRemote,
  })
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: { 'conversation.input.right': { kind: 'list', scope: 'session' } },
  } as never, (() => null) as never)
  ctx.provide('locale', new LocaleRuntime(ctx))
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  const entry = () => ctx.slots.entries('conversation.input.right')[0]
  return { ctx, fiber, entry, describeRemote, transcribeRemote }
}

describe('ui-speech-input browser plugin', () => {
  it('registers one localized right-side composer entry and disposes it with the fiber', async () => {
    const b = await bench()
    expect(b.entry()?.options).toMatchObject({ id: 'speech-input', order: 20 })
    expect(b.entry()?.locale).toBe('speechInput')
    await b.fiber.dispose()
    expect(b.ctx.slots.entries('conversation.input.right')).toHaveLength(0)
    await b.ctx.fiber.dispose()
  })

  it('unwraps describe and transcription Remote carrier results', async () => {
    const b = await bench()
    const face = b.entry()?.inject?.() as unknown as SpeechInputInjected
    await expect(face.describe()).resolves.toMatchObject({ model: 'base', maxAudioBytes: 1024 })
    await expect(face.transcribe({ audio: 'YQ==', mediaType: 'audio/webm' })).resolves.toEqual({
      ok: true,
      value: { text: 'voice text', model: 'base' },
    })
    expect(b.transcribeRemote).toHaveBeenCalledWith({ audio: 'YQ==', mediaType: 'audio/webm' })
    await b.ctx.fiber.dispose()
  })

  it('turns carrier failures into rejected callbacks', async () => {
    const b = await bench()
    b.describeRemote.mockResolvedValueOnce({
      ok: false,
      error: { code: 'internal', message: 'offline', details: {} },
    })
    const face = b.entry()?.inject?.() as unknown as SpeechInputInjected
    await expect(face.describe()).rejects.toThrow('offline (internal)')
    await b.ctx.fiber.dispose()
  })
})
