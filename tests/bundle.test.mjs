import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {chromium} from '@playwright/test';

test('compiled Millennium entry registers chat hook and calls correctly namespaced Lua IPC',async () => {
  const executablePath=process.env.CHROME_PATH || (process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':undefined);
  const browser=await chromium.launch({headless:true,...(executablePath&&existsSync(executablePath)?{executablePath}:{})});
  try {
    const page=await browser.newPage();
    await page.setContent('<div class="chatWindow"><div class="msg"><div class="msgText">Olá amigo</div></div></div>');
    await page.evaluate(() => {
      window.ipc=[];
      window.SP_JSX_FACTORY={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
      window.MILLENNIUM_BACKEND_IPC={postMessage:()=>{}};
      window.MILLENNIUM_API={definePlugin:fn=>fn,Millennium:{
        AddWindowCreateHook:fn=>{window.chatHook=fn;},
        callServerMethod:async (plugin,method,args)=>{
          window.ipc.push({plugin,method,args});
          return JSON.stringify({ok:true,source:'pt',translated:'Hello friend'});
        }
      }};
    });
    await page.addScriptTag({content:readFileSync(new URL('../.millennium/Dist/index.js',import.meta.url),'utf8')});
    await page.waitForFunction(()=>typeof window.chatHook==='function');
    await page.evaluate(()=>window.chatHook({m_strName:'chat_friend_uid0',window}));
    await page.getByText('Hello friend',{exact:true}).waitFor();
    assert.deepEqual(await page.evaluate(()=>window.ipc),[{plugin:'steam-chat-translator',method:'Translate',args:{text:'Olá amigo'}}]);
    await page.evaluate(()=>window.MILLENNIUM_SIDEBAR_NAVIGATION_PANELS['steam-chat-translator'].onDismount());
    assert.equal(await page.locator('.sct-card,.sct-controls,.sct-original-hidden').count(),0);
  } finally {await browser.close();}
});
