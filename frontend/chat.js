export const STYLE = `
.sct-card { margin: 3px 0 6px; line-height: 1.45; color: #e4e9ef; }
.sct-heading { display:flex; align-items:center; flex-wrap:wrap; gap:6px; font-size:11px; color:#9aaabb; margin-bottom:3px; }
.sct-heading button, .sct-controls button { background:none; color:#8bc9ff; border:0; padding:2px 4px; cursor:pointer; font:inherit; text-decoration:underline; }
.sct-heading button:focus-visible, .sct-controls button:focus-visible { outline:2px solid #8bc9ff; outline-offset:2px; }
.sct-body { white-space:pre-wrap; overflow-wrap:anywhere; user-select:text; }
.sct-controls { display:flex; align-items:center; gap:8px; font:11px/1.4 sans-serif; color:#abb9c9; background:#202a35; padding:4px 10px; flex-shrink:0; }
.sct-controls button { text-decoration:none; border:1px solid #566e83; border-radius:4px; }
.sct-error { color:#b5a892; }
.sct-original-hidden { display:none !important; }
`;

export function eligibleText(text) {
  const clean = text.trim();
  return clean.length >= 2 && new TextEncoder().encode(clean).length <= 4000
    && /\p{L}/u.test(clean) && !/^(?:https?:\/\/|steam:\/\/|www\.)\S+$/i.test(clean);
}

export function languageName(code) {
  try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) || code; }
  catch { return code; }
}

// All windows share one queue and memory cache. No network request is made here;
// the fixed-host Lua backend avoids Steam's page CSP/CORS restrictions.
export function createQueue(translate, gap = 5000, batchWait = 200, onStatus = () => {}) {
  const cache = new Map(), pending = new Map(), stack = [];
  let stopped = false, busy = false, timer, nextAllowed = 0, sequence = 0;
  function schedule() {
    if (stopped || busy || timer || !stack.length) return;
    timer = setTimeout(() => {timer = undefined; void pump();}, Math.max(batchWait, nextAllowed-Date.now()));
  }
  async function pump() {
    if (stopped || busy) return;
    const batch = [];
    stack.sort((a,b)=>a.sequence-b.sequence);
    let bytes = 0;
    while (stack.length && batch.length < 8) {
      const entry = stack.pop();
      if (!entry.wanted.some(fn => fn())) {
        pending.delete(entry.text); entry.reject(new Error('Translation cancelled.')); continue;
      }
      const length = new TextEncoder().encode(entry.text).length;
      if (batch.length && bytes+length>6000) {stack.push(entry); break;}
      bytes+=length; batch.push(entry);
    }
    if (!batch.length) {schedule(); return;}
    busy = true;
    onStatus('Translating…');
    let timeout;
    try {
      const raw = await Promise.race([
        translate(batch.map(entry=>entry.text)),
        new Promise((_,reject) => {timeout=setTimeout(()=>reject(new Error('Translation timed out. Try restarting Steam.')),18000);})
      ]);
      const response = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!response?.ok || !Array.isArray(response.results) || response.results.length!==batch.length) {
        if (response?.retryAfter && Number.isFinite(Number(response.retryAfter)) && batch.every(entry=>(entry.retries||0)<3)) {
          const delay=Math.max(0.01,Math.min(600,Number(response.retryAfter)));
          nextAllowed=Date.now()+delay*1000;
          // Put older work below newer entries. A new message arriving during
          // cooldown remains the highest priority when the next batch starts.
          for(const entry of batch){entry.retries=(entry.retries||0)+1;stack.push(entry);}
          batch.length=0;
          onStatus(`Rate limited · retrying after ${Math.ceil(delay)}s`);
          return;
        }
        throw new Error(response?.error || 'Translation failed.');
      }
      if(response.results.some(value=>typeof value?.translated!=='string'||typeof value?.source!=='string'))throw new Error('Unexpected translation response.');
      for (let i=0;i<batch.length;i++) {
        const entry=batch[i], value=response.results[i];
        if (stopped) continue;
        cache.set(entry.text,value);
        if(cache.size>256)cache.delete(cache.keys().next().value);
        entry.resolve(value);
      }
      onStatus('');
    } catch(error) {onStatus(error instanceof Error?error.message:'Translation unavailable');for(const entry of batch)entry.reject(error);}
    finally {
      clearTimeout(timeout);
      for(const entry of batch)pending.delete(entry.text);
      busy=false; nextAllowed=Math.max(nextAllowed,Date.now()+gap); schedule();
    }
  }
  return {
    run(text, stillWanted = () => true) {
      if(stopped)return Promise.reject(new Error('Translator stopped.'));
      if(cache.has(text))return Promise.resolve(cache.get(text));
      if(pending.has(text)) {const entry=pending.get(text); entry.wanted.push(stillWanted); return entry.promise;}
      if(pending.size>=80)return Promise.reject(new Error('Translation queue is full. Retry in a moment.'));
      const entry={text,wanted:[stillWanted],sequence:++sequence};
      entry.promise=new Promise((resolve,reject)=>{entry.resolve=resolve;entry.reject=reject;});
      pending.set(text,entry); stack.push(entry); schedule(); return entry.promise;
    },
    stop() {
      stopped=true; clearTimeout(timer);cache.clear();stack.length=0;
      for(const entry of pending.values())entry.reject(new Error('Translator stopped.'));
      pending.clear();
    }
  };
}

