import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import fengari from 'fengari';
const {lua,lauxlib,lualib,to_luastring,to_jsstring} = fengari;
const source=readFileSync(new URL('../backend/main.lua',import.meta.url),'utf8');

test('Lua backend validates, encodes UTF-8, concatenates segments, caches and handles provider errors', () => {
  const state=lauxlib.luaL_newstate();lualib.luaL_openlibs(state);
  const run=code => {
    const status=lauxlib.luaL_dostring(state,to_luastring(code));
    assert.equal(status,lua.LUA_OK,status === lua.LUA_OK ? '' : to_jsstring(lua.lua_tostring(state,-1)));
  };
  run(`
    calls=0; status=200; now=1000; os.time=function() return now end
    response_data={{{'Hello, ', 'Olá, '},{'friend!', 'amigo!'}},false,'pt'}
    package.preload['millennium']=function() return {ready=function() ready=true end} end
    package.preload['http']=function() return {get=function(url,options)
      calls=calls+1; last_url=url
      assert(options.verify_ssl==true and options.follow_redirects==false and options.timeout==12)
      return {status=status,body='response'}
    end} end
    package.preload['json']=function() return {encode=function(v) return v end,decode=function(v)
      if broken then error('bad json') end
      return response_data
    end} end
    plugin=(function() ${source} end)()
    plugin.on_load(); assert(ready)
    assert(not Translate('').ok); assert(not Translate(42).ok); assert(not Translate(string.rep('a',4001)).ok)
    assert(calls==0)
    local r=Translate('Olá & amigo?')
    assert(r.ok and r.source=='pt' and r.translated=='Hello, friend!')
    assert(last_url:find('Ol%%C3%%A1%%20%%26%%20amigo%%3F'))
    assert(Translate('Olá & amigo?').ok and calls==1)
    status=429; assert(not Translate('outro').ok); assert(calls==2)
    assert(not Translate('mais').ok and calls==2)
    now=1061; status=500; assert(not Translate('falhou').ok)
    status=200; broken=true; assert(not Translate('inválido').ok)
    broken=false; response_data={}; assert(not Translate('vazio').ok)
    response_data={{{'Hello'}},false,'en'}; assert(Translate('Hi').source=='en')
    plugin.on_unload()
  `);
  lua.lua_close(state);
});
