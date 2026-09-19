import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const app = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8'))

function pngSize(path: string) {
  const bytes = readFileSync(new URL(path, import.meta.url))
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

test('native app icons are square branded assets wired for iOS and Android', () => {
  assert.equal(app.expo.icon, './assets/icon.png')
  assert.equal(app.expo.ios.icon, './assets/icon.png')
  assert.equal(app.expo.android.adaptiveIcon.foregroundImage, './assets/adaptive-icon.png')
  assert.equal(app.expo.android.adaptiveIcon.backgroundColor, '#0a0e1a')
  assert.deepEqual(pngSize('../assets/icon.png'), { width: 1024, height: 1024 })
  assert.deepEqual(pngSize('../assets/adaptive-icon.png'), { width: 1024, height: 1024 })
})
