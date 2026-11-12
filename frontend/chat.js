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
export function createQueue(translate, gap = 350) {
  const cache = new Map(), pending = new Map();
  let tail = Promise.resolve(), stopped = false;
  return {
    run(text, stillWanted = () => true) {
      if (stopped) return Promise.reject(new Error('Translator stopped.'));
      if (cache.has(text)) return Promise.resolve(cache.get(text));
      if (pending.has(text)) return pending.get(text);
      if (pending.size >= 80) return Promise.reject(new Error('Translation queue is full. Retry in a moment.'));
      const task = tail.then(async () => {
        if (stopped || !stillWanted()) throw new Error('Translation cancelled.');
        let timer;
        let response;
        try {
          response = await Promise.race([
            translate(text),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Translation timed out. Try restarting Steam.')), 18000); })
          ]);
        } finally { clearTimeout(timer); }
        const value = typeof response === 'string' ? JSON.parse(response) : response;
        if (!value?.ok || typeof value.translated !== 'string' || typeof value.source !== 'string') {
          throw new Error(value?.error || 'Translation failed.');
        }
        cache.set(text, value);
        if (cache.size > 256) cache.delete(cache.keys().next().value);
        return value;
      });
      // Swallow only the queue-chain error. Callers still receive task rejection.
      tail = task.catch(() => {}).then(() => new Promise(r => setTimeout(r, gap)));
      pending.set(text, task);
      task.finally(() => pending.delete(text)).catch(() => {});
      return task;
    },
    stop() { stopped = true; cache.clear(); }
  };
}

export function mountChatDocument(doc, queue, settings) {
  const win = doc.defaultView;
  const states = new Map();
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
    for (const [node, state] of states) clear(node, state);
    states.clear();
  }
  function makeButton(label, action) {
    const b = doc.createElement('button');
    b.type = 'button'; b.textContent = label;
    b.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); action(); });
    return b;
  }
  function ensureBars() {
    for (const [root, bar] of bars) {
      if (!root.isConnected || !bar.isConnected) { bar.remove(); bars.delete(root); }
    }
    for (const root of doc.querySelectorAll('.chatWindow')) {
      if (bars.has(root)) continue;
      const bar = doc.createElement('div'); bar.className = 'sct-controls';
      const label = doc.createElement('span'); label.textContent = 'Translate to English';
      const toggle = makeButton('', () => settings.setEnabled(!settings.enabled));
      toggle.dataset.sctToggle = 'true';
      toggle.title = 'Uses Google Translate. Visible incoming message text is sent to Google; Steam account details are not included.';
      bar.append(label, toggle);
      root.prepend(bar); bars.set(root, bar);
    }
    for (const bar of bars.values()) {
      const toggle = bar.querySelector('button');
      const label = settings.enabled ? 'On · Google' : 'Off';
      if (toggle.textContent !== label) toggle.textContent = label;
      toggle.setAttribute('aria-pressed', String(settings.enabled));
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
    if (!settings.enabled) return;
    // Use Valve's semantic classes, verified against Steam's sp.js. Never scan
    // input fields, names, notification previews, Steam store or profile pages.
    const nodes = [...doc.querySelectorAll('.chatWindow .msg:not(.isCurrentUser) .msgText')].slice(-80);
    for (const node of nodes) {
      if (states.has(node) || node.classList.contains('MsgNoUserContent')) continue;
      if (node.closest('.isCurrentUser') || node.querySelector('[class*="poiler"], [class*="Embed"], video, audio')) continue;
      // Hidden inactive chats should not leak old history to a translation API.
      if (node.getClientRects().length === 0) continue;
      const text = node.textContent.trim();
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
      const label = doc.createElement('span'); label.textContent = 'Translation unavailable';
      label.title = error instanceof Error ? error.message : 'Translation failed.';
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
