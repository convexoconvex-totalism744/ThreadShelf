/*
 * OpenRouter SINGLE-chat export (run in browser DevTools console).
 *
 * Exports the chat that is currently open into one parser-compatible JSON file.
 * To export EVERY chat at once, use scripts/openrouter-export-all.js instead.
 *
 * How to use:
 * 1) Open the chat you want at https://openrouter.ai/chat?room=...
 * 2) Scroll up so the whole conversation is loaded.
 * 3) Open DevTools Console (F12), paste this whole file, press Enter.
 * 4) A JSON file downloads. Move it into a folder and index that folder.
 *
 * Output format is compatible with the ThreadShelf parser (platform: "openrouter").
 * Selectors match OpenRouter's chat UI as of 2026-06 (see
 * test/playwright/openrouter-export.spec.js for the contract).
 */
(async () => {
  const CONFIG = { SCROLL_PAUSE_MS: 350, MAX_SCROLLS: 250 };
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

  function cleanText(node) {
    if (!node) return '';
    const clone = node.cloneNode(true);
    clone
      .querySelectorAll('button, svg, picture, img, [role="button"], [aria-hidden="true"]')
      .forEach((n) => n.remove());
    return normalizeText(clone.innerText || clone.textContent || '');
  }

  // Message text is in a privacy-masked panel; for assistant messages with
  // reasoning the answer is the last panel (reasoning is first). Fallbacks: prose,
  // then the node itself.
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
    window.__ORX = { extractTurns, buildPayload, normalizeText, getModel };
    return;
  }

  await autoScrollToLoadAll();
  const turns = extractTurns();
  if (!turns.length) {
    console.error('No messages found. Open a chat, scroll it fully, and run again.');
    return;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  download(buildPayload(turns, document.title), `openrouter-${safeName(document.title)}-${stamp}.json`);
  console.log(`Exported ${turns.length} messages (single chat).`);
})();
