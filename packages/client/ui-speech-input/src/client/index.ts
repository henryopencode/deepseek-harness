/** Browser speech-input plugin: local recording control in the composer right-side slot. */

import type {
  SpeechToTextDescription, SpeechTranscriptionRequest, SpeechTranscriptionResult,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { SpeechInput } from './SpeechInput.tsx'
import { en, zh, type SpeechInputKey } from './locales.ts'

export type { SpeechInputProps } from './SpeechInput.tsx'
export type { SpeechInputKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Composer microphone and local-transcription copy. */
    speechInput: SpeechInputKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'speechInput'

/** Remote callbacks injected into the presentation component. */
export interface SpeechInputInjected {
  /** Read the resolved Host limits before opening a recording. */
  describe: () => Promise<SpeechToTextDescription>
  /** Submit one stopped recording to the local Host provider. */
  transcribe: (request: SpeechTranscriptionRequest) => Promise<SpeechTranscriptionResult>
}

/** Required services: composer slots, selected Host Remote, and locale registry. */
export const inject = ['slots', 'remote', 'remote.speechToTextLocal', 'locale']

/**
 * Register the microphone control immediately before the composer model seat.
 * @param ctx - Client root carrying the generated local speech Remote.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-speech-input: dictionaries')

  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: 'speech-input',
    order: 20,
    locale: NS,
    inject: (): SpeechInputInjected => ({
      describe: async () => {
        const carried = await ctx.remote.speechToTextLocal.describe()
        if (!carried.ok) throw new Error(`${carried.error.message} (${carried.error.code})`)
        return carried.value
      },
      transcribe: async (request) => {
        const carried = await ctx.remote.speechToTextLocal.transcribe(request)
        if (!carried.ok) throw new Error(`${carried.error.message} (${carried.error.code})`)
        return carried.value
      },
    }),
  }, SpeechInput))
}
