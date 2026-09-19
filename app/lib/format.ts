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
export function todayIso() {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-');
}
