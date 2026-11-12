import { Millennium, definePlugin } from '@steambrew/client';
import { createQueue, mountChatDocument } from './chat.js';

interface PopupContext { window?: Window; m_strName?: string }

export default definePlugin(() => {
  let alive = true;
  const listeners = new Set<() => void>();
  const settings = {
    enabled: true,
    setEnabled(value: boolean) {
      settings.enabled = value;
      try { localStorage.setItem('steam-chat-translator.enabled', String(value)); } catch { /* memory-only fallback */ }
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); }
  };
  try { settings.enabled = localStorage.getItem('steam-chat-translator.enabled') !== 'false'; } catch { /* default on */ }
  const queue = createQueue((text: string) => Millennium.callServerMethod('Translate', { text }));
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
    content: <div style={{padding:20, lineHeight:1.6}}>
      <h2>Steam Chat Translator</h2>
      <p>Open a chat to find the <b>Translate to English</b> switch at the top.</p>
      <p>Incoming messages are automatically translated. Use <b>Show original</b> on any translation.</p>
      <p>Uses Google Translate: visible incoming text is sent to Google, including English text for language detection.
        No API key is needed. Your own messages, drafts and attachments are skipped.</p>
      <p>Restart Steam after enabling this plugin so existing chat windows are registered.</p>
    </div>,
    onDismount() {
      alive = false; clearInterval(interval); queue.stop();
      for (const record of monitors.values()) record.mount?.dispose();
      monitors.clear(); listeners.clear();
    }
  };
});
