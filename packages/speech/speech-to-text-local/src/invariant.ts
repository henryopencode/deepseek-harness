/** Package-owned invariant companion. @module @deepseek-ai/dsh-speech-to-text-local/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-speech-to-text-local'

/** Cordis companion plugin name. */
export const name = 'speech-to-text-local-invariant'
/** Services required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: each Remote request validates its complete wire
 * payload and one private admission flag owns the only subprocess slot.
 */
const install: InvariantInstaller = Object.assign(() => {}, { inject: ['speechToTextLocal'] })

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
