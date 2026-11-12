import { Millennium, definePlugin } from '@steambrew/client';
import { useEffect, useState } from 'react';
import { createQueue, mountChatDocument } from './chat.js';

interface PopupContext { window?: Window; m_strName?: string }

export default definePlugin(() => {
  let alive = true;
  const listeners = new Set<() => void>();
  const emit = () => {for(const listener of listeners)listener();};
  const settings = {
    enabled: false,
    ready: false,
    provider: 'google',
    status: '',
    openSettings() {
      (Millennium as typeof Millennium & {openQuickAccess?:(options:object)=>void}).openQuickAccess?.({plugin:'steam-chat-translator'});
    },
    setEnabled(value: boolean) {
      settings.enabled = value;
      emit();
    },
    subscribe(listener: () => void) { listeners.add(listener); return () => {listeners.delete(listener);}; }
  };
  const queue = createQueue((texts: string[]) => Millennium.callServerMethod('TranslateBatch', { texts_json: JSON.stringify(texts) }),5000,200,status=>{settings.status=status;});
  function applySettings(data: {provider:string;hasKey:boolean}) {
    settings.provider=data.provider;
    settings.ready=data.provider==='google'||data.hasKey;
    settings.status='';emit();
  }
  const parseReply=(raw:unknown)=>typeof raw==='string'?JSON.parse(raw):raw;
  void Millennium.callServerMethod('GetSettings').then(raw=>{
    if(alive)applySettings(parseReply(raw));
  }).catch(()=>{settings.status='Could not load translation settings.';});

  function SettingsPanel() {
    const [provider,setProvider]=useState(settings.provider);
    const [key,setKey]=useState('');
    const [message,setMessage]=useState('');
    const [saving,setSaving]=useState(false);
    useEffect(()=>settings.subscribe(()=>setProvider(settings.provider)),[]);
    async function save() {
      setSaving(true);setMessage('Saving…');
      try {
        const result=parseReply(await Millennium.callServerMethod('SaveSettings',{provider,api_key:key}));
        if(!result?.ok)throw new Error(result?.error||'Could not save settings.');
        setKey('');applySettings(result);setMessage(settings.ready?'Saved. Translation is ready.':'Saved. Add a DeepL API key to enable translation.');
      } catch {setMessage('Could not save settings. Check your provider and API key.');}
      finally {setSaving(false);}
    }
    return <div style={{padding:20,lineHeight:1.6,maxWidth:600}}>
      <h2>Steam Chat Translator</h2>
      <p>Translation is off by default. Press Translate at the top of a chat to translate its currently visible messages. New messages wait for another click.</p>
      <p>Newest messages first. Up to 8 messages per batch, with at least 5 seconds between requests. Rate limits trigger automatic backoff.</p>
      <label>Translation provider<br/><select value={provider} onChange={e=>setProvider(e.target.value)}>
        <option value="deepl">DeepL API (recommended)</option><option value="google">Google public endpoint (no key, may be rate limited)</option>
      </select></label>
      {provider==='deepl'&&<p><label>DeepL API key<br/><input type="password" autoComplete="off" spellCheck={false} value={key}
        placeholder="Paste a new key; leave blank to keep the saved key" onChange={e=>setKey(e.target.value)} style={{width:'100%',boxSizing:'border-box'}}/></label>
        <small>The key is saved locally in the plugin's private-settings.json. It is never returned to the UI or logged.</small></p>}
      <p><button type="button" disabled={saving} onClick={()=>void save()}>Save settings</button></p>
      <p role="status">{message}</p>
      <p>Get a key at <a href="https://www.deepl.com/pro-api" target="_blank" rel="noreferrer">DeepL API</a>, then open your account's <a href="https://www.deepl.com/your-account/keys" target="_blank" rel="noreferrer">API keys</a>.</p>
      <p>Incoming message text is sent to the selected provider for detection and translation, including English text. Your own messages and drafts are skipped. Use Show original on any translation.</p>
    </div>;
  }
  const monitors = new Map<Window, { document?: Document; mount?: ReturnType<typeof mountChatDocument> }>();

  function attach(context: PopupContext) {
    if (!alive || !context.window || monitors.has(context.window)) return;
    // Restrict to Steam's Friends and Chat popups, including overlay variants.
    // No community/store browser popups are registered.
    const name = context.m_strName || '';
    if (!/friendslist|chat|^Steam$/i.test(name)) return;
    monitors.set(context.window, {});
    reconcile();
  }
  function reconcile() {
    if (!alive) return;
    for (const [popup, record] of monitors) {
      try {
        if (popup.closed) { record.mount?.dispose(); monitors.delete(popup); continue; }
        const doc = popup.document;
        if (record.document !== doc) {
          record.mount?.dispose(); record.document = doc; record.mount = undefined;
        }
        if (!record.mount && doc.documentElement && doc.querySelector('.chatWindow')) {
          record.mount = mountChatDocument(doc, queue, settings);
        }
        record.mount?.scan();
      } catch { record.mount?.dispose(); monitors.delete(popup); }
    }
  }
  Millennium.AddWindowCreateHook?.(context => attach(context as PopupContext));
  const interval = window.setInterval(reconcile, 1000);
  return {
    title: 'Steam Chat Translator',
    icon: <span aria-hidden="true">EN</span>,
    content: <SettingsPanel/>,
    onDismount() {
      alive = false; clearInterval(interval); queue.stop();
      for (const record of monitors.values()) record.mount?.dispose();
      monitors.clear(); listeners.clear();
    }
  };
});
