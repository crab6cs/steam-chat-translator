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
  const q = createQueue(async texts => {
    calls++; active++; maxActive = Math.max(maxActive, active);
    await new Promise(r => setTimeout(r, 10)); active--;
    return JSON.stringify({ok:true,results:texts.map(text=>({translated:`English ${text}`,source:'pt'}))});
  }, 0);
  await Promise.all([q.run('um'), q.run('um'), q.run('dois')]);
  await q.run('um');
  assert.equal(calls, 1); assert.equal(maxActive, 1); q.stop();
});

test('a failed translation can be retried and does not poison later requests', async () => {
  let calls = 0;
  const q = createQueue(async () => ++calls === 1 ? {ok:false,error:'Rate limited'} : {ok:true,results:[{source:'pt',translated:'Hello'}]}, 0);
  await assert.rejects(q.run('Olá'), /Rate limited/);
  assert.equal((await q.run('Olá')).translated, 'Hello'); q.stop();
});

test('queued work is cancelled when the chat closes or translation is paused', async () => {
  let calls = 0;
  const q = createQueue(async () => { calls++; return {ok:true,results:[{source:'pt',translated:'Hello'}]}; }, 0);
  await assert.rejects(q.run('Olá', () => false), /cancelled/);
  assert.equal(calls, 0); q.stop();
  await assert.rejects(q.run('Outro'), /stopped/);
});

test('batches at most eight messages, newest first, including messages queued during a request', async () => {
  const batches=[];let release;
  const q=createQueue(async texts=>{
    batches.push(texts);
    if(batches.length===1)await new Promise(r=>{release=r;});
    return {ok:true,results:texts.map(text=>({source:'pt',translated:`en:${text}`}))};
  },0,1);
  const tasks=Array.from({length:10},(_,i)=>q.run(`msg${i}`));
  while(!release)await new Promise(r=>setTimeout(r,2));
  const latest=q.run('newest');release();
  await Promise.all([...tasks,latest]);
  assert.deepEqual(batches,[['msg9','msg8','msg7','msg6','msg5','msg4','msg3','msg2'],['newest','msg1','msg0']]);
  q.stop();
});

test('batch byte limits do not split messages or mix up the results',async()=>{
  const batches=[];
  const q=createQueue(async texts=>{batches.push(texts);return {ok:true,results:texts.map(text=>({source:'pt',translated:text.length.toString()}))};},0,1);
  const results=await Promise.all([q.run('a'.repeat(4000)),q.run('b'.repeat(3000)),q.run('c'.repeat(2500))]);
  assert.deepEqual(batches.map(b=>b.map(t=>t.length)),[[2500,3000],[4000]]);
  assert.deepEqual(results.map(r=>r.translated),['4000','3000','2500']);q.stop();
});

test('429 backoff requeues work without error spam, keeping newer arrivals first',async()=>{
  const batches=[];const status=[];
  const q=createQueue(async texts=>{
    batches.push(texts);
    if(batches.length===1)return {ok:false,retryAfter:0.04,error:'Rate limited'};
    return {ok:true,results:texts.map(t=>({source:'pt',translated:t}))};
  },0,1,s=>status.push(s));
  const older=q.run('older');
  while(!batches.length)await new Promise(r=>setTimeout(r,1));
  const newer=q.run('newer');
  await Promise.all([older,newer]);
  assert.deepEqual(batches,[['older'],['newer','older']]);
  assert.ok(status.some(s=>s.startsWith('Rate limited')));q.stop();
});
