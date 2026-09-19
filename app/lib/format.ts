import { reportMoney } from './reports'
export const money = reportMoney
export function percent(value: number | null | undefined) {
  return value == null ? 'Unknown' : (value * 100).toFixed(1) + '%';
}
export type Tone = 'gain' | 'loss' | null
/** Direction of a signed figure: gains green, losses red, zero and unknown neutral.
 * Decimal strings are read by sign and digits, never parsed to floats. */
export function tone(value: string | number | null | undefined): Tone {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return Number.isNaN(value) || value === 0 ? null : value > 0 ? 'gain' : 'loss'
  const match = value.trim().match(/^([+-]?)(\d*)(?:\.(\d*))?$/)
  if (!match || !/[1-9]/.test(match[2] + (match[3] ?? ''))) return null
  return match[1] === '-' ? 'loss' : 'gain'
}
/** A local calendar day as YYYY-MM-DD. Never via toISOString, which shifts to UTC. */
export function isoFromDate(d: Date) {
  return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-');
}
export function todayIso(now = new Date()) {
  return isoFromDate(now);
}
export function yesterdayIso(now = new Date()) {
  return isoFromDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
}
/** Local midnight for a YYYY-MM-DD string, or null when it is not a real calendar day. */
export function dateFromIso(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return isoFromDate(d) === value ? d : null
}
/** "Today", "Yesterday", or a short readable day such as "Sep 12, 2026". */
export function describeDate(value: string, now = new Date()) {
  if (value === todayIso(now)) return 'Today'
  if (value === yesterdayIso(now)) return 'Yesterday'
  const d = dateFromIso(value)
  return d ? d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Choose a date'
}
