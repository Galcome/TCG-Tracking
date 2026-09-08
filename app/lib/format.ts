export function money(value: string | null | undefined, fallback = 'Unknown') {
  if (value === null || value === undefined) return fallback;
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(Number(value));
}
export function percent(value: number | null | undefined) {
  return value == null ? 'Unknown' : (value * 100).toFixed(1) + '%';
}
export function todayIso() {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-');
}
