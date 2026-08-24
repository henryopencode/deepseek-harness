/** Client-safe request and result vocabulary for local speech transcription. */

/** Deployment preference before the Host resolves available memory. */
export type SpeechToTextModelPreference = 'auto' | 'base' | 'small'

/** Multilingual Whisper models supported by this local provider. */
export type SpeechToTextModel = Exclude<SpeechToTextModelPreference, 'auto'>

/** Browser-recorded audio submitted as canonical base64. */
export interface SpeechTranscriptionRequest {
  /** Canonical base64 audio bytes without a data-URL prefix. */
  readonly audio: string
  /** Browser-declared audio media type, including an optional codec parameter. */
  readonly mediaType: string
}

/** Resolved deployment limits and model readiness. */
export interface SpeechToTextDescription {
  readonly model: SpeechToTextModel
  readonly maxAudioBytes: number
  readonly maxAudioDurationMs: number
  /** Whether the selected model file already exists; false means the first transcription may download it. */
  readonly modelReady: boolean
}

/** Stable business failures returned to the recording control. */
export type SpeechTranscriptionFailure =
  | { readonly code: 'busy'; readonly message: string }
  | { readonly code: 'invalid-audio'; readonly message: string }
  | { readonly code: 'audio-too-large'; readonly message: string; readonly maxBytes: number }
  | { readonly code: 'audio-too-long'; readonly message: string; readonly maxDurationMs: number }
  | { readonly code: 'no-speech'; readonly message: string }
  | { readonly code: 'transcription-failed'; readonly message: string }

/** Successful local transcription or an explicit user-visible rejection. */
export type SpeechTranscriptionResult =
  | { readonly ok: true; readonly value: { readonly text: string; readonly model: SpeechToTextModel } }
  | { readonly ok: false; readonly error: SpeechTranscriptionFailure }
