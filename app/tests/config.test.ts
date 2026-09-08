import test from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from '../lib/config.ts';
const config={EXPO_PUBLIC_API_URL:'https://api.example.test',EXPO_PUBLIC_FIREBASE_API_KEY:'public-key',
  EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN:'project.firebaseapp.com',EXPO_PUBLIC_FIREBASE_PROJECT_ID:'project'};
test('requires the existing Firebase project and API configuration',()=>{
  assert.throws(()=>readConfig({}),/Missing app configuration/);
  assert.equal(readConfig(config).projectId,'project');
});
test('rejects credentials, non-origin API paths and cleartext remote transport',()=>{
  for(const url of ['http://public.example.test','https://user:secret@example.test','https://api.example.test/path','https://api.example.test?key=secret','ftp://example.test'])
    assert.throws(()=>readConfig({...config,EXPO_PUBLIC_API_URL:url}));
  assert.equal(readConfig({...config,EXPO_PUBLIC_API_URL:'http://10.0.2.2:8001'}).apiUrl,'http://10.0.2.2:8001');
});
