# Steam Chat Translator

A Millennium plugin that translates incoming **Steam Friends & Chat** messages into English. **Translation starts off; press Translate to enable it for a chat.**

```text
Translated from Portuguese · Show original
Hi, do you want to play another game?
```

Works alongside Extendium and Steam profile extensions. This is a **native Millennium plugin**, not a Chrome extension: install it in Millennium's plugins folder, not Extendium.

## Install

1. Download `steam-chat-translator-0.2.0.zip` from the [`downloads` folder](downloads/).
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
6. Open a chat and press **Translate** at the top. Translation is **off by default**: opening Steam or a chat never starts translation. After you enable a chat, incoming messages and history revealed by scrolling are translated. Press **Stop translating** to disable it and restore originals. Activation is not persisted across Steam restarts or recreated chat documents.

For DeepL, click **Settings** in the chat bar, or open **Steam → Millennium → Steam Chat Translator**. Choose DeepL, paste your API key in the masked field and save. Google remains available without a key.

Keep Millennium up to date; this build uses its Lua backend and `@steambrew/client` 5.8.5.

## Features

- Detects the source language and translates to English after you enable the chat with the top Translate button.
- Displays **Translated from Portuguese · Show original** above translated text.
- Preserves the original message, formatting and links; toggle back at any time.
- Skips your own messages, drafts, links-only messages, emoji-only messages, hidden conversations, spoilers, and detected embedded media.
- Leaves English or unchanged text alone after detection.
- Handles visible history and group chats. After enabling, scrolling up translates older history, including history outside the last 80 loaded messages.
- Intended for desktop and in-game overlay chat windows using Steam's `.chatWindow` UI.
- **LIFO scheduling:** newest queued messages first, including messages arriving during an active batch or cooldown.
- **Real batching:** up to 8 messages and 6000 UTF-8 bytes in one request, preserving each message's language and result.
- At least **5 seconds between completed requests and the next request**. Incoming messages are gathered for 200 ms before batching.
- On 429, automatically waits **60, 120, then 240 seconds**, preserving originals and showing one cooldown status instead of an error on every message. After three automatic retries, a manual Retry remains available.
- Deduplicates repeated text, skips off-screen history, and keeps a bounded memory cache.
- Original messages remain available through Show original. Disabling the plugin restores them all. No messages are sent, edited or deleted.

## Translation service and privacy

**Google (default)** uses the public, unofficial endpoint at `translate.googleapis.com`, with no API key. Google publishes no dependable quota for this endpoint; neither batching nor spacing guarantees avoiding rate limits. The Google Translate website is not an unlimited API. This plugin respects cooldowns and does not bypass rate limits.

**DeepL (optional)** uses the official text translation API at `api-free.deepl.com` for Free keys ending in `:fx`, or `api.deepl.com` for other keys. Get an API plan at [DeepL API](https://www.deepl.com/pro-api), then create a key under [API keys](https://www.deepl.com/your-account/keys). A regular translator subscription is different from an API plan. API usage follows your account's pricing and quota.

The API key is stored locally in `private-settings.json` inside the installed plugin folder. It is not encrypted, so keep that file private. The plugin never returns the saved key to the frontend, logs it, or includes it in the release ZIP; it is sent only as an authorization header to DeepL. The file is excluded from Git.

Only after you enable a chat with Translate, visible incoming message text in that chat is sent to your selected provider over HTTPS for detection and translation. That includes English text, since detection happens at the provider. While that chat is enabled, scrolling to older messages or receiving new ones can submit them for translation. Outgoing messages, drafts, account IDs, sender names and Steam cookies are not included in translation requests. Message text is not written to disk or logged by this plugin. Translations are cached in memory only; provider settings are stored locally. The selected provider processes submitted text under its own policies. This plugin is not affiliated with Google, DeepL, Valve or Millennium.

Language detection can be wrong for short messages, gaming slang and mixed-language text. If a message contains only a link it is skipped, but a link inside a longer sentence is included in that sentence's translation request. Messages longer than 4000 UTF-8 bytes are skipped.

## Troubleshooting

- **No switch in chat:** verify the extracted folder structure, enable the plugin, restart Steam completely, then reopen the chat. Existing windows may not be picked up until restart.
- **Rate limited:** the original stays readable. The chat bar shows the cooldown and queued work retries automatically, newest first. Waiting longer or using your own DeepL API key may be necessary; repeated manual retries and restarts do not remove provider restrictions.
- **Translation unavailable:** inspect the reason beside the message, then Retry if appropriate.
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

### Validation for 0.2.0

- TypeScript check and Millennium production build.
- Node tests for filtering, LIFO batches, byte limits, serialized/deduplicated requests, backoff, failures and cancellation.
- Chromium tests for default-off behavior, explicit activation, scrolling old history, incoming/outgoing filtering, original toggles, dynamic/recycled messages, failure recovery, cancellation and teardown.
- Lua backend executed with mocked Millennium/HTTP modules: UTF-8 encoding, per-message batch mapping, caching, rate limiting, malformed responses, DeepL authorization, key masking and startup.
- Live Google batch endpoint checked with synthetic Portuguese and French text.

Desktop Steam chat injection and Lua RPC were verified in a running client. The public Google endpoint returned HTTP 429 from Steam during live testing; a successful live translation is still dependent on provider availability. DeepL's request/response path is tested with mocks; live DeepL requires your own key. In-game overlay operation is not yet verified.

## License

MIT. Uses the Millennium development libraries; they are installed as dependencies and are not vendored here.
