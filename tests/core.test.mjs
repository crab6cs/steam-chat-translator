import test from 'node:test';
import assert from 'node:assert/strict';
import { createQueue, eligibleText, languageName } from '../frontend/chat.js';

test('filters links, emojis and oversized messages without rejecting foreign scripts', () => {
  for (const value of ['', 'a', '1234', '😀', 'https://example.com/hello', 'steam://joinlobby/730/1/2', 'é'.repeat(2001)]) {
    assert.equal(eligibleText(value), false, value);
  }
  for (const value of ['Olá, queres jogar?', 'Привет', '你好', 'hello mate', 'go https://example.com']) assert.equal(eligibleText(value), true);
  assert.equal(languageName('pt'), 'Portuguese');
});

test('deduplicates in-flight requests, caches responses, and serializes requests', async () => {
  let calls = 0, active = 0, maxActive = 0;
  const q = createQueue(async text => {
    calls++; active++; maxActive = Math.max(maxActive, active);
    await new Promise(r => setTimeout(r, 10)); active--;
    return JSON.stringify({ok:true, translated:`English ${text}`, source:'pt'});
  }, 0);
  await Promise.all([q.run('um'), q.run('um'), q.run('dois')]);
  await q.run('um');
  assert.equal(calls, 2); assert.equal(maxActive, 1); q.stop();
});

test('a failed translation can be retried and does not poison later requests', async () => {
  let calls = 0;
  const q = createQueue(async () => ++calls === 1 ? {ok:false,error:'Rate limited'} : {ok:true,source:'pt',translated:'Hello'}, 0);
  await assert.rejects(q.run('Olá'), /Rate limited/);
  assert.equal((await q.run('Olá')).translated, 'Hello'); q.stop();
});

test('queued work is cancelled when the chat closes or translation is paused', async () => {
  let calls = 0;
  const q = createQueue(async () => { calls++; return {ok:true,source:'pt',translated:'Hello'}; }, 0);
  await assert.rejects(q.run('Olá', () => false), /cancelled/);
  assert.equal(calls, 0); q.stop();
  await assert.rejects(q.run('Outro'), /stopped/);
});
