import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import fengari from 'fengari';
const {lua,lauxlib,lualib,to_luastring,to_jsstring}=fengari;
const source=readFileSync(new URL('../backend/main.lua',import.meta.url),'utf8');
test('Lua batch backend validates, encodes UTF-8, maps results, caches and backs off',()=>{
  const state=lauxlib.luaL_newstate();lualib.luaL_openlibs(state);
  const run=code=>{const status=lauxlib.luaL_dostring(state,to_luastring(code));assert.equal(status,lua.LUA_OK,status===lua.LUA_OK?'':to_jsstring(lua.lua_tostring(state,-1)));};
  run(`
    calls=0;status=200;now=1000;os.time=function()return now end
    input_texts={'Olá & amigo?','Bonjour mon ami'}
    response_data={{'Hello friend','pt'},{'Hello my friend','fr'}}
    package.preload['millennium']=function()return {ready=function()ready=true end}end
    package.preload['fs']=function()return {join=function(a,b)return a..'/'..b end,parent_path=function(v)return '/plugin' end}end
    package.preload['utils']=function()return {get_backend_path=function()return '/plugin/backend' end,read_file=function()return nil end,write_file=function(path,value)saved_settings=value;return true end}end
    package.preload['http']=function()return {get=function(url,options)
      calls=calls+1;last_url=url
      assert(options.verify_ssl==true and options.follow_redirects==false and options.timeout==12)
      return {status=status,body='response'}
    end}end
    package.preload['json']=function()return {encode=function(v)return v end,decode=function(v)
      if broken then error('bad json') end
      if v=='response' then return response_data end
      return input_texts
    end}end
    plugin=(function() ${source} end)()
    plugin.on_load();assert(ready)
    assert(GetSettings().provider=='google' and not GetSettings().hasKey)
    assert(not TranslateBatch(42).ok)
    input_texts={};assert(not TranslateBatch('input').ok)
    input_texts={string.rep('a',4001)};assert(not TranslateBatch('input').ok)
    input_texts={string.rep('a',4000),string.rep('b',3000)};assert(not TranslateBatch('input').ok)
    assert(calls==0)
    input_texts={'Olá & amigo?','Bonjour mon ami'}
    local r=TranslateBatch('input')
    assert(r.ok and r.results[1].source=='pt' and r.results[2].source=='fr')
    assert(last_url:find('Ol%%C3%%A1%%20%%26%%20amigo%%3F') and last_url:find('&q=Bonjour'))
    assert(TranslateBatch('input').ok and calls==1)
    now=now+5
    input_texts={'Bonjour mon ami','Outro'};response_data={{'Other','pt'}}
    r=TranslateBatch('input');assert(r.ok and r.results[1].source=='fr' and r.results[2].translated=='Other')
    now=now+5;input_texts={'Falhou'};status=429;r=TranslateBatch('input');assert(not r.ok and r.retryAfter==60)
    local previous=calls;assert(not TranslateBatch('input').ok and calls==previous)
    now=now+61;status=500;assert(not TranslateBatch('input').ok)
    status=200;response_data={};assert(not TranslateBatch('input').ok)
    response_data={{'Hello'}};assert(not TranslateBatch('input').ok)
    broken=true;assert(not TranslateBatch('input').ok)
    broken=false
    assert(not SaveSettings('bad','').ok)
    assert(not SaveSettings('deepl','bad key').ok)
    assert(SaveSettings('deepl','example-test-key:fx').ok)
    assert(GetSettings().provider=='deepl' and GetSettings().hasKey and GetSettings().api_key==nil)
    local h=require('http')
    h.post=function(url,payload,options)
      assert(url=='https://api-free.deepl.com/v2/translate')
      assert(options.headers.Authorization=='DeepL-Auth-Key example-test-key:fx')
      assert(payload.text[1]=='Falhou' and payload.target_lang=='EN')
      return {status=200,body='response'}
    end
    response_data={translations={{text='Failed',detected_source_language='PT'}}}
    r=TranslateBatch('input');assert(r.ok and r.results[1].translated=='Failed' and r.results[1].source=='pt')
    plugin.on_unload()
  `);
  lua.lua_close(state);
});
