/**
 * Exporting to a spreadsheet, which is where the group already lives.
 *
 * Two rules carried over from the first export and worth stating, because both are ways a
 * file can look right and be wrong:
 *
 * **Unknown exports as empty, never `0`.** A sale whose cost basis was never recorded has
 * no margin, and a zero in that cell turns "we do not know" into "it was free" the moment
 * somebody sums the column.
 *
 * **Every cell is quoted.** Set names contain commas - "Mega Evolution: Pitch Black Night"
 * is fine, but a channel called "Cards, Comics & Games" would shift every column to its
 * right without warning.
 */

/** Written as an escape, not a literal: an invisible character in source is one nobody
 *  can see, review, or explain when a diff moves it. Excel needs it to read UTF-8. */
const BOM = '\ufeff'

/** A cell that is genuinely unknown. Distinct from a zero, which is a measurement. */
export const UNKNOWN = ''

function escape(cell: string | number | null | undefined): string {
  const text = cell === null || cell === undefined ? '' : String(cell)
  return `"${text.replace(/"/g, '""')}"`
}

/**
 * Build the file and hand it to the browser.
 *
 * A byte-order mark leads the file so Excel reads it as UTF-8. Without it, a set name
 * with an accent or an em dash opens as mojibake on a default Windows install, which is
 * the machine this will actually be opened on.
 */
export function downloadCsv(
  name: string,
  header: string[],
  rows: (string | number | null | undefined)[][],
): void {
  const body = [header, ...rows].map((line) => line.map(escape).join(',')).join('\n')
  const url = URL.createObjectURL(
    new Blob([BOM + body], { type: 'text/csv;charset=utf-8' }),
  )

  const link = document.createElement('a')
  link.href = url
  link.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

/** A ratio as a percentage with two decimals, or blank when it is genuinely unknown. */
export function percentCell(value: number | null | undefined): string {
  return value === null || value === undefined ? UNKNOWN : (value * 100).toFixed(2)
}
