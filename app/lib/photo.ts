export const MAX_PHOTO_BYTES = 6 * 1024 * 1024
export interface Photo { uri: string; name: string; type: string; size?: number; file?: File }
export function validatePhoto(photo: Photo): void {
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/heic'].includes(photo.type)) {
    throw new Error('Choose a JPEG, PNG, WebP or HEIC image. Manual entry is always available.')
  }
  if (photo.size != null && photo.size > MAX_PHOTO_BYTES) throw new Error('Each photo must be 6 MiB or smaller.')
}
export function photoBody(photo: Photo): FormData {
  validatePhoto(photo)
  const body = new FormData()
  if (photo.file) body.append('photo', photo.file, photo.name)
  else body.append('photo', { uri: photo.uri, name: photo.name, type: photo.type } as unknown as Blob)
  return body
}
