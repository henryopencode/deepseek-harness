/** Codex-style microphone trigger and recording strip for the composer. */

import { useCallback, useRef } from 'react'
import type { CSSProperties, MouseEvent } from 'react'
import IconMicrophone from '@tabler/icons-react/dist/esm/icons/IconMicrophone.mjs'
import {
  IconCloseOutline16, IconLoadingOutline16, IconStopFill16,
  IconWarningOutline16, Toast, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SpeechInputInjected } from './index.ts'
import { useSpeechRecorder } from './useSpeechRecorder.ts'
import type { SpeechRecorderError } from './useSpeechRecorder.ts'
import css from './SpeechInput.module.css'

/** Full props for the composer right-side speech-input entry. */
export type SpeechInputProps =
  PropsRuntime<'conversation.input.right'>
  & InjectFace<SpeechInputInjected>
  & PropsLocale<'speechInput'>

/** Append recognized speech without sending or overwriting the current draft. */
function appendTranscript(draft: string, transcript: string): string {
  if (draft === '') return transcript
  return `${draft}${/\s$/u.test(draft) ? '' : ' '}${transcript}`
}

/** Keep the textarea focused while a toolbar gesture changes recording state. */
function keepComposerFocus(event: MouseEvent<HTMLButtonElement>): void {
  event.preventDefault()
}

/** Render the localized error for one stable recorder failure. */
function errorText(error: SpeechRecorderError, t: SpeechInputProps['t']): string {
  return t(`error.${error}`)
}

/** Composer microphone control and its full-width active recording state. */
export function SpeechInput({
  session, input, inputActions, describe, transcribe, t,
}: SpeechInputProps) {
  const latestDraft = useRef(input.draft)
  latestDraft.current = input.draft
  const microphoneRef = useRef<HTMLButtonElement | null>(null)
  const commit = useCallback((text: string) => {
    inputActions.setDraft(appendTranscript(latestDraft.current, text))
  }, [inputActions])
  const recorder = useSpeechRecorder({ describe, transcribe, onTranscript: commit })
  const parentUnavailable = session.subagent !== null && !session.subagent.parentAvailable
  const disabled = session.removed || parentUnavailable || input.phase !== 'plain'
  const toastText = recorder.error === null ? null : errorText(recorder.error, t)

  if (recorder.phase === 'recording') {
    return (
      <div className={css.strip} role="group" aria-label={t('status.recording')} data-speech-state="recording">
        <Tooltip label={t('button.cancel')} side="top" delayMs={400}>
          <button
            type="button"
            className={css.secondary}
            aria-label={t('button.cancel')}
            onMouseDown={keepComposerFocus}
            onClick={recorder.cancel}
          >
            <IconCloseOutline16 size={16} />
          </button>
        </Tooltip>
        <div className={css.waveform} aria-hidden>
          {recorder.levels.map((level, index) => (
            <span
              key={index}
              className={index >= recorder.levels.length - 8 ? css.waveRecent : css.wave}
              style={{ '--speech-level': level } as CSSProperties}
            />
          ))}
        </div>
        <Tooltip label={t('button.stop')} side="top" delayMs={400}>
          <button
            type="button"
            className={css.secondary}
            aria-label={t('button.stop')}
            onMouseDown={keepComposerFocus}
            onClick={recorder.stop}
          >
            <IconStopFill16 size={14} />
          </button>
        </Tooltip>
      </div>
    )
  }

  if (recorder.phase === 'transcribing') {
    return (
      <div className={css.strip} role="status" data-speech-state="transcribing">
        <IconLoadingOutline16 size={16} className={css.spinner} />
        <span className={css.statusText}>
          {recorder.preparingModel && recorder.model !== null
            ? t('status.preparing', { model: recorder.model })
            : t('status.transcribing')}
        </span>
      </div>
    )
  }

  return (
    <span className={css.triggerWrap}>
      {toastText !== null && (
        <Toast
          text={toastText}
          icon={<IconWarningOutline16 />}
          anchor={microphoneRef.current}
          onDone={recorder.clearError}
        />
      )}
      <Tooltip label={t('button.start')} side="top" delayMs={400}>
        <button
          ref={microphoneRef}
          type="button"
          className={css.microphone}
          aria-label={t('button.start')}
          disabled={disabled || recorder.phase === 'requesting'}
          onMouseDown={keepComposerFocus}
          onClick={recorder.start}
        >
          {recorder.phase === 'requesting'
            ? <IconLoadingOutline16 size={16} className={css.spinner} />
            : <IconMicrophone size={16} stroke={1.8} />}
        </button>
      </Tooltip>
    </span>
  )
}
