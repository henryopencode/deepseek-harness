/** Browser microphone lifecycle and amplitude history for the speech-input control. */

import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  SpeechToTextDescription, SpeechTranscriptionRequest, SpeechTranscriptionResult,
} from '@deepseek-ai/dsh-api-remotes/client'

const WAVEFORM_POINTS = 96
const LEVEL_SAMPLE_INTERVAL_MS = 50
const DESCRIPTION_TIMEOUT_MS = 10_000
const PCM_CAPTURE_BUFFER_SAMPLES = 4096
const WAV_SAMPLE_RATE = 16_000

type RecorderPhase = 'idle' | 'requesting' | 'recording' | 'transcribing'

/** Stable product error keys emitted by the browser recording lifecycle. */
export type SpeechRecorderError =
  | 'unsupported'
  | 'permission'
  | 'microphone'
  | 'audio-too-large'
  | 'audio-too-long'
  | 'no-speech'
  | 'busy'
  | 'invalid-audio'
  | 'transcription-failed'
  | 'transport'

/** Render-facing recording phase, waveform, model preparation, and failure state. */
export interface SpeechRecorderState {
  /** Current microphone or transcription phase. */
  readonly phase: RecorderPhase
  /** Rolling normalized amplitude history, oldest to newest. */
  readonly levels: readonly number[]
  /** Whether the current transcription may be downloading and building its model. */
  readonly preparingModel: boolean
  /** Resolved model name after Host limits have loaded. */
  readonly model: string | null
  /** Latest stable failure key, cleared by retry or toast dismissal. */
  readonly error: SpeechRecorderError | null
}

/** Host callbacks and the accepted-text sink used by one recorder instance. */
export interface SpeechRecorderDependencies {
  /** Read authoritative recording limits before microphone capture. */
  readonly describe: () => Promise<SpeechToTextDescription>
  /** Submit one stopped recording to the local provider. */
  readonly transcribe: (request: SpeechTranscriptionRequest) => Promise<SpeechTranscriptionResult>
  /** Commit recognized text into the current human draft. */
  readonly onTranscript: (text: string) => void
}

/** Nodes and samples owned by one active microphone capture. */
interface PcmCapture {
  /** Source node attached to the active microphone stream. */
  readonly source: MediaStreamAudioSourceNode
  /** Legacy Web Audio recorder supported by macOS WKWebView. */
  readonly processor: ScriptProcessorNode
  /** Silent sink that keeps the processor rendering without speaker feedback. */
  readonly silence: GainNode
  /** Copied mono PCM frames, in the AudioContext's original sample rate. */
  readonly samples: Float32Array[]
  /** Source PCM sample rate. */
  readonly sampleRate: number
}

const INITIAL_LEVELS = Object.freeze(Array.from({ length: WAVEFORM_POINTS }, () => 0.06))

/** Encode one bounded recording without a data-URL prefix. */
async function blobBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

/** Bound one Host description request so a recorder cannot remain pending forever. */
function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error('speech description timed out')) }, timeoutMs)
    void operation.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error) => { clearTimeout(timer); reject(error) },
    )
  })
}

