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

/** Bar heights against the largest value. Negative values draw as no bar. */
export function barHeights(values: readonly number[], height: number): number[] {
  const top = Math.max(0, ...values)
  if (top === 0) return values.map(() => 0)
  return values.map(value => round((Math.max(0, value) / top) * height))
}

/**
 * The two halves of a stacked bar, as fractions of the whole. A negative part takes no room:
 * when trading is behind, the bar is all personal money and the copy says by how much.
 */
export function shares(first: number, second: number): [number, number] {
  const a = Math.max(0, first)
  const b = Math.max(0, second)
  const total = a + b
  if (total === 0) return [0, 0]
  return [a / total, b / total]
}
