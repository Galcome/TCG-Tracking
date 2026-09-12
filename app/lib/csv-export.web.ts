import { buildCsv, csvFilename, type CsvDocument } from './csv'

export async function exportCsv(csv: CsvDocument): Promise<void> {
  const url = URL.createObjectURL(new Blob([buildCsv(csv)], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  try {
    link.href = url
    link.download = csvFilename(csv.name)
    document.body.appendChild(link)
    link.click()
  } finally {
    link.remove()
    // Delay revocation until the browser has consumed the click/download request.
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}
