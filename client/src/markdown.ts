// Minimal, dependency-free Markdown for chat responses. It parses a safe subset
// into an AST that <Markdown> renders as real React elements — so escaping is
// automatic (React escapes text nodes) and no raw HTML is ever injected.
//
// Supported: ATX headings, fenced code, blockquotes, ordered/unordered lists,
// paragraphs with soft line breaks, and inline **bold**, *italic*, `code`, and
// [links](href) restricted to safe schemes. Single underscores are treated as
// literal text so snake_case identifiers survive.

export type Inline =
  | { readonly type: 'text'; readonly value: string }
  | { readonly type: 'strong'; readonly children: readonly Inline[] }
  | { readonly type: 'em'; readonly children: readonly Inline[] }
  | { readonly type: 'code'; readonly value: string }
  | { readonly type: 'link'; readonly href: string; readonly children: readonly Inline[] };

export type Block =
  | { readonly type: 'heading'; readonly level: number; readonly children: readonly Inline[] }
  | { readonly type: 'paragraph'; readonly children: readonly Inline[] }
  | { readonly type: 'code'; readonly value: string; readonly lang?: string }
  | {
      readonly type: 'list';
      readonly ordered: boolean;
      readonly items: readonly (readonly Inline[])[];
    }
  | { readonly type: 'quote'; readonly children: readonly Inline[] };

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const ORDERED_ITEM = /^\s*\d+[.)]\s+/;

const safeHref = (raw: string): string | null => {
  const href = raw.trim();
  return /^(?:https?:\/\/|mailto:|#|\/)/i.test(href) ? href : null;
};

export const parseInline = (text: string): Inline[] => {
  const out: Inline[] = [];
  let buffer = '';
  const flush = () => {
    if (buffer) {
      out.push({ type: 'text', value: buffer });
      buffer = '';
    }
  };
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    // Inline code — highest precedence, no inner parsing.
    if (ch === '`') {
      const end = text.indexOf('`', i + 1);
      if (end > i) {
        flush();
        out.push({ type: 'code', value: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    // Links [label](href).
    if (ch === '[') {
      const close = text.indexOf(']', i + 1);
      if (close > i && text[close + 1] === '(') {
        const paren = text.indexOf(')', close + 2);
        if (paren > close) {
          const href = safeHref(text.slice(close + 2, paren));
          if (href) {
            flush();
            out.push({ type: 'link', href, children: parseInline(text.slice(i + 1, close)) });
            i = paren + 1;
            continue;
          }
        }
      }
    }
    // Strong (** or __).
    if ((ch === '*' && text[i + 1] === '*') || (ch === '_' && text[i + 1] === '_')) {
      const marker = text.slice(i, i + 2);
      const end = text.indexOf(marker, i + 2);
      if (end > i + 1) {
        flush();
        out.push({ type: 'strong', children: parseInline(text.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    // Emphasis (* only — single _ stays literal to protect snake_case).
    if (ch === '*') {
      const end = text.indexOf('*', i + 1);
      if (end > i + 1) {
        flush();
        out.push({ type: 'em', children: parseInline(text.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    buffer += ch;
    i += 1;
  }
  flush();
  return out;
};

export const parseMarkdown = (source: string): Block[] => {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i += 1;
      continue;
    }
    // Fenced code.
    const fence = /^```(\w+)?\s*$/.exec(line);
    if (fence) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i]!)) {
        body.push(lines[i]!);
        i += 1;
      }
      i += 1; // consume closing fence (if present)
      blocks.push({ type: 'code', value: body.join('\n'), lang: fence[1] });
      continue;
    }
    // ATX heading.
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({
        type: 'heading',
        level: heading[1]!.length,
        children: parseInline(heading[2]!.trim()),
      });
      i += 1;
      continue;
    }
    // Blockquote.
    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i]!)) {
        quote.push(lines[i]!.replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push({ type: 'quote', children: parseInline(quote.join('\n')) });
      continue;
    }
    // List (a run of same-ordered items).
    if (LIST_ITEM.test(line)) {
      const ordered = ORDERED_ITEM.test(line);
      const items: Inline[][] = [];
      while (
        i < lines.length &&
        LIST_ITEM.test(lines[i]!) &&
        ORDERED_ITEM.test(lines[i]!) === ordered
      ) {
        items.push(parseInline(LIST_ITEM.exec(lines[i]!)![3]!));
        i += 1;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }
    // Paragraph — gather until a blank line or the start of another block.
    const paragraph: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() &&
      !/^```/.test(lines[i]!) &&
      !/^#{1,6}\s/.test(lines[i]!) &&
      !/^>\s?/.test(lines[i]!) &&
      !LIST_ITEM.test(lines[i]!)
    ) {
      paragraph.push(lines[i]!);
      i += 1;
    }
    blocks.push({ type: 'paragraph', children: parseInline(paragraph.join('\n')) });
  }
  return blocks;
};
