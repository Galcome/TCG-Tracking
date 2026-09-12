import type { Photo } from './photo'
export const canCapturePhoto = false
export async function pickPhotos(_camera = false): Promise<Photo[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/jpeg,image/png,image/webp,image/heic'
    input.multiple = true
    input.style.display = 'none'
    const finish = (photos: Photo[]) => { input.remove(); resolve(photos) }
    input.addEventListener('cancel', () => finish([]), { once: true })
    input.addEventListener('change', () => finish(Array.from(input.files ?? []).slice(0, 5).map((file) => ({
      uri: '', name: file.name, type: file.type === 'image/heif' ? 'image/heic' : file.type, size: file.size, file,
    }))), { once: true })
    document.body.appendChild(input)
    input.click()
  })
}
