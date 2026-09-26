import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  classifyGuideHref,
  collectGuideAnchors,
  collectGuideImages,
  collectGuideLinks,
  parseGuideMarkdown,
  slugifyHeading,
  tokenizeInline
} from "../src/client/guide-markdown.js";

// Both in-app guides (FAQ page tabs). Every link, anchor and screenshot they
// reference must resolve, and developer material must stay out of the
// user guide.
const guides = {
  user: parseGuideMarkdown(readFileSync("docs/user-guide.md", "utf8")),
  developers: parseGuideMarkdown(readFileSync("docs/developer-guide.md", "utf8"))
};
const anchors = Object.fromEntries(Object.entries(guides).map(([tab, doc]) => [tab, collectGuideAnchors(doc)]));
const APP_ROUTES = new Set(["/summary", "/month", "/entries", "/splits", "/imports", "/settings", "/faq"]);

function brokenLinks(doc, tab, anchorSets = anchors) {
  return collectGuideLinks(doc).flatMap((link) => {
    const target = classifyGuideHref(link.href, tab);
    if (target.kind === "anchor") {
      if (!anchorSets[target.tab]) return [`${link.href} (unknown guide tab)`];
      if (target.anchor && !anchorSets[target.tab].has(target.anchor)) return [`${link.href} in "${link.section}"`];
      return [];
    }
    if (target.kind === "route") {
      return APP_ROUTES.has(link.href.split(/[?#]/)[0]) ? [] : [`${link.href} (unknown app screen)`];
    }
    if (target.kind === "file") {
      return existsSync(path.join("public", link.href)) ? [] : [`${link.href} (missing file)`];
    }
    return target.kind === "external" ? [] : [`${link.href} (unsupported link)`];
  });
}

function missingImages(doc) {
  return collectGuideImages(doc).flatMap((image) => [image.src, image.href])
    .filter((src) => !existsSync(path.join("public", src)));
}

test("both guides parse into titled parts with a table of contents", () => {
  assert.equal(guides.user.title, "User guide");
  assert.equal(guides.developers.title, "For developers");
  assert.deepEqual(guides.user.toc.map((part) => part.title), ["Start here", "The screens", "How do I…", "Troubleshooting", "Glossary"]);
  for (const doc of Object.values(guides)) {
    assert.ok(doc.toc.length >= 5);
    assert.ok(doc.toc.every((part) => part.sections.length > 0), "every part lists at least one section");
  }
});

test("the user guide covers every screen in navigation order", () => {
  const screens = guides.user.toc.find((part) => part.title === "The screens").sections.map((section) => section.title);
  assert.deepEqual(screens, ["Summary", "Month", "Entries", "Splits", "Imports", "Settings", "Help (FAQ)"]);
});

test("every internal link and anchor in both guides resolves", () => {
  for (const [tab, doc] of Object.entries(guides)) {
    assert.deepEqual(brokenLinks(doc, tab), [], `${tab} guide has broken links`);
  }
});

test("every screenshot and its full-size version exists", () => {
  for (const [tab, doc] of Object.entries(guides)) {
    assert.deepEqual(missingImages(doc), [], `${tab} guide references missing images`);
  }
  const images = collectGuideImages(guides.user);
  assert.ok(images.length >= 40, `the user guide shows ${images.length} screenshots`);
  assert.ok(images.every((image) => image.src.includes("/thumbs/") && image.src.endsWith(".webp")), "inline images are WebP thumbnails");
  assert.ok(images.some((image) => image.kind === "phone") && images.some((image) => image.kind === "iphone"));
});

test("heading ids are unique within each guide", () => {
  for (const doc of Object.values(guides)) {
    const ids = doc.entries.flatMap((entry) => [entry.id, ...entry.blocks.filter((block) => block.type === "subheading").map((block) => block.id)]).filter(Boolean);
    assert.equal(new Set(ids).size, ids.length);
  }
});

// Words that belong in the developer tab, never in the user guide.
const DEVELOPER_TERMS = [/\bnpm\b/i, /wrangler/i, /localhost/i, /\bvite\b/i, /playwright/i, /\bjson\b/i, /\bdto\b/i, /\bD1\b/, /endpoint/i, /\/api\//i, /cloudflare/i, /\bnode\b/i, /git\b/i];

function developerTermHits(markdown) {
  return markdown.split("\n").flatMap((line, index) => DEVELOPER_TERMS.filter((pattern) => pattern.test(line)).map((pattern) => `line ${index + 1}: ${pattern} in "${line.trim()}"`));
}

test("the user guide has no developer-only terms", () => {
  assert.deepEqual(developerTermHits(readFileSync("docs/user-guide.md", "utf8")), []);
});

test("the developer guide keeps setup, testing and deploy material", () => {
  const titles = guides.developers.toc.map((part) => part.title);
  for (const title of ["Set up and run locally", "Testing", "Guides and screenshots", "Deploy and hosting", "Apple Pay Shortcut internals", "Architecture notes"]) {
    assert.ok(titles.includes(title), `missing part ${title}`);
  }
});

test("the checks catch a broken anchor, a missing image and a leaked developer term", () => {
  const bad = parseGuideMarkdown([
    "# User guide",
    "# Part",
    "## Section",
    "See [nowhere](#no-such-section) and [dev](?faq=developers#no-such-dev-section) and [screen](/nowhere).",
    "![Missing](/faq/guide/desktop/thumbs/does-not-exist.webp)"
  ].join("\n"));
  assert.deepEqual(brokenLinks(bad, "user", { user: collectGuideAnchors(bad), developers: anchors.developers }), [
    "#no-such-section in \"Section\"",
    "?faq=developers#no-such-dev-section in \"Section\"",
    "/nowhere (unknown app screen)"
  ]);
  assert.deepEqual(missingImages(bad), [
    "/faq/guide/desktop/thumbs/does-not-exist.webp",
    "/faq/guide/desktop/does-not-exist.webp"
  ]);
  assert.equal(developerTermHits("Run npm run dev first.").length, 1);
});

test("parser handles parts, code, tips, bold and duplicate headings", () => {
  const doc = parseGuideMarkdown([
    "# Guide",
    "Intro line.",
    "# Part one",
    "## Same",
    "> A tip",
    "> continues.",
    "```bash",
    "npm run dev",
    "```",
    "## Same",
    "### Sub & more",
    "1. First",
    "   continued",
    "- bullet"
  ].join("\n"));
  assert.equal(doc.title, "Guide");
  assert.deepEqual(doc.entries.map((entry) => [entry.kind, entry.id]), [["intro", ""], ["part", "part-one"], ["section", "same"], ["section", "same-2"]]);
  assert.deepEqual(doc.entries[2].blocks, [
    { type: "callout", text: "A tip continues." },
    { type: "code", lang: "bash", text: "npm run dev" }
  ]);
  assert.deepEqual(doc.entries[3].blocks, [
    { type: "subheading", text: "Sub & more", id: "sub-and-more" },
    { type: "list", ordered: true, items: ["First continued"] },
    { type: "list", ordered: false, items: ["bullet"] }
  ]);
  assert.equal(slugifyHeading("How do I…"), "how-do-i");
  assert.deepEqual(tokenizeInline("Use **Save** or `x` [here](#a)."), [
    { type: "text", text: "Use " },
    { type: "bold", text: "Save" },
    { type: "text", text: " or " },
    { type: "code", text: "x" },
    { type: "text", text: " " },
    { type: "link", text: "here", href: "#a" },
    { type: "text", text: "." }
  ]);
  assert.deepEqual(classifyGuideHref("?faq=developers#local", "user"), { kind: "anchor", tab: "developers", anchor: "local" });
  assert.deepEqual(classifyGuideHref("/entries?month=2026-05", "user"), { kind: "route" });
});