export function mountChatDocument(doc, queue, settings) {
  const win = doc.defaultView;
  const states = new Map();
  let requested = new WeakMap();
  const bars = new Map();
  let disposed = false, scheduled = false, revision = 0;
  const style = doc.createElement('style');
  style.dataset.sct = 'styles'; style.textContent = STYLE;
  (doc.head || doc.documentElement).append(style);

  function clear(node, state) {
    node.classList.remove('sct-original-hidden');
    state.card?.remove();
  }
  function reset() {
    revision++;
    requested = new WeakMap();
    for (const [node, state] of states) clear(node, state);
    states.clear();
  }
  function makeButton(label, action) {
    const b = doc.createElement('button');
    b.type = 'button'; b.textContent = label;
    b.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); action(); });
    return b;
  }
  function visibleMessage(node) {
    if(node.getClientRects().length===0)return false;
    const rect=node.getBoundingClientRect();
    if(rect.bottom<=0||rect.top>=win.innerHeight)return false;
    const scroller=node.closest('.chatHistoryScroll');
    if(scroller){const bounds=scroller.getBoundingClientRect();if(rect.bottom<=bounds.top||rect.top>=bounds.bottom)return false;}
    return true;
  }
  function ensureBars() {
    for (const [root, bar] of bars) {
      if (!root.isConnected || !bar.isConnected) { bar.remove(); bars.delete(root); }
    }
    for (const root of doc.querySelectorAll('.chatWindow')) {
      if (bars.has(root)) continue;
      const bar = doc.createElement('div'); bar.className = 'sct-controls';
      const label = doc.createElement('span'); label.textContent = 'Translate to English';
      const toggle = makeButton('Translate', () => {
        if(settings.ready===false){settings.openSettings?.();return;}
        if(!settings.enabled)settings.setEnabled(true);
        // Snapshot only this chat's messages at click time. Newly arriving or
        // recycled message nodes are never submitted without another click.
        for(const node of root.querySelectorAll('.msg:not(.isCurrentUser) .msgText')) {
          const state=states.get(node);
          if(state?.card?.classList.contains('sct-error')){clear(node,state);states.delete(node);}
          if(!visibleMessage(node))continue;
          requested.set(node,node.textContent.trim());
        }
        scan();
      });
      toggle.dataset.sctTranslate = 'true';
      toggle.title = 'Translate the visible incoming messages in this chat. New messages wait until you click again.';
      bar.append(label, toggle);
      if(settings.openSettings)bar.append(makeButton('Settings',()=>settings.openSettings()));
      const status=doc.createElement('span');status.dataset.sctStatus='true';bar.append(status);
      root.prepend(bar); bars.set(root, bar);
    }
    for (const bar of bars.values()) {
      const toggle = bar.querySelector('button');
      toggle.setAttribute('aria-label','Translate visible messages to English');
      const status=bar.querySelector('[data-sct-status]');
      const statusText=settings.ready===false?'Add an API key in Settings':(settings.status||'');
      if(status.textContent!==statusText)status.textContent=statusText;
    }
  }
  function scan() {
    if (disposed) return;
    ensureBars();
    for (const [node, state] of states) {
      if (!node.isConnected || node.textContent.trim() !== state.text || (state.card && !state.card.isConnected)) {
        clear(node, state); states.delete(node);
      }
    }
    if (!settings.enabled || settings.ready===false) return;
    // Use Valve's semantic classes, verified against Steam's sp.js. Never scan
    // input fields, names, notification previews, Steam store or profile pages.
    const nodes = [...doc.querySelectorAll('.chatWindow .msg:not(.isCurrentUser) .msgText')].slice(-80);
    for (const node of nodes) {
      if (states.has(node) || node.classList.contains('MsgNoUserContent')) continue;
      if (node.closest('.isCurrentUser') || node.querySelector('[class*="poiler"], [class*="Embed"], video, audio')) continue;
      // Hidden inactive chats should not leak old history to a translation API.
      if(!visibleMessage(node))continue;
      const text = node.textContent.trim();
      if(requested.get(node)!==text)continue;
      if (!eligibleText(text)) continue;
      const state = { text, card: null };
      states.set(node, state);
      void translateNode(node, state, revision);
    }
  }
  function isCurrent(node, state, generation) {
    return !disposed && settings.enabled && generation === revision && node.isConnected
      && states.get(node) === state && node.textContent.trim() === state.text;
  }
  async function translateNode(node, state, generation) {
    try {
      const value = await queue.run(state.text, () => isCurrent(node, state, generation));
      if (!isCurrent(node, state, generation)) return;
      if (value.source.toLowerCase().split('-')[0] === 'en' || value.translated.trim() === state.text) return;
      const card = doc.createElement('div'); card.className = 'sct-card';
      const heading = doc.createElement('div'); heading.className = 'sct-heading';
      const label = doc.createElement('span'); label.textContent = `Translated from ${languageName(value.source)}`;
      const body = doc.createElement('div'); body.className = 'sct-body';
      body.textContent = value.translated;
      let original = false;
      const toggle = makeButton('Show original', () => {
        original = !original;
        node.classList.toggle('sct-original-hidden', !original);
        body.hidden = original;
        toggle.textContent = original ? 'Show translation' : 'Show original';
        toggle.setAttribute('aria-expanded', String(original));
      });
      toggle.setAttribute('aria-expanded', 'false');
      heading.append(label, toggle); card.append(heading, body);
      node.before(card); node.classList.add('sct-original-hidden'); state.card = card;
    } catch (error) {
      if (!isCurrent(node, state, generation)) return;
      const card = doc.createElement('div'); card.className = 'sct-card sct-heading sct-error';
      const label = doc.createElement('span');
      const reason = error instanceof Error ? error.message : 'Translation failed.';
      label.textContent = `Translation unavailable · ${reason.slice(0,180)}`;
      label.title = reason;
      card.append(label, makeButton('Retry', () => {
        clear(node, state); states.delete(node); schedule();
      }));
      node.before(card); state.card = card;
    }
  }
  function schedule() {
    if (scheduled || disposed) return;
    scheduled = true;
    win.setTimeout(() => { scheduled = false; scan(); }, 120);
  }
  const observer = new win.MutationObserver(schedule);
  observer.observe(doc.documentElement, {childList:true, subtree:true, characterData:true, attributes:true, attributeFilter:['class','style']});
  const unsubscribe = settings.subscribe(() => { reset(); schedule(); });
  scan();
  return {
    scan,
    dispose() {
      if (disposed) return;
      disposed = true; observer.disconnect(); unsubscribe(); reset();
      for (const bar of bars.values()) bar.remove();
      bars.clear(); style.remove();
    }
  };
}
