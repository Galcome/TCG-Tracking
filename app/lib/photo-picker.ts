import * as ImagePicker from 'expo-image-picker'
import type { Photo } from './photo'
export const canCapturePhoto = true
export async function pickPhotos(camera = false): Promise<Photo[]> {
  const permission = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync()
  if (!permission.granted) throw new Error('Photo permission denied. Manual entry remains available.')
  const result = camera
    ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 })
    : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 5, quality: 1 })
  if (result.canceled) return []
  return result.assets.slice(0, 5).map((asset) => {
    const extension = asset.uri.split('?')[0].split('.').pop()?.toLowerCase()
    const uriType = extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : extension === 'heic' || extension === 'heif' ? 'image/heic' : extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : ''
    const type = asset.mimeType === 'image/heif' ? 'image/heic' : asset.mimeType || uriType
    return { uri: asset.uri, name: asset.fileName || `photo.${extension || 'jpg'}`, type, size: asset.fileSize }
  })
}
