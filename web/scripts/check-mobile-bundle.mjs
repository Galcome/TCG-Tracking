import assert from 'node:assert/strict'
import { existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const dist = resolve(import.meta.dirname, '..', 'dist')
assert.ok(existsSync(resolve(dist, 'index.html')), 'mobile build did not emit index.html')
assert.ok(!existsSync(resolve(dist, 'sw.js')), 'mobile build must not emit a service worker')
assert.ok(
  !existsSync(resolve(dist, 'manifest.webmanifest')),
  'mobile build must not emit a browser web manifest',
)
assert.ok(
  !readdirSync(dist).some((entry) => entry.startsWith('workbox-')),
  'mobile build must not emit Workbox runtime assets',
)
console.log('mobile bundle checks passed')
