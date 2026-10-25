import { describe, expect, it } from 'vitest'
import css from './main.css?raw'

/**
 * The contrast claims in DESIGN.md, checked against the tokens themselves, so a
 * value tweaked in main.css cannot quietly drop a pair below WCAG 2.2 AA.
 */

/** The `--name: oklch(L C H)` tokens of one theme block (alpha tokens are skipped). */
function tokens(selector: ':root' | '.dark'): Map<string, [number, number, number]> {
  const start = css.indexOf(`\n${selector} {`)
  const block = css.slice(start, css.indexOf('\n}', start))
  const found = new Map<string, [number, number, number]>()
  for (const match of block.matchAll(/--([\w-]+): oklch\(([\d.]+) ([\d.]+) ([\d.]+)\);/g)) {
    found.set(match[1] ?? '', [Number(match[2]), Number(match[3]), Number(match[4])])
  }
  return found
}

/** OKLCH to WCAG relative luminance, through linear sRGB (clipped to gamut). */
function luminance([lightness, chroma, hue]: [number, number, number]): number {
  const angle = (hue * Math.PI) / 180
  const a = chroma * Math.cos(angle)
  const b = chroma * Math.sin(angle)
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3
  const [red, green, blue] = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((channel) => Math.min(1, Math.max(0, channel)))
  return 0.2126 * (red ?? 0) + 0.7152 * (green ?? 0) + 0.0722 * (blue ?? 0)
}

function contrast(theme: ':root' | '.dark', fore: string, back: string): number {
  const set = tokens(theme)
  const [one, two] = [set.get(fore), set.get(back)]
  if (!one || !two) throw new Error(`${theme} has no oklch --${fore} or --${back}`)
  const [light, dark] = [luminance(one), luminance(two)].sort((x, y) => y - x)
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05)
}

describe.each([':root', '.dark'] as const)('%s tokens', (theme) => {
  it.each(['background', 'card', 'muted'])(
    'give a solid focus indicator 3:1 on --%s',
    (surface) => {
      expect(contrast(theme, 'ring', surface)).toBeGreaterThanOrEqual(3)
    },
  )

  it.each(['muted-foreground', 'destructive', 'chart-1'])(
    'keep small --%s text at 4.5:1 on the chat cards',
    (text) => {
      expect(contrast(theme, text, 'background')).toBeGreaterThanOrEqual(4.5)
    },
  )
})
