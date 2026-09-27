// Parses the in-app guides (docs/user-guide.md and docs/developer-guide.md).
// The guides use a small Markdown subset so product copy stays in the docs
// folder and renders without a Markdown library in the FAQ chunk:
//
//   # Guide title            first level-1 heading, not rendered
//   # Part name              later level-1 headings start a part
//   ## Section               a section card, listed in the table of contents
//   ### Subsection           a heading inside a section
//   paragraphs, "- " lists, "1. " lists (indented lines continue an item)
//   > text                   a tip box
//   ![Caption](/faq/...)     a screenshot on its own line (thumb links to full)
//   ```lang ... ```          a code block
//   :::categories            the default category catalog grid
//
// Inline: `code`, **bold**, [text](href). Every part, section and subsection
// gets a stable id from its text so links like #import-a-bank-statement and
// ?faq=developers#local-development work. This module is pure so unit tests
// can check that every link, anchor and image in both guides resolves.

export const GUIDE_TABS = Object.freeze(["user", "developers"]);

export function slugifyHeading(text) {
  return String(text)
    .toLowerCase()
    .replace(/[`*]/g, "")
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Screenshot family from its path, so the panel can reserve the right shape
// before a lazy image loads.
export function getGuideImageKind(src) {
  if (src.includes("/guide/phone/")) return "phone";
  if (src.includes("/guide/iphone/")) return "iphone";
  if (src.includes("/guide/desktop/")) return "desktop";
  return "other";
}

export function parseGuideMarkdown(markdown) {
  const lines = String(markdown).replace(/\r\n?/g, "\n").split("\n");
  const usedIds = new Map();
  const entries = [];
  let title = "";
  let current = null;
  let currentPartId = null;
  let paragraphLines = [];
  let listItems = [];
  let isOrderedList = false;
  let calloutLines = [];
  let codeBlock = null;

  function uniqueId(text) {
    const base = slugifyHeading(text) || "section";
    const count = usedIds.get(base) ?? 0;
    usedIds.set(base, count + 1);
    return count ? `${base}-${count + 1}` : base;
  }

  function ensureEntry() {
    // Text before the first heading still needs somewhere to live.
    if (!current) {
      current = { kind: "intro", id: "", title: "", blocks: [], partId: null };
      entries.push(current);
    }
    return current;
  }

  function flushParagraph() {
    if (!paragraphLines.length) return;
    ensureEntry().blocks.push({ type: "paragraph", text: paragraphLines.join(" ").trim() });
    paragraphLines = [];
  }

  function flushList() {
    if (!listItems.length) return;
    ensureEntry().blocks.push({ type: "list", ordered: isOrderedList, items: [...listItems] });
    listItems = [];
    isOrderedList = false;
  }

  function flushCallout() {
    if (!calloutLines.length) return;
    ensureEntry().blocks.push({ type: "callout", text: calloutLines.join(" ").trim() });
    calloutLines = [];
  }

  function flushAll() {
    flushParagraph();
    flushList();
    flushCallout();
  }

  for (const rawLine of lines) {
    if (codeBlock) {
      if (rawLine.trim().startsWith("```")) {
        ensureEntry().blocks.push({ type: "code", lang: codeBlock.lang, text: codeBlock.lines.join("\n") });
        codeBlock = null;
      } else {
        codeBlock.lines.push(rawLine);
      }
      continue;
    }

    const line = rawLine.trim();
    const isIndented = rawLine.length > rawLine.trimStart().length;

    if (line.startsWith("```")) {
      flushAll();
      codeBlock = { lang: line.slice(3).trim(), lines: [] };
      continue;
    }

    if (!line) {
      flushAll();
      continue;
    }

    if (/^#\s+/.test(line)) {
      flushAll();
      const text = line.replace(/^#\s+/, "").trim();
      if (!title && !entries.length) {
        title = text;
        continue;
      }
      const id = uniqueId(text);
      current = { kind: "part", id, title: text, blocks: [], partId: id };
      currentPartId = id;
      entries.push(current);
      continue;
    }

    if (line.startsWith("## ")) {
      flushAll();
      const text = line.slice(3).trim();
      current = { kind: "section", id: uniqueId(text), title: text, blocks: [], partId: currentPartId };
      entries.push(current);
      continue;
    }

    if (line.startsWith("### ")) {
      flushAll();
      const text = line.slice(4).trim();
      ensureEntry().blocks.push({ type: "subheading", text, id: uniqueId(text) });
      continue;
    }

    if (line === ":::categories") {
      flushAll();
      ensureEntry().blocks.push({ type: "categories" });
      continue;
    }

    const imageMatch = line.match(/^!\[([^\]]+)\]\(([^)\s]+)\)$/);
    if (imageMatch) {
      flushAll();
      const src = imageMatch[2].trim();
      ensureEntry().blocks.push({
        type: "image",
        alt: imageMatch[1].trim(),
        src,
        href: src.replace("/thumbs/", "/"),
        kind: getGuideImageKind(src)
      });
      continue;
    }

    if (line.startsWith(">")) {
      flushParagraph();
      flushList();
      calloutLines.push(line.replace(/^>\s?/, ""));
      continue;
    }

    if (isIndented && listItems.length) {
      listItems[listItems.length - 1] = `${listItems[listItems.length - 1]} ${line}`;
      continue;
    }

    if (line.startsWith("- ")) {
      flushParagraph();
      flushCallout();
      if (listItems.length && isOrderedList) flushList();
      isOrderedList = false;
      listItems.push(line.slice(2).trim());
      continue;
    }

    const orderedMatch = line.match(/^\d+\.\s+(.+)$/);
    if (orderedMatch) {
      flushParagraph();
      flushCallout();
      if (listItems.length && !isOrderedList) flushList();
      isOrderedList = true;
      listItems.push(orderedMatch[1].trim());
      continue;
    }

    flushList();
    flushCallout();
    paragraphLines.push(line);
  }

  if (codeBlock) {
    ensureEntry().blocks.push({ type: "code", lang: codeBlock.lang, text: codeBlock.lines.join("\n") });
  }
  flushAll();

  return { title, entries, toc: buildToc(entries) };
}

