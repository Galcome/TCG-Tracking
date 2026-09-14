import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')
const packageJson = JSON.parse(read('package.json'))
const capacitor = read('capacitor.config.ts')
const vite = read('vite.config.ts')
const main = read('src/main.tsx')

assert.equal(packageJson.scripts.build, 'tsc -b && vite build')
assert.match(packageJson.scripts['mobile:build'], /vite build --mode mobile/)
assert.match(packageJson.scripts['mobile:sync'], /mobile:build.*cap sync/)
assert.match(capacitor, /webDir: ['"]dist['"]/)
assert.match(capacitor, /androidScheme: ['"]https['"]/)
assert.match(capacitor, /iosScheme: ['"]capacitor['"]/)
assert.doesNotMatch(capacitor, /\burl\s*:/)
assert.match(vite, /disable: mode === ['"]mobile['"]/)
assert.match(vite, /runtimeCaching/)
assert.match(vite, /clientsClaim: true/)
assert.match(vite, /skipWaiting: true/)
assert.match(main, /!Capacitor\.isNativePlatform\(\)/)
assert.match(main, /import\.meta\.env\.MODE !== ['"]mobile['"] /)

for (const asset of [
  'public/brand-mark.svg',
  'public/pwa-192x192.png',
  'public/pwa-512x512.png',
  'public/maskable-icon-512x512.png',
  'public/apple-touch-icon-180x180.png',
  'public/favicon.ico',
]) {
  assert.ok(existsSync(resolve(root, asset)), `missing generated asset: ${asset}`)
}

assert.match(read('android/app/src/main/AndroidManifest.xml'), /android\.permission\.CAMERA/)
assert.match(read('ios/App/App/Info.plist'), /NSCameraUsageDescription/)
console.log('mobile foundation checks passed')
