# Steam Chat Translator

A Millennium plugin that automatically translates incoming **Steam Friends & Chat** messages into English.

```text
Translated from Portuguese · Show original
Hi, do you want to play another game?
```

Works alongside Extendium and Steam profile extensions. This is a **native Millennium plugin**, not a Chrome extension: install it in Millennium's plugins folder, not Extendium.

## Install

1. Download `steam-chat-translator-0.1.0.zip` from the [`downloads` folder](downloads/).
2. Exit Steam completely using **Steam → Exit**.
3. Extract the ZIP into your Steam `millennium/plugins` directory.
4. Check that the layout is exactly:

   ```text
   Steam/millennium/plugins/steam-chat-translator/
     plugin.json
     backend/main.lua
     .millennium/Dist/index.js
   ```

   On a typical Windows installation the plugins directory is `C:\Program Files (x86)\Steam\millennium\plugins`.
5. Start Steam. In **Steam → Millennium → Plugins**, enable **Steam Chat Translator**, save changes, then restart Steam.
6. Open a chat. **Translate to English — On · Google** appears at the top. Click it to pause translation. The switch applies to all monitored chats and is remembered locally.

Keep Millennium up to date; this build uses its Lua backend and `@steambrew/client` 5.8.5.

## Features

- Detects the source language automatically and translates to English.
- Displays **Translated from Portuguese · Show original** above translated text.
- Preserves the original message, formatting and links; toggle back at any time.
- Skips your own messages, drafts, links-only messages, emoji-only messages, hidden conversations, spoilers, and detected embedded media.
- Leaves English or unchanged text alone after detection.
- Handles visible history and messages arriving while a chat is open, including group chats.
- Intended for desktop and in-game overlay chat windows using Steam's `.chatWindow` UI.
- Queues requests, deduplicates repeated text, keeps a bounded memory cache, and offers Retry on failures.
- Turning it off restores all original messages. No messages are sent, edited or deleted.

## Translation service and privacy

**Uses Google's public, unofficial translation endpoint at `translate.googleapis.com`. No API key or paid account is required.** It can be rate limited or change without notice. This plugin is not affiliated with Google, Valve or Millennium.

When enabled, visible incoming message text is sent to Google over HTTPS for detection and translation. That includes English text, since detection happens at the provider. Opening or scrolling a chat can translate its visible history. Outgoing messages, drafts, account IDs, sender names, Steam cookies and credentials are not included in translation requests. Message text is not written to disk or logged by this plugin. Translations are cached in memory only; the on/off preference is stored locally. Google processes submitted text under its own policies.

Language detection can be wrong for short messages, gaming slang and mixed-language text. If a message contains only a link it is skipped, but a link inside a longer sentence is included in that sentence's translation request. Messages longer than 4000 UTF-8 bytes are skipped.

## Troubleshooting

- **No switch in chat:** verify the extracted folder structure, enable the plugin, restart Steam completely, then reopen the chat. Existing windows may not be picked up until restart.
- **Translation unavailable:** the original stays readable. Hover the status for the reason, then Retry. After a rate limit, wait at least one minute.
- **An update broke it:** Steam's chat UI is private and can change. This plugin uses semantic `.chatWindow`, `.msg`, `.msgText` and `.isCurrentUser` classes verified in the installed Steam client. A future update may require selector changes.
- **Disable/uninstall:** disable the plugin in Millennium and restart Steam. To remove it entirely, exit Steam and remove only its `steam-chat-translator` folder.

## Development

Requires Node.js 20+ and npm. From the repository root:

```sh
npm ci
npm run typecheck
npm test
npm run build
node scripts/package.mjs
```

The browser tests use installed Google Chrome on Windows. Elsewhere, run `npx playwright install chromium`; you can also set `CHROME_PATH` to a Chromium executable. Tests run against synthetic chat fixtures, never a real conversation. Set `SCT_SCREENSHOT` to save a fixture screenshot during tests.

The build produces `.millennium/Dist/index.js`. The packaging script creates a ready-to-install ZIP in `downloads/`, including the hidden `.millennium` directory.

### Validation for 0.1.0

- TypeScript check and Millennium production build.
- Node tests for filtering, serialized/deduplicated requests, failures and cancellation.
- Chromium tests for incoming/outgoing filtering, original toggles, dynamic/recycled messages, failure recovery, pausing in flight and teardown.
- Lua backend executed with mocked Millennium/HTTP modules: UTF-8 encoding, response parsing, caching, rate limiting, malformed responses and startup.
- Live Google endpoint checked with synthetic Portuguese sample text.

**Steam desktop and overlay end-to-end operation has not yet been verified in a running client.** Automated browser tests cover the chat DOM logic; they do not prove Millennium's live popup/IPC integration.

## License

MIT. Uses the Millennium development libraries; they are installed as dependencies and are not vendored here.
