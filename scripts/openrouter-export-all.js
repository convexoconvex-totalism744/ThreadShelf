/*
 * OpenRouter BULK export (run in browser DevTools console).
 *
 * Exports EVERY chat in your sidebar — one JSON file per chat — so you can drop the
 * whole download into a folder and index it in one go. For a single chat instead,
 * use scripts/openrouter-export-browser.js.
 *
 * How to use:
 * 1) Open https://openrouter.ai/ signed in, with your chat list (sidebar) visible.
 * 2) Open DevTools Console (F12), paste this whole file, press Enter.
 * 3) Allow "multiple downloads" if the browser asks.
 * 4) Move the downloaded *.json files into a folder and index that folder.
 *
 * Each file is compatible with the ThreadShelf parser (platform: "openrouter").
 * Selectors below match OpenRouter's chat UI as of 2026-06; if the UI changes they
 * may need updating (see test/playwright/openrouter-export.spec.js for the contract).
 */
(async () => {
  const CONFIG = {
    DOWNLOAD_DELAY_MS: 700,
    NAV_TIMEOUT_MS: 15000,
    SCROLL_PAUSE_MS: 350,
    MAX_SCROLLS: 250,
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function normalizeText(text) {
    return String(text || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function safeName(text) {
    return (
      normalizeText(text)
        .replace(/[\\/:*?"<>|]+/g, '-')
        .replace(/\s+/g, '_')
        .slice(0, 60) || 'chat'
    );
  }

  // Text of a node with chrome (buttons, icons, avatars) stripped out.
  function cleanText(node) {
    if (!node) return '';
    const clone = node.cloneNode(true);
    clone
      .querySelectorAll('button, svg, picture, img, [role="button"], [aria-hidden="true"]')
      .forEach((n) => n.remove());
    return normalizeText(clone.innerText || clone.textContent || '');
  }

  // The rendered message text lives in a privacy-masked panel. For assistant
  // messages with reasoning there are two panels (reasoning first, answer last);
  // we keep the last. Falls back to prose elements, then the whole node.
  function messageBody(el) {
    const panels = el.querySelectorAll('[data-dd-privacy="hidden"]');
    if (panels.length) return cleanText(panels[panels.length - 1]);
    const prose = Array.from(el.querySelectorAll('p, li, pre, h1, h2, h3, h4, blockquote'));
    if (prose.length) return normalizeText(prose.map((n) => n.textContent || '').join('\n'));
    return cleanText(el);
  }

  function getModel(el) {
    const fav = el.querySelector('img[alt^="Favicon for"], img[alt*="Favicon"]');
    if (fav) {
      const m = (fav.getAttribute('alt') || '').replace(/favicon for/i, '').trim();
      if (m) return m;
    }
    return undefined;
  }

  function extractTurns() {
    const els = Array.from(
      document.querySelectorAll('[data-testid="user-message"], [data-testid="assistant-message"]'),
    );
    const turns = [];
    const seen = new Set();
    for (const el of els) {
      const role = el.getAttribute('data-testid') === 'user-message' ? 'user' : 'assistant';
      const content = messageBody(el);
      if (!content) continue;
      const key = `${role}:${content}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const turn = { role, content };
      if (role === 'assistant') {
        const model = getModel(el);
        if (model) turn.model = model;
      }
      turns.push(turn);
    }
    return turns;
  }

  // Sidebar chat links look like /chat?room=orc-<id>.
  function findChats() {
    const anchors = Array.from(document.querySelectorAll('a[href*="room="]'));
    const byId = new Map();
    for (const a of anchors) {
      const href = a.getAttribute('href') || '';
      const match = href.match(/[?&]room=([^&#]+)/);
      if (!match) continue;
      const id = match[1];
      if (id && !byId.has(id)) byId.set(id, { id, href, title: normalizeText(a.textContent || '') });
    }
    return [...byId.values()];
  }

  function findAnchor(id) {
    return Array.from(document.querySelectorAll('a[href*="room="]')).find((a) =>
      (a.getAttribute('href') || '').includes(id),
    );
  }

  function buildPayload(turns, title) {
    return {
      platform: 'openrouter',
      exportedAt: new Date().toISOString(),
      pageTitle: document.title,
      title: title || document.title,
      sourceUrl: location.href,
      turns,
    };
  }

  function getScrollContainer() {
    return (
      document.querySelector('[data-testid="message-list-scroll"]') ||
      document.querySelector('[data-testid="message-list-content"]')?.parentElement ||
      document.scrollingElement ||
      document.documentElement
    );
  }

  async function autoScrollToLoadAll() {
    const container = getScrollContainer();
    let prev = -1;
    let stable = 0;
    for (let i = 0; i < CONFIG.MAX_SCROLLS && stable < 3; i++) {
      const count = document.querySelectorAll(
        '[data-testid="user-message"], [data-testid="assistant-message"]',
      ).length;
      stable = count === prev ? stable + 1 : 0;
      prev = count;
      container.scrollTop = 0;
      await sleep(CONFIG.SCROLL_PAUSE_MS);
    }
    container.scrollTop = container.scrollHeight;
    await sleep(CONFIG.SCROLL_PAUSE_MS);
  }

  async function waitForChat(id) {
    const start = Date.now();
    while (Date.now() - start < CONFIG.NAV_TIMEOUT_MS) {
      if (location.href.includes(id) && extractTurns().length > 0) return true;
      await sleep(300);
    }
    return false;
  }

  function download(payload, fileName) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // Test hook: expose internals and skip side effects when driven by a test.
  if (typeof window !== 'undefined' && window.__OR_TEST__) {
    window.__ORX = { findChats, extractTurns, buildPayload, normalizeText, getModel };
    return;
  }

  const chats = findChats();
  if (!chats.length) {
    console.error(
      'No chats found in the sidebar. Open openrouter.ai with your chat list visible, then re-run. ' +
        'For a single open chat use scripts/openrouter-export-browser.js.',
    );
    return;
  }

  console.log(`Found ${chats.length} chats. Starting bulk export…`);
  let exported = 0;
  let skipped = 0;
  for (const [i, chat] of chats.entries()) {
    try {
      if (!location.href.includes(chat.id)) {
        const anchor = findAnchor(chat.id);
        if (!anchor) {
          console.warn(`(${i + 1}/${chats.length}) anchor not found, skipping ${chat.id}`);
          skipped++;
          continue;
        }
        anchor.click();
      }
      if (!(await waitForChat(chat.id))) {
        console.warn(`(${i + 1}/${chats.length}) timed out loading ${chat.id}, skipping`);
        skipped++;
        continue;
      }
      await autoScrollToLoadAll();
      const turns = extractTurns();
      if (!turns.length) {
        console.warn(`(${i + 1}/${chats.length}) no messages in ${chat.id}, skipping`);
        skipped++;
        continue;
      }
      const title = chat.title || document.title;
      download(buildPayload(turns, title), `openrouter-${safeName(title)}-${safeName(chat.id)}.json`);
      exported++;
      console.log(`(${i + 1}/${chats.length}) exported "${title}" (${turns.length} messages)`);
      await sleep(CONFIG.DOWNLOAD_DELAY_MS);
    } catch (err) {
      skipped++;
      console.warn(`(${i + 1}/${chats.length}) failed on ${chat.id}:`, err);
    }
  }

  console.log(`Done. Exported ${exported} chats, skipped ${skipped}. Index the downloaded folder.`);
})();
