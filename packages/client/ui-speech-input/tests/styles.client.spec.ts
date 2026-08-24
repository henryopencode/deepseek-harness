import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(
  fileURLToPath(new URL('../src/client/SpeechInput.module.css', import.meta.url)),
  'utf8',
)
const tokens = readdirSync(fileURLToPath(new URL('../../ui-theme/src/styles/', import.meta.url)))
  .filter(name => name.endsWith('.css'))
  .map(name => readFileSync(fileURLToPath(new URL(`../../ui-theme/src/styles/${name}`, import.meta.url)), 'utf8'))
  .join('\n')

describe('speech input styles', () => {
  it('uses only declared theme tokens and no literal colours', () => {
    const named = [...css.matchAll(/var\((--(?:dsw|dsh|ds)-[a-z0-9-]+)/g)].map(match => match[1])
    expect(named.length).toBeGreaterThan(5)
    expect([...new Set(named)].filter(name => !tokens.includes(`  ${String(name)}:`))).toEqual([])
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i)
  })

  it('covers the tool row but leaves the primary send button visible', () => {
    const strip = /^\.strip \{([^}]*)\}/m.exec(css)?.[1] ?? ''
    expect(strip).toMatch(/position:\s*absolute/)
    expect(strip).toMatch(/left:\s*8px/)
    expect(strip).toMatch(/right:\s*54px/)
    expect(strip).toMatch(/bottom:\s*6px/)
  })
})
