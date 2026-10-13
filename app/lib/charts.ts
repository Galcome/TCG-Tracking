/**
 * Chart geometry. Money stays an exact decimal string everywhere it is shown; turning it into
 * a float here is fine because the only output is a pixel position.
 */

import type { ValuePoint } from './api'
import { dateFromIso, yesterdayIso } from './format'
import { decimalCents } from './money-drafts'
import { centsString } from './pricing-drafts'

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

/**
 * How far market value moved from the point before the last one, in exact cents, and since
 * when: "yesterday" when the two points are a day apart, else the earlier date.
 */
export function lastChange(points: readonly ValuePoint[]): { amount: string; since: string } | null {
  if (points.length < 2) return null
  const [before, last] = points.slice(-2)
  const from = decimalCents(before.market_value)
  const to = decimalCents(last.market_value)
  const lastDay = dateFromIso(last.captured_on)
  if (from === null || to === null) return null
  return { amount: centsString(to - from), since: lastDay && yesterdayIso(lastDay) === before.captured_on ? 'yesterday' : before.captured_on }
}
