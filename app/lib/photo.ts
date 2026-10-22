export const MAX_PHOTO_BYTES = 6 * 1024 * 1024
/**
 * `file` on web; `read` on native. Expo's fetch sends only real bytes in a multipart body, so a
 * React Native `{ uri, name, type }` part fails with "Unsupported FormDataPart implementation".
 */
export interface Photo {
  uri: string; name: string; type: string; size?: number; file?: File
  read?: () => Promise<Uint8Array>
}
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
  else if (photo.read) {
    // Expo's fetch reads `bytes()`, and takes the part's filename and type from `name` and `type`.
    body.append('photo', { name: photo.name, type: photo.type, bytes: photo.read } as unknown as Blob)
  } else throw new Error('That photo could not be read. Manual entry is always available.')
  return body
}
