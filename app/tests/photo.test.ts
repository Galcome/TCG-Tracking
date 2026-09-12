import assert from 'node:assert/strict'
import test from 'node:test'
import { MAX_PHOTO_BYTES, photoBody, validatePhoto } from '../lib/photo'
test('photo uploads validate actual type and size; unknown size remains server-limited', () => {
  const photo = { uri: 'file:///photo.jpg', name: 'photo.jpg', type: 'image/jpeg' }
  assert.doesNotThrow(() => validatePhoto({ ...photo, size: MAX_PHOTO_BYTES }))
  assert.doesNotThrow(() => validatePhoto(photo))
  assert.throws(() => validatePhoto({ ...photo, size: MAX_PHOTO_BYTES + 1 }), /6 MiB/)
  assert.throws(() => validatePhoto({ ...photo, type: 'application/pdf' }), /JPEG/)
  const file = new File(['photo'], 'photo.png', { type: 'image/png' })
  const body = photoBody({ ...photo, type: file.type, file })
  assert.equal((body.get('photo') as File).name, photo.name)
})
