/**
 * Host-local speech transcription over whisper.cpp. The Remote accepts one
 * bounded browser recording at a time, validates its decoded media duration,
 * and removes every temporary recording after the subprocess settles.
 * @module @deepseek-ai/dsh-speech-to-text-local
 */

import { Buffer } from 'node:buffer'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { runNativeCommand } from '@deepseek-ai/dsh-native-command'
import type { NativeCommandRunner } from '@deepseek-ai/dsh-native-command'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { nodewhisper } from 'nodejs-whisper'
import { availableMemoryBytes, resolveSpeechToTextModel } from './model.ts'
import type {
  SpeechToTextDescription, SpeechToTextModel, SpeechToTextModelPreference,
  SpeechTranscriptionFailure, SpeechTranscriptionRequest, SpeechTranscriptionResult,
} from './types.ts'

export type * from './types.ts'

/** Local model, admission, and executable policy. */
export interface Config {
  /** `auto` selects base at or below 4 GiB and small above it. */
  readonly model: SpeechToTextModelPreference
  /** Directory holding downloaded ggml model files. */
  readonly modelRootPath: string
  /** Download the selected model on its first use when absent. */
  readonly autoDownload: boolean
  /** Whisper language selector; `auto` performs language detection. */
  readonly language: string
  /** Maximum decoded recording bytes admitted from the browser. */
  readonly maxAudioBytes: number
  /** Maximum media duration admitted after ffprobe inspection. */
  readonly maxAudioDurationMs: number
  /** Executable path or PATH name used for duration inspection. */
  readonly ffprobePath: string
  /** Deadline for ffprobe inspection. */
  readonly probeTimeoutMs: number
  /** Allow whisper.cpp to use its available GPU backend. */
  readonly useGpu: boolean
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    speechToTextLocal: SpeechToTextLocalService
  }
}

const MODEL_FILES: Record<SpeechToTextModel, string> = {
  base: 'ggml-base.bin',
  small: 'ggml-small.bin',
}

/** Media types emitted by the supported browser MediaRecorder implementations. */
const AUDIO_EXTENSIONS: readonly [prefix: string, extension: string][] = [
  ['audio/webm', '.webm'],
  ['audio/ogg', '.ogg'],
  ['audio/mp4', '.m4a'],
  ['audio/wav', '.wav'],
]

/** Return one explicit failure branch. */
function rejected(error: SpeechTranscriptionFailure): SpeechTranscriptionResult {
  return { ok: false, error }
}

/** Resolve an extension only for browser formats the provider can probe and convert. */
function extensionFor(mediaType: string): string | undefined {
  return AUDIO_EXTENSIONS.find(([prefix]) => mediaType === prefix || mediaType.startsWith(`${prefix};`))?.[1]
}

/** Decode a bounded canonical base64 payload without first allocating an oversized buffer. */
function decodeAudio(data: string, maxBytes: number): Buffer | SpeechTranscriptionResult {
  const maxEncodedLength = Math.ceil(maxBytes / 3) * 4
  if (data.length > maxEncodedLength) {
    return rejected({
      code: 'audio-too-large',
      message: 'The recording exceeds the configured local transcription size limit.',
      maxBytes,
    })
  }
  const decoded = Buffer.from(data, 'base64')
  if (data.length === 0 || decoded.toString('base64') !== data) {
    return rejected({ code: 'invalid-audio', message: 'The recording is not canonical base64 audio.' })
  }
  if (decoded.byteLength > maxBytes) {
    return rejected({
      code: 'audio-too-large',
      message: 'The recording exceeds the configured local transcription size limit.',
      maxBytes,
    })
  }
  return decoded
}

/** Read one media duration with a bounded no-shell ffprobe invocation. */
async function probeDurationMs(
  filePath: string,
  command: string,
  timeoutMs: number,
  runner: NativeCommandRunner = runNativeCommand,
): Promise<number> {
  const abort = new AbortController()
  const timer = setTimeout(() => { abort.abort(new Error('ffprobe timed out')) }, timeoutMs)
  try {
    const { stdout } = await runner(command, [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', filePath,
    ], abort.signal)
    const seconds = Number(stdout.trim())
    if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds * 1000)

    // WKWebView may emit a fragmented MP4 recording whose container omits
    // `format=duration`. Packet timestamps remain present, so derive the last
    // audio packet end instead of rejecting an otherwise decodable recording.
    const packets = await runner(command, [
      '-v', 'error', '-select_streams', 'a:0',
      '-show_entries', 'packet=pts_time,duration_time', '-of', 'csv=p=0', filePath,
    ], abort.signal)
    const packetDuration = packets.stdout.split(/\r?\n/u).reduce((maximum, line) => {
      const [ptsText, durationText] = line.split(',', 2)
      const pts = Number(ptsText)
      const duration = Number(durationText)
      if (!Number.isFinite(pts)) return maximum
      return Math.max(maximum, pts + (Number.isFinite(duration) && duration > 0 ? duration : 0))
    }, 0)
    if (!Number.isFinite(packetDuration) || packetDuration <= 0) {
      throw new Error('ffprobe returned no positive audio packet duration')
    }
    return Math.ceil(packetDuration * 1000)
  } finally {
    clearTimeout(timer)
  }
}

