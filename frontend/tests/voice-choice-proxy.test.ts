import test from 'node:test';
import assert from 'node:assert/strict';
import {PUT, GET} from '../src/app/api/voice/voices/route';

const put = (body: unknown) => PUT(new Request('http://localhost/api/voice/voices', {method: 'PUT', body: typeof body === 'string' ? body : JSON.stringify(body)}));

test('a voice choice needs a known language and a plain voice id (or null for the default)', async () => {
  for (const body of [{lang: 'fr', voiceId: 'UK-Nu-1-TM'}, {lang: 'en', voiceId: '../x'}, {lang: 'en', voiceId: 7}, {lang: 'en'}, {voiceId: 'a'}, 'not json']) {
    assert.equal((await put(body)).status, 400, JSON.stringify(body));
  }
});

test('the voice list only answers for vi or en', async () => {
  assert.equal((await GET(new Request('http://localhost/api/voice/voices?lang=zh'))).status, 400);
});
