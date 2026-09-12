import type { Photo } from './photo'
export const canCapturePhoto = false
export async function pickPhotos(_camera = false): Promise<Photo[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/jpeg,image/png,image/webp,image/heic'
    input.multiple = true
    input.style.display = 'none'
    let finished = false
    let focusTimer: ReturnType<typeof setTimeout> | undefined
    const finish = (photos: Photo[]) => {
      if (finished) return
      finished = true
      window.removeEventListener('focus', focused)
      clearTimeout(focusTimer)
      input.remove()
      resolve(photos)
    }
    // Older browsers may omit the file-input cancel event. Returning focus restores
    // the manual form instead of leaving a cancelled picker permanently locked.
    const focused = () => { focusTimer = setTimeout(() => { if (!input.files?.length) finish([]) }, 500) }
    window.addEventListener('focus', focused)
    input.addEventListener('cancel', () => finish([]), { once: true })
    input.addEventListener('change', () => finish(Array.from(input.files ?? []).slice(0, 5).map((file) => ({
      uri: '', name: file.name, type: file.type === 'image/heif' ? 'image/heic' : file.type, size: file.size, file,
    }))), { once: true })
    document.body.appendChild(input)
    input.click()
  })
}
