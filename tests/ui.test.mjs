import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { chromium } from '@playwright/test';

const source = readFileSync(new URL('../frontend/chat.js', import.meta.url), 'utf8');
const executablePath = process.env.CHROME_PATH || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined);
const launch = () => chromium.launch({headless:true, ...(executablePath && existsSync(executablePath) ? {executablePath} : {})});
const fixture = `<html><head><style>body{background:#171d25;color:#ddd;font:15px Arial}.chatWindow{width:520px}.msg{padding:8px}.msgText{padding:4px}textarea{width:90%;height:50px}</style></head><body>
<div class="chatWindow"><h3>Chat · test fixture</h3><div class="chatHistoryScroll">
<div class="msg"><div id="pt" class="msgText">Olá, queres jogar outra partida?</div></div>
<div class="msg isCurrentUser"><div id="own" class="msgText">Eu escrevi isto</div></div>
<div class="msg"><div id="en" class="msgText">Hello mate</div></div>
<div class="msg"><div class="msgText MsgNoUserContent">Game invite</div></div>
<div class="msg"><div class="msgText"><span class="Spoiler">Segredo</span></div></div>
<div class="msg"><div class="msgText">https://example.com</div></div>
</div><textarea>Unsent draft</textarea></div>
<div class="chatWindow" style="display:none"><div class="msg"><div class="msgText">Hidden history</div></div></div>
</body></html>`;

async function setup(page, fail = false, delay = 0) {
  await page.setContent(fixture);
  await page.evaluate(async ({source, fail, delay}) => {
    const module = await import('data:text/javascript;base64,' + btoa(unescape(encodeURIComponent(source))));
    window.calls = [];
    const listeners = new Set();
    window.settings = {
      enabled:true,
      setEnabled(v) { this.enabled=v; for (const fn of listeners) fn(); },
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
    };
    window.fail = fail;
    window.q = module.createQueue(async text => {
      window.calls.push(text);
      if (delay) await new Promise(r => setTimeout(r, delay));
      if (window.fail) return {ok:false,error:'Provider unavailable'};
      return {ok:true,source:text === 'Hello mate' ? 'en' : 'pt',translated: text === 'Hello mate' ? text : 'Hello, do you want to play another match?'};
    }, 0);
    window.mount = module.mountChatDocument(document, window.q, window.settings);
  }, {source,fail,delay});
}

test('translates incoming messages, toggles intact original, handles dynamic nodes and cleanup', async () => {
  const browser = await launch();
  try {
    const page = await browser.newPage(); await setup(page);
    await page.getByText('Translated from Portuguese').waitFor();
    assert.equal(await page.locator('#pt').isVisible(), false);
    assert.equal(await page.locator('.sct-body').innerText(), 'Hello, do you want to play another match?');
    await page.getByRole('button',{name:'Show original',exact:true}).click();
    assert.equal(await page.locator('#pt').innerText(), 'Olá, queres jogar outra partida?');
    assert.equal(await page.locator('.sct-body').isVisible(), false);
    await page.getByRole('button',{name:'Show translation',exact:true}).click();
    assert.equal(await page.locator('#pt').isVisible(), false);
    await page.waitForFunction(() => window.calls.length === 2);
    assert.deepEqual(await page.evaluate(() => window.calls), ['Olá, queres jogar outra partida?', 'Hello mate']);
    assert.equal(await page.locator('#own').isVisible(), true);
    assert.equal(await page.locator('#en').isVisible(), true);
    assert.equal(await page.locator('textarea').inputValue(), 'Unsent draft');
    await page.evaluate(() => {
      const row = document.createElement('div');row.className='msg';
      row.innerHTML='<div id="new" class="msgText">Boa noite</div>';
      document.querySelector('.chatHistoryScroll').append(row);
    });
    await page.waitForFunction(() => document.querySelectorAll('.sct-body').length === 2);
    // Recycled message elements must not retain a stale translation.
    await page.locator('#new').evaluate(node => { node.textContent = 'Bom dia'; });
    await page.waitForFunction(() => window.calls.includes('Bom dia'));
    await page.waitForFunction(() => document.querySelectorAll('.sct-body').length === 2);
    if (process.env.SCT_SCREENSHOT) await page.screenshot({path:process.env.SCT_SCREENSHOT});
    await page.getByRole('button',{name:'On · Google',exact:true}).first().click();
    await page.waitForFunction(() => document.querySelectorAll('.sct-card').length === 0);
    assert.equal(await page.locator('#pt').isVisible(), true);
    await page.evaluate(() => {window.mount.dispose();window.q.stop();});
    assert.equal(await page.locator('.sct-controls, .sct-card, .sct-original-hidden, style[data-sct]').count(),0);
  } finally { await browser.close(); }
});

test('provider failures preserve original and offer a working retry', async () => {
  const browser = await launch();
  try {
    const page=await browser.newPage(); await setup(page,true);
    await page.getByRole('button',{name:'Retry',exact:true}).first().waitFor();
    assert.equal(await page.locator('#pt').isVisible(),true);
    await page.evaluate(() => {window.fail=false;});
    await page.getByRole('button',{name:'Retry',exact:true}).first().click();
    await page.getByText('Translated from Portuguese').waitFor();
    assert.equal(await page.locator('#pt').isVisible(),false);
  } finally {await browser.close();}
});

test('pausing while a request is running prevents the delayed translation from appearing', async () => {
  const browser=await launch();
  try {
    const page=await browser.newPage();await setup(page,false,150);
    await page.evaluate(() => window.settings.setEnabled(false));
    await page.waitForTimeout(300);
    assert.equal(await page.locator('.sct-card').count(),0);
    assert.equal(await page.locator('#pt').isVisible(),true);
    assert.equal(await page.evaluate(() => window.calls.length),1);
  } finally {await browser.close();}
});
