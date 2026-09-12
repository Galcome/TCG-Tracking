import assert from 'node:assert/strict'
import test from 'node:test'
import { expiredCsvCacheFile } from '../lib/csv-cache'

test('CSV cache cleanup targets only owned files at least a day old', () => {
  const day = 86_400_000
  assert.equal(expiredCsvCacheFile('tcg-export-100-1-sales.csv', day + 100), true)
  assert.equal(expiredCsvCacheFile('tcg-export-101-1-sales.csv', day + 100), false)
  for (const name of ['100-1-sales.csv', 'photo.jpg', 'tcg-export-nope-1-sales.csv', 'tcg-export-100-1-sales.txt']) {
    assert.equal(expiredCsvCacheFile(name, day + 100), false)
  }
})
