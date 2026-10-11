/**
 * Chart geometry. Money stays an exact decimal string everywhere it is shown; turning it into
 * a float here is fine because the only output is a pixel position.
 */

export function plotValue(value: string | null | undefined): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const round = (value: number) => Math.round(value * 10) / 10

/**
 * One SVG path per series, all on the same vertical scale so the lines can be compared. A
 * single point draws as a flat line across the chart rather than an invisible dot.
 */
export function linePaths(
  series: readonly (readonly number[])[],
  width: number,
  height: number,
  inset = 4,
): string[] {
  const all = series.flat()
  if (all.length === 0) return series.map(() => '')
  let low = Math.min(...all)
  let high = Math.max(...all)
  if (high === low) {
    low -= 1
    high += 1
  }
  const y = (value: number) => round(inset + (height - 2 * inset) * (1 - (value - low) / (high - low)))
  return series.map(values => {
    if (values.length === 0) return ''
    if (values.length === 1) return `M0 ${y(values[0])} H${width}`
    const step = width / (values.length - 1)
    return values.map((value, index) => `${index ? 'L' : 'M'}${round(index * step)} ${y(value)}`).join(' ')
  })
}

/**
 * Stacked bars on one scale: each stack's parts become pixel heights against the tallest
 * stack, so a bar of one part and a bar of three can be compared. A negative part takes no
 * room.
 */
export function stackHeights(stacks: readonly (readonly number[])[], height: number): number[][] {
  const positive = stacks.map(parts => parts.map(part => Math.max(0, part)))
  const top = Math.max(0, ...positive.map(parts => parts.reduce((sum, part) => sum + part, 0)))
  if (top === 0) return positive.map(parts => parts.map(() => 0))
  return positive.map(parts => parts.map(part => round((part / top) * height)))
}