function buildToc(entries) {
  const toc = [];
  let part = null;
  for (const entry of entries) {
    if (entry.kind === "part") {
      part = { id: entry.id, title: entry.title, sections: [] };
      toc.push(part);
    } else if (entry.kind === "section") {
      if (part) {
        part.sections.push({ id: entry.id, title: entry.title });
      } else {
        toc.push({ id: entry.id, title: entry.title, sections: [] });
      }
    }
  }
  return toc;
}

const INLINE_PATTERN = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

// Splits inline Markdown into plain text, code, bold and link tokens.
export function tokenizeInline(text) {
  const tokens = [];
  let lastIndex = 0;
  INLINE_PATTERN.lastIndex = 0;
  let match = INLINE_PATTERN.exec(text);
  while (match) {
    if (match.index > lastIndex) tokens.push({ type: "text", text: text.slice(lastIndex, match.index) });
    if (match[1] !== undefined) tokens.push({ type: "code", text: match[1] });
    else if (match[2] !== undefined) tokens.push({ type: "bold", text: match[2] });
    else tokens.push({ type: "link", text: match[3], href: match[4] });
    lastIndex = INLINE_PATTERN.lastIndex;
    match = INLINE_PATTERN.exec(text);
  }
  if (lastIndex < text.length) tokens.push({ type: "text", text: text.slice(lastIndex) });
  return tokens;
}

// Where a guide link goes: another place in a guide, another app screen, a
// public file, or an outside site.
export function classifyGuideHref(href, currentTab = "user") {
  if (href.startsWith("#")) {
    return { kind: "anchor", tab: currentTab, anchor: decodeURIComponent(href.slice(1)) };
  }
  const guideMatch = href.match(/^(?:\/faq)?\?faq=([a-z]+)(?:#(.+))?$/);
  if (guideMatch) {
    return { kind: "anchor", tab: guideMatch[1], anchor: guideMatch[2] ? decodeURIComponent(guideMatch[2]) : "" };
  }
  if (/^https?:\/\//.test(href)) {
    return { kind: "external" };
  }
  if (href.startsWith("/faq/") || href.startsWith("/shortcuts/")) {
    return { kind: "file" };
  }
  if (href.startsWith("/")) {
    return { kind: "route" };
  }
  return { kind: "unknown" };
}

// Every id a link can target in a parsed guide.
export function collectGuideAnchors(doc) {
  const ids = new Set();
  for (const entry of doc.entries) {
    if (entry.id) ids.add(entry.id);
    for (const block of entry.blocks) {
      if (block.type === "subheading") ids.add(block.id);
    }
  }
  return ids;
}

function blockTexts(block) {
  if (block.type === "list") return block.items;
  if (block.type === "paragraph" || block.type === "callout" || block.type === "subheading") return [block.text];
  return [];
}

export function collectGuideLinks(doc) {
  const links = [];
  for (const entry of doc.entries) {
    for (const block of entry.blocks) {
      for (const text of blockTexts(block)) {
        for (const token of tokenizeInline(text)) {
          if (token.type === "link") links.push({ href: token.href, text: token.text, section: entry.title });
        }
      }
    }
  }
  return links;
}

export function collectGuideImages(doc) {
  return doc.entries.flatMap((entry) => entry.blocks
    .filter((block) => block.type === "image")
    .map((block) => ({ ...block, section: entry.title })));
}
