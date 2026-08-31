import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

/** Keep every install icon mechanically derived from the in-app Wordmark. */
export default defineConfig({
  images: ['public/brand-mark.svg'],
  preset: minimal2023Preset,
})
