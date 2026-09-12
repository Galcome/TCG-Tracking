/** Delete only our dated CSV files, after recipients have had a full day to read them. */
export function expiredCsvCacheFile(name: string, now: number): boolean {
  const match = /^tcg-export-(\d+)-\d+-.+\.csv$/.exec(name)
  if (!match) return false
  const timestamp = Number(match[1])
  return Number.isSafeInteger(timestamp) && timestamp <= now - 24 * 60 * 60 * 1000
}
