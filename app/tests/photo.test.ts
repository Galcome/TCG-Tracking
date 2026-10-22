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

test('native photos upload their bytes, since Expo fetch cannot send a uri part', async () => {
  // Node's FormData stringifies non-Blob parts; Expo's keeps them, so record what is appended.
  const appended: unknown[] = []
  const NodeFormData = globalThis.FormData
  globalThis.FormData = class { append(_name: string, value: unknown) { appended.push(value) } } as never
  const photo = { uri: 'file:///frame.jpg', name: 'frame.jpg', type: 'image/jpeg' }
  const bytes = new Uint8Array([0xff, 0xd8])
  try {
    photoBody({ ...photo, read: async () => bytes })
    assert.throws(() => photoBody(photo), /could not be read/)
  } finally {
    globalThis.FormData = NodeFormData
  }
  const part = appended[0] as { name: string; type: string; bytes: () => Promise<Uint8Array> }
  assert.equal(part.name, 'frame.jpg')
  assert.equal(part.type, 'image/jpeg')
  assert.equal(await part.bytes(), bytes)
})
