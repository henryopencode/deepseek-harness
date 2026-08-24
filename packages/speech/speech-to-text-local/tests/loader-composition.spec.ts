import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { runNativeCommand } from '@deepseek-ai/dsh-native-command'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import { nodewhisper } from 'nodejs-whisper'
import SpeechToTextLocalService from '../src/index.ts'

vi.mock('@deepseek-ai/dsh-native-command', () => ({
  runNativeCommand: vi.fn(),
}))
vi.mock('nodejs-whisper', () => ({
  nodewhisper: vi.fn(),
}))

let root: string | undefined
const contexts: Context[] = []

afterEach(async () => {
  vi.clearAllMocks()
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('local speech transcription through a real Loader composition', () => {
  it('loads the Remote and transcribes through the external-command boundary', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-speech-loader-'))
    const configPath = join(root, 'cordis.yml')
    const modelRoot = join(root, 'models')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-speech-to-text-local'",
      '  config:',
      '    model: base',
      `    modelRootPath: ${JSON.stringify(modelRoot)}`,
      '    autoDownload: true',
      '    language: auto',
      '    maxAudioBytes: 1024',
      '    maxAudioDurationMs: 60000',
      '    ffprobePath: ffprobe',
      '    probeTimeoutMs: 1000',
      '    useGpu: true',
      '',
    ].join('\n'))

    vi.mocked(runNativeCommand).mockResolvedValue({ stdout: '0.8\n', stderr: '' })
    vi.mocked(nodewhisper).mockResolvedValue('[00:00:00.000 --> 00:00:00.800] Loader path works.\n')

    const ctx = new Context()
    contexts.push(ctx)
    ctx.baseUrl = pathToFileURL(root).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    ctx.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (specifier !== '@deepseek-ai/dsh-speech-to-text-local') {
          throw new Error(`unexpected Loader import: ${specifier}`)
        }
        return SpeechToTextLocalService
      },
    } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(configPath).href },
    })
    await ctx.loader.await()

    expect([...ctx.loader.entries()].filter(entry => entry.fiber === undefined && !entry.disabled)).toEqual([])
    expect(ctx.speechToTextLocal.typertRemote.namespace).toBe('speechToTextLocal')
    expect(remoteMethods(ctx.speechToTextLocal).map(marker => marker.method)).toEqual(['describe', 'transcribe'])
    await expect(ctx.speechToTextLocal.transcribe({
      audio: Buffer.from('loader audio').toString('base64'),
      mediaType: 'audio/webm',
    })).resolves.toEqual({
      ok: true,
      value: { text: 'Loader path works.', model: 'base' },
    })
  })
})
