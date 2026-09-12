import { Directory, File, Paths } from 'expo-file-system'
import { isAvailableAsync, shareAsync } from 'expo-sharing'
import { buildCsv, csvFilename, type CsvDocument } from './csv'
import { expiredCsvCacheFile } from './csv-cache'

let sequence = 0
export async function exportCsv(csv: CsvDocument): Promise<void> {
  if (!await isAvailableAsync()) throw new Error('File sharing is unavailable on this device.')
  const now = Date.now()
  // Android's chooser may resolve before the recipient finishes reading the URI.
  // Retain successful shares in cache; prune only our expired files on the next export.
  try {
    for (const entry of new Directory(Paths.cache).list()) {
      if (entry instanceof File && expiredCsvCacheFile(entry.name, now)) entry.delete()
    }
  } catch { /* OS cache eviction remains a fallback. */ }
  const filename = `tcg-export-${now}-${++sequence}-${csvFilename(csv.name)}`
  const file = new File(Paths.cache, filename)
  let owned = false
  let shared = false
  try {
    file.create({ overwrite: false })
    owned = true
    file.write(buildCsv(csv))
    await shareAsync(file.uri, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text', dialogTitle: 'Export CSV' })
    shared = true
  } finally {
    if (owned && !shared) {
      try { if (file.exists) file.delete() } catch { /* OS cache eviction remains a fallback. */ }
    }
  }
}
