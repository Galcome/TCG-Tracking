import { reportMoney } from './reports'
export const money = reportMoney
export function percent(value: number | null | undefined) {
  return value == null ? 'Unknown' : (value * 100).toFixed(1) + '%';
}
export function todayIso() {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-');
}