/** Remove whisper.cpp timestamp prefixes and empty-audio markers from stdout. */
function transcriptText(stdout: string): string {
  return stdout.split(/\r?\n/u)
    .map(line => line.replace(/^\s*\[[\d:.]+\s+-->\s+[\d:.]+\]\s*/u, '').trim())
    .filter(line => line !== '' && line !== '[BLANK_AUDIO]')
    .join(' ')
    .trim()
}

/** Require a non-empty operator-controlled string at plugin load. */
function requireConfigString(name: string, value: string): string {
  if (value.trim() === '') throw new TypeError(`speech-to-text-local: ${name} must not be empty`)
  return value
}

/** Local Whisper Remote; one process-wide model operation runs at a time. */
export class SpeechToTextLocalService extends TypertRemoteService {
  static Config: z<Config> = z.object({
    model: z.union([z.const('auto'), z.const('base'), z.const('small')]).required(),
    modelRootPath: z.string().required(),
    autoDownload: z.boolean().required(),
    language: z.string().required(),
    maxAudioBytes: z.natural().min(1).required(),
    maxAudioDurationMs: z.natural().min(1).required(),
    ffprobePath: z.string().required(),
    probeTimeoutMs: z.natural().min(1).required(),
    useGpu: z.boolean().required(),
  })

  private readonly model: SpeechToTextModel
  private readonly modelRootPath: string
  private readonly language: string
  private readonly ffprobePath: string
  private busy = false

  /**
   * @param ctx - Host context used for logging and the generated Remote namespace.
   * @param config - explicit model, admission, and executable policy.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'speechToTextLocal')
    this.model = resolveSpeechToTextModel(config.model, availableMemoryBytes())
    this.modelRootPath = requireConfigString('modelRootPath', config.modelRootPath)
    this.language = requireConfigString('language', config.language)
    this.ffprobePath = requireConfigString('ffprobePath', config.ffprobePath)
  }

  /**
   * Describe the resolved model and authoritative recording limits.
   * @returns immutable limits plus whether the first-use download is already complete.
   */
  @Remote('describe')
  async describe(): Promise<SpeechToTextDescription> {
    let modelReady = true
    try {
      await access(join(this.modelRootPath, MODEL_FILES[this.model]))
    } catch {
      // File absence is the advertised first-use state; other access failures surface on transcription.
      modelReady = false
    }
    return {
      model: this.model,
      maxAudioBytes: this.config.maxAudioBytes,
      maxAudioDurationMs: this.config.maxAudioDurationMs,
      modelReady,
    }
  }

  /**
   * Validate, probe, and transcribe one browser recording locally.
   * @param request - canonical base64 audio and its browser media type.
   * @returns recognized text or a stable admission/provider failure.
   */
  @Remote('transcribe')
  async transcribe(request: SpeechTranscriptionRequest): Promise<SpeechTranscriptionResult> {
    if (this.busy) {
      return rejected({ code: 'busy', message: 'Another local transcription is already running.' })
    }
    const extension = extensionFor(request.mediaType)
    if (extension === undefined) {
      return rejected({ code: 'invalid-audio', message: `Unsupported recording media type: ${request.mediaType}` })
    }
    const decoded = decodeAudio(request.audio, this.config.maxAudioBytes)
    if (!Buffer.isBuffer(decoded)) return decoded

    this.busy = true
    let workingDirectory: string | undefined
    try {
      await mkdir(this.modelRootPath, { recursive: true })
      workingDirectory = await mkdtemp(join(tmpdir(), 'dsh-speech-to-text-'))
      const inputPath = join(workingDirectory, `recording${extension}`)
      await writeFile(inputPath, decoded)
      const durationMs = await probeDurationMs(
        inputPath,
        this.ffprobePath,
        this.config.probeTimeoutMs,
      )
      if (durationMs > this.config.maxAudioDurationMs) {
        return rejected({
          code: 'audio-too-long',
          message: 'The recording exceeds the configured local transcription duration limit.',
          maxDurationMs: this.config.maxAudioDurationMs,
        })
      }

      const output = await nodewhisper(inputPath, {
        modelName: this.model,
        modelRootPath: this.modelRootPath,
        ...(this.config.autoDownload ? { autoDownloadModelName: this.model } : {}),
        removeWavFileAfterTranscription: false,
        whisperOptions: {
          language: this.language,
          noGpu: !this.config.useGpu,
        },
        logger: {
          debug: (...args: unknown[]) => { this.ctx.logger.debug(args.map(String).join(' ')) },
          log: (...args: unknown[]) => { this.ctx.logger.info(args.map(String).join(' ')) },
          error: (...args: unknown[]) => {
            console.error('speech-to-text-local:', ...args)
            this.ctx.logger.warn(args.map(String).join(' '))
          },
        },
      })
      const text = transcriptText(output)
      if (text === '') {
        return rejected({ code: 'no-speech', message: 'No speech was recognized in the recording.' })
      }
      return { ok: true, value: { text, model: this.model } }
    } catch (error) {
      console.error('speech-to-text-local: transcription failed:', error)
      this.ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
      return rejected({
        code: 'transcription-failed',
        message: 'Local transcription failed. Check ffmpeg, ffprobe, CMake, and model availability.',
      })
    } finally {
      this.busy = false
      if (workingDirectory !== undefined) await rm(workingDirectory, { recursive: true, force: true })
    }
  }
}

export default SpeechToTextLocalService