/** Turn captured mono float PCM into a compact 16 kHz WAV recording. */
function wavBlob(capture: PcmCapture): Blob {
  const inputLength = capture.samples.reduce((total, samples) => total + samples.length, 0)
  const input = new Float32Array(inputLength)
  let writeOffset = 0
  for (const samples of capture.samples) {
    input.set(samples, writeOffset)
    writeOffset += samples.length
  }
  const ratio = capture.sampleRate / WAV_SAMPLE_RATE
  const outputLength = Math.ceil(input.length / ratio)
  const buffer = new ArrayBuffer(44 + outputLength * 2)
  const view = new DataView(buffer)
  view.setUint32(0, 0x5249_4646, false)
  view.setUint32(4, 36 + outputLength * 2, true)
  view.setUint32(8, 0x5741_5645, false)
  view.setUint32(12, 0x666d_7420, false)
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, WAV_SAMPLE_RATE, true)
  view.setUint32(28, WAV_SAMPLE_RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  view.setUint32(36, 0x6461_7461, false)
  view.setUint32(40, outputLength * 2, true)
  let inputOffset = 0
  for (let outputOffset = 0; outputOffset < outputLength; outputOffset += 1) {
    const nextOffset = Math.min(input.length, Math.round((outputOffset + 1) * ratio))
    let sum = 0
    let count = 0
    while (inputOffset < nextOffset) {
      sum += input[inputOffset] ?? 0
      inputOffset += 1
      count += 1
    }
    const sample = count === 0 ? 0 : Math.max(-1, Math.min(1, sum / count))
    view.setInt16(44 + outputOffset * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
  }
  return new Blob([buffer], { type: 'audio/wav' })
}

/** Fold browser setup errors into stable product copy keys. */
function setupError(error: unknown): SpeechRecorderError {
  if (error instanceof DOMException && error.name === 'NotAllowedError') return 'permission'
  if (error instanceof DOMException && error.name === 'NotFoundError') return 'microphone'
  return 'transport'
}

/**
 * Own one component-local recording lifecycle. Unmount closes every media
 * track and AudioContext; a stopped recording is the only path to the Remote.
 * @param dependencies - Host limit/transcription callbacks and accepted-text sink.
 * @returns current render state and the four recording-control actions.
 */
export function useSpeechRecorder(dependencies: SpeechRecorderDependencies): SpeechRecorderState & {
  start: () => void
  stop: () => void
  cancel: () => void
  clearError: () => void
} {
  const { describe, transcribe, onTranscript } = dependencies
  const [state, setState] = useState<SpeechRecorderState>({
    phase: 'idle', levels: INITIAL_LEVELS, preparingModel: false, model: null, error: null,
  })
  const alive = useRef(true)
  const phase = useRef<RecorderPhase>('idle')
  const capture = useRef<PcmCapture | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const audioContext = useRef<AudioContext | null>(null)
  const animationFrame = useRef<number | null>(null)
  const durationTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelled = useRef(false)
  const description = useRef<SpeechToTextDescription | null>(null)
  const latestTranscriptHandler = useRef(onTranscript)
  latestTranscriptHandler.current = onTranscript

  const publishPhase = useCallback((next: RecorderPhase) => {
    phase.current = next
    if (alive.current) setState(previous => ({ ...previous, phase: next }))
  }, [])

  const clearDurationTimer = useCallback(() => {
    if (durationTimer.current !== null) clearTimeout(durationTimer.current)
    durationTimer.current = null
  }, [])

  const disconnectCapture = useCallback((current: PcmCapture | null): void => {
    if (current === null) return
    current.processor.onaudioprocess = null
    current.source.disconnect()
    current.processor.disconnect()
    current.silence.disconnect()
  }, [])

  const closeMedia = useCallback(() => {
    clearDurationTimer()
    if (animationFrame.current !== null) cancelAnimationFrame(animationFrame.current)
    animationFrame.current = null
    const currentCapture = capture.current
    capture.current = null
    disconnectCapture(currentCapture)
    for (const track of stream.current?.getTracks() ?? []) track.stop()
    stream.current = null
    const context = audioContext.current
    audioContext.current = null
    if (context !== null) void context.close().catch(() => {
      // A browser may close the context as its track ends; no resource remains to recover.
    })
  }, [clearDurationTimer, disconnectCapture])

  const fail = useCallback((error: SpeechRecorderError) => {
    closeMedia()
    phase.current = 'idle'
    if (alive.current) {
      setState(previous => ({ ...previous, phase: 'idle', levels: INITIAL_LEVELS, error }))
    }
  }, [closeMedia])

  const transcribeRecording = useCallback(async (blob: Blob) => {
    closeMedia()
    if (cancelled.current) {
      cancelled.current = false
      publishPhase('idle')
      return
    }
    publishPhase('transcribing')
    const currentDescription = description.current
    if (currentDescription === null) {
      fail('transport')
      return
    }
    if (blob.size > currentDescription.maxAudioBytes) {
      fail('audio-too-large')
      return
    }
    try {
      const result = await transcribe({
        audio: await blobBase64(blob),
        mediaType: 'audio/wav',
      })
      if (!alive.current) return
      if (!result.ok) {
        fail(result.error.code)
        return
      }
      latestTranscriptHandler.current(result.value.text)
      setState(previous => ({
        ...previous,
        phase: 'idle',
        levels: INITIAL_LEVELS,
        preparingModel: false,
        error: null,
      }))
      phase.current = 'idle'
    } catch {
      if (alive.current) fail('transport')
    }
  }, [closeMedia, fail, publishPhase, transcribe])

  const stop = useCallback(() => {
    if (phase.current !== 'recording') return
    clearDurationTimer()
    publishPhase('transcribing')
    const current = capture.current
    capture.current = null
    disconnectCapture(current)
    if (current === null || current.samples.length === 0) {
      fail('no-speech')
      return
    }
    void transcribeRecording(wavBlob(current))
  }, [clearDurationTimer, disconnectCapture, fail, publishPhase, transcribeRecording])

  const sampleLevels = useCallback((analyser: AnalyserNode) => {
    const samples = new Uint8Array(analyser.fftSize)
    let previousSampleAt = 0
    const sample = (now: number): void => {
      if (phase.current !== 'recording') return
      if (now - previousSampleAt >= LEVEL_SAMPLE_INTERVAL_MS) {
        analyser.getByteTimeDomainData(samples)
        let amplitude = 0
        for (const value of samples) amplitude = Math.max(amplitude, Math.abs(value - 128) / 128)
        const level = Math.max(0.06, Math.min(1, amplitude * 1.8))
        if (alive.current) {
          setState(previous => ({
            ...previous,
            levels: Object.freeze([...previous.levels.slice(1), level]),
          }))
        }
        previousSampleAt = now
      }
      animationFrame.current = requestAnimationFrame(sample)
    }
    animationFrame.current = requestAnimationFrame(sample)
  }, [])

  const start = useCallback(() => {
    if (phase.current !== 'idle') return
    const AudioContextConstructor = Reflect.get(globalThis, 'AudioContext') as typeof AudioContext | undefined
    const mediaDevices = Reflect.get(navigator, 'mediaDevices') as MediaDevices | undefined
    if (AudioContextConstructor === undefined || mediaDevices?.getUserMedia === undefined) {
      fail('unsupported')
      return
    }
    publishPhase('requesting')
    setState(previous => ({ ...previous, error: null }))
    const context = new AudioContextConstructor()
    audioContext.current = context
    void context.resume().catch(() => {
      // getUserMedia is the authoritative microphone gate; closeMedia handles a failed setup.
    })
    const microphone = mediaDevices.getUserMedia({ audio: true })
    void Promise.all([
      withTimeout(describe(), DESCRIPTION_TIMEOUT_MS),
      microphone,
    ] as const).then(([limits, mediaStream]) => {
      if (!alive.current) {
        for (const track of mediaStream.getTracks()) track.stop()
        return
      }
      description.current = limits
      stream.current = mediaStream
      cancelled.current = false
      const source = context.createMediaStreamSource(mediaStream)
      const analyser = context.createAnalyser()
      analyser.fftSize = 64
      const processor = context.createScriptProcessor(PCM_CAPTURE_BUFFER_SAMPLES, 1, 1)
      const silence = context.createGain()
      silence.gain.value = 0
      const samples: Float32Array[] = []
      processor.onaudioprocess = (event) => {
        samples.push(new Float32Array(event.inputBuffer.getChannelData(0)))
      }
      source.connect(analyser)
      source.connect(processor)
      processor.connect(silence)
      silence.connect(context.destination)
      capture.current = { source, processor, silence, samples, sampleRate: context.sampleRate }
      setState(previous => ({
        ...previous,
        model: limits.model,
        preparingModel: !limits.modelReady,
        levels: INITIAL_LEVELS,
      }))
      publishPhase('recording')
      sampleLevels(analyser)
      durationTimer.current = setTimeout(stop, limits.maxAudioDurationMs)
    }).catch((error: unknown) => {
      void microphone.then((mediaStream) => {
        for (const track of mediaStream.getTracks()) track.stop()
      }).catch(() => {
        // The setup rejection already determines the visible failure state.
      })
      if (alive.current) fail(setupError(error))
    })
  }, [describe, fail, publishPhase, sampleLevels, stop, transcribeRecording])

  const cancel = useCallback(() => {
    if (phase.current !== 'recording') return
    cancelled.current = true
    clearDurationTimer()
    closeMedia()
    publishPhase('idle')
  }, [clearDurationTimer, closeMedia, publishPhase])

  useEffect(() => () => {
    alive.current = false
    cancelled.current = true
    closeMedia()
  }, [closeMedia])

  const clearError = useCallback(() => {
    setState(previous => previous.error === null ? previous : { ...previous, error: null })
  }, [])

  return { ...state, start, stop, cancel, clearError }
}
