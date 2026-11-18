import { expect } from "@playwright/test";

// The fit check (docs/code-spec.md, "Phone fit check"): a geometry check
// for a phone screen in one state. Our older phone tests checked that a
// control appears; this checks that what is on screen fits it. It fails when
//
// - the page scrolls sideways;
// - visible text or a control is cut off by its container or the screen,
//   with no scroll that brings it into view (deliberate one-line ellipsis
//   truncation is allowed), or squeezed into a column a few letters wide;
// - two controls in the same layer overlap;
// - a control or text is covered by something else (a fixed bar, a sheet
//   part) and no scroll can move it clear;
// - a finger reaches less than 40 px across or down a control on a phone
//   (walking out from its centre, so a larger hit area counts);
// - a chooser (a list in a sheet, dialog, menu or listbox) shows fewer than
//   2.5 of its rows, or any other scroll box is squashed under 48 px;
// - an element named in `mustSee` (the focused field, Send, the latest
//   reply) is not in the visible area above the keyboard, and the page
//   cannot scroll it there.
//
// It reads the topmost open modal dialog, or the page; page parts hidden
// behind a full-screen fixed layer (the phone Ask page) are skipped. The phone
// keyboard is emulated with `fakeKeyboard` + `setKeyboard` (a stand-in for
// window.visualViewport, as iOS Safari shrinks only the visual viewport);
// only `mustSee` is held to the area above it. `ignore` takes CSS selectors for
// elements the check skips; keep it short and say why next to each one.
//
// Limits: it reads boxes, not pixels (it cannot see low contrast, awkward
// order or wasted space: take a screenshot and look), it samples one point
// per element for covering, and it does not know which rows a state needs.

/** Replaces window.visualViewport with a stand-in the test can shrink. */
export async function fakeKeyboard(page) {
  await page.addInitScript(() => {
    const target = new EventTarget();
    const viewport = { height: window.innerHeight, width: window.innerWidth, offsetTop: 0, offsetLeft: 0, scale: 1, pageTop: 0, pageLeft: 0 };
    viewport.addEventListener = target.addEventListener.bind(target);
    viewport.removeEventListener = target.removeEventListener.bind(target);
    Object.defineProperty(window, "visualViewport", { configurable: true, get: () => viewport });
    // @ts-ignore test hook
    window.__fitKeyboard = 0;
    // @ts-ignore test hook
    window.__setKeyboard = (height) => {
      // @ts-ignore test hook
      window.__fitKeyboard = height;
      viewport.height = window.innerHeight - height;
      target.dispatchEvent(new Event("resize"));
    };
    window.addEventListener("resize", () => {
      // @ts-ignore test hook
      viewport.height = window.innerHeight - (window.__fitKeyboard || 0);
      viewport.width = window.innerWidth;
      target.dispatchEvent(new Event("resize"));
    });
  });
}

/** Raises (or with 0 lowers) the emulated keyboard; needs `fakeKeyboard`. */
export async function setKeyboard(page, height) {
  await page.evaluate((value) => window.__setKeyboard(value), height);
  // Two frames for the inset hook and layout to follow.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

/**
 * @param {import("@playwright/test").Page} page
 * @param {{ root?: string, ignore?: string[], notChoosers?: string[], mustSee?: string[], minTarget?: number, minRows?: number }} [options]
 * @returns {Promise<string[]>}
 */
export async function collectFitProblems(page, options = {}) {
  return page.evaluate(fitProblemsInPage, {
    root: options.root ?? null,
    ignore: options.ignore ?? [],
    notChoosers: options.notChoosers ?? [],
    mustSee: options.mustSee ?? [],
    minTarget: options.minTarget ?? 40,
    minRows: options.minRows ?? 2.5
  });
}

/** Fails with every problem the fit check finds (see the top of this file). */
export async function expectFits(page, options = {}) {
  const problems = await collectFitProblems(page, options);
  expect(problems, `fit problems at ${page.viewportSize()?.width}x${page.viewportSize()?.height}`).toEqual([]);
}

function fitProblemsInPage({ root: rootSelector, ignore, notChoosers, mustSee, minTarget, minRows }) {
  const problems = [];
  const width = window.innerWidth;
  const keyboard = Number(window.__fitKeyboard) || 0;
  const visibleBottom = window.innerHeight - keyboard;
  const phone = width <= 760;
  const describe = (element) => {
    const tag = element.tagName.toLowerCase();
    const cls = typeof element.className === "string" && element.className.trim() ? `.${element.className.trim().split(/\s+/).slice(0, 2).join(".")}` : "";
    const name = (element.getAttribute("aria-label") || element.textContent || element.getAttribute("placeholder") || "").replace(/\s+/g, " ").trim().slice(0, 40);
    return `${tag}${cls}${name ? ` "${name}"` : ""}`;
  };

  const modals = [...document.querySelectorAll('[aria-modal="true"], dialog[open]')].filter((element) => {
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== "hidden";
  });
  const root = rootSelector ? document.querySelector(rootSelector) : (modals.at(-1) ?? document.body);
  if (!root) return [`fit root ${rootSelector} not found`];
  const ignored = (element) => ignore.some((selector) => element.closest(selector)) || element.closest("[data-fit-ignore]");

  const isShown = (element) => {
    if (element.closest('[aria-hidden="true"], [inert]')) return false;
    // Rows whose layout the browser skipped (content-visibility: auto, off screen) have stale boxes.
    if (element.checkVisibility && !element.checkVisibility({ contentVisibilityAuto: true })) return false;
    const style = getComputedStyle(element);
    if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) return false;
    const box = element.getBoundingClientRect();
    // A visually hidden label (1 px, for screen readers) is not on screen.
    return box.width > 1.5 && box.height > 1.5;
  };
  const scrollsY = (element) => /(auto|scroll)/.test(getComputedStyle(element).overflowY) && element.scrollHeight > element.clientHeight + 1;
  const scrollsX = (element) => /(auto|scroll)/.test(getComputedStyle(element).overflowX) && element.scrollWidth > element.clientWidth + 1;
  const clipsX = (element) => /(hidden|clip|auto|scroll)/.test(getComputedStyle(element).overflowX);
  const clipsY = (element) => /(hidden|clip|auto|scroll)/.test(getComputedStyle(element).overflowY);
  const fixedLayer = (element) => {
    for (let node = element; node && node !== document.documentElement; node = node.parentElement) {
      if (getComputedStyle(node).position === "fixed") return node;
    }
    return null;
  };
  // The fixed or sticky box a cover belongs to: content can scroll out from under it.
  const pinnedLayer = (element) => {
    for (let node = element; node && node !== document.documentElement; node = node.parentElement) {
      if (/(fixed|sticky)/.test(getComputedStyle(node).position)) return node;
    }
    return null;
  };
  const docScroller = document.scrollingElement;
  const docRoomDown = docScroller.scrollHeight - window.innerHeight - window.scrollY;
  const docRoomUp = window.scrollY;
  // The vertical room the element can still move, from the scrollers between it and its layer.
  const scrollRoom = (element) => {
    let up = 0;
    let down = 0;
    for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
      if (scrollsY(node)) {
        up += node.scrollTop;
        down += node.scrollHeight - node.clientHeight - node.scrollTop;
      }
      if (getComputedStyle(node).position === "fixed") return { up, down };
    }
    return { up: up + docRoomUp, down: down + docRoomDown };
  };

  const interactiveSelector = 'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="option"], [role="tab"], [role="switch"], [role="checkbox"], [role="radio"], [contenteditable="true"]';
  const candidates = [root, ...root.querySelectorAll("*")].filter((element) => element instanceof HTMLElement);
  const interactive = candidates.filter((element) => element.matches(interactiveSelector) && !element.disabled && isShown(element) && !ignored(element));
  const textLeaves = candidates.filter((element) => {
    if (!isShown(element) || ignored(element) || element.closest("svg")) return false;
    return [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
  });
  const inLayerView = (box) => box.bottom > 0 && box.top < visibleBottom;
  // The part of an element its clipping ancestors let through (null: scrolled out of its box).
  const clippedBox = (element) => {
    const box = element.getBoundingClientRect();
    let { left, right, top, bottom } = box;
    for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
      const style = getComputedStyle(node);
      const parent = node.getBoundingClientRect();
      if (/(hidden|clip|auto|scroll)/.test(style.overflowX)) { left = Math.max(left, parent.left); right = Math.min(right, parent.right); }
      if (/(hidden|clip|auto|scroll)/.test(style.overflowY)) { top = Math.max(top, parent.top); bottom = Math.min(bottom, parent.bottom); }
    }
    return right - left > 1 && bottom - top > 1 ? { left, right, top, bottom, width: right - left, height: bottom - top } : null;
  };
  // A full-screen fixed layer (the phone Ask page, a sheet's scrim) hides the page behind it on purpose.
  const isBackdropFor = (cover, element) => {
    const layer = fixedLayer(cover);
    if (!layer || layer.contains(element)) return false;
    const box = layer.getBoundingClientRect();
    const shown = Math.max(0, Math.min(box.bottom, visibleBottom) - Math.max(box.top, 0));
    return box.width * shown >= 0.6 * width * visibleBottom;
  };

  // 1. Sideways page scroll.
  if (docScroller.scrollWidth > width + 1) {
    problems.push(`page scrolls sideways (${docScroller.scrollWidth}px content on a ${width}px screen)`);
  }

  const seen = new Set();
  const report = (key, text) => {
    if (seen.has(key)) return;
    seen.add(key);
    problems.push(text);
  };

  // 2. Cut off by a container or the screen.
  for (const element of new Set([...interactive, ...textLeaves])) {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const ellipsis = style.textOverflow === "ellipsis" || Number(style.webkitLineClamp) > 0;
    if (!ellipsis && element.tagName !== "INPUT" && element.tagName !== "TEXTAREA" && element.tagName !== "SELECT" && clipsX(element) && !scrollsX(element) && element.scrollWidth > element.clientWidth + 1) {
      report(element, `cut off: ${describe(element)} is wider than its own box`);
    }
    // A growing text box that did not grow: its first or last line is hidden.
    if (element.tagName === "TEXTAREA" && element.value && !/(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 2) {
      report(element, `cut off: ${describe(element)} shows ${element.clientHeight}px of ${element.scrollHeight}px of its text`);
    }
    // Squeezed: a long name or field pushed into a column a few letters wide.
    const fontSize = parseFloat(style.fontSize) || 16;
    const textLength = (element.value ?? element.textContent ?? "").trim().length;
    if (textLength > 12 && box.width < fontSize * 4 && box.height > fontSize * 4) {
      report(element, `squeezed: ${describe(element)} is ${Math.round(box.width)}px wide for ${textLength} letters`);
    }
    let horizontalScroller = false;
    let verticalScroller = false;
    for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
      const parent = node.getBoundingClientRect();
      if (scrollsX(node)) { horizontalScroller = true; break; }
      // Inside a scroll box, being past an outer edge is the scroll box's business.
      if (verticalScroller) continue;
      if (scrollsY(node)) { verticalScroller = true; continue; }
      const nodeStyle = getComputedStyle(node);
      const parentEllipsis = nodeStyle.textOverflow === "ellipsis" || Number(nodeStyle.webkitLineClamp) > 0;
      if (parentEllipsis) break;
      if (clipsX(node) && !scrollsX(node) && (box.left < parent.left - 2 || box.right > parent.right + 2)) {
        report(element, `cut off: ${describe(element)} runs out of the side of ${describe(node)}`);
        break;
      }
      if (clipsY(node) && !scrollsY(node) && (box.top < parent.top - 2 || box.bottom > parent.bottom + 2) && box.height > 0 && inLayerView(parent)) {
        report(element, `cut off: ${describe(element)} runs out of the top or bottom of ${describe(node)}`);
        break;
      }
    }
    const seenBox = clippedBox(element);
    if (!horizontalScroller && seenBox && (seenBox.left < -1 || seenBox.right > width + 1)) {
      report(element, `off screen sideways: ${describe(element)} (${Math.round(box.left)}..${Math.round(box.right)} on ${width}px)`);
    }
    // Vertically outside what can be seen, with no scroll to bring it in.
    const room = scrollRoom(element);
    if (box.top < -1 && -box.top > room.up + 1) {
      report(element, `trapped above the screen: ${describe(element)}`);
    } else if (box.bottom > window.innerHeight + 1 && box.bottom - window.innerHeight > room.down + 1) {
      report(element, `trapped below the screen: ${describe(element)} (bottom ${Math.round(box.bottom)}, screen ${window.innerHeight})`);
    }
  }

  // 3. Covered by something else (a fixed bar, another sheet part), with no scroll to clear it.
  const coverOf = (element) => {
    const box = clippedBox(element);
    if (!box) return null;
    const x = Math.min(Math.max(box.left + box.width / 2, 1), width - 1);
    const y = box.top + Math.min(box.height / 2, 12);
    if (y < 0 || y > visibleBottom) return null;
    const hit = document.elementFromPoint(x, y);
    if (!hit || element.contains(hit) || hit.contains(element)) return null;
    // A label or wrapper drawn over its own control is not a cover.
    if (hit.closest("label")?.contains(element)) return null;
    if (isBackdropFor(hit, element)) return null;
    // An invisible native control laid over its own chip (a date input) is the chip's control.
    if (Number(getComputedStyle(hit).opacity) === 0) return null;
    return hit;
  };
  for (const element of new Set([...interactive, ...textLeaves])) {
    const box = clippedBox(element);
    if (!box || !inLayerView(box)) continue;
    const cover = coverOf(element);
    if (!cover || ignored(cover)) continue;
    const coverLayer = pinnedLayer(cover);
    const coverBox = cover.getBoundingClientRect();
    const room = scrollRoom(element);
    const sameLayer = fixedLayer(element) === fixedLayer(cover) && fixedLayer(cover) && !scrollsYAncestorBetween(element, fixedLayer(cover));
    // A bar in the lower half of the screen is cleared by scrolling the content up past it, one in the upper half by scrolling it down.
    const barBelow = coverBox.top + coverBox.height / 2 > visibleBottom / 2;
    const clearable = !sameLayer && coverLayer !== null && (barBelow ? room.down >= box.bottom - coverBox.top : room.up >= coverBox.bottom - box.top);
    if (!clearable) {
      report(element, `covered: ${describe(element)} is under ${describe(cover)}`);
    }
  }
  function scrollsYAncestorBetween(element, layer) {
    for (let node = element.parentElement; node && node !== layer; node = node.parentElement) {
      if (scrollsY(node)) return true;
    }
    return false;
  }

  // 4. Two controls on top of each other.
  // Page controls hidden behind a full-screen layer are out of play.
  const behindBackdrop = (element, box) => {
    const hit = document.elementFromPoint(Math.min(Math.max(box.left + box.width / 2, 1), width - 1), Math.min(Math.max(box.top + box.height / 2, 1), window.innerHeight - 1));
    return Boolean(hit && !element.contains(hit) && isBackdropFor(hit, element));
  };
  const boxes = interactive.map((element) => ({ element, box: clippedBox(element) })).filter(({ element, box }) => box && inLayerView(box) && !behindBackdrop(element, box));
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i];
      const b = boxes[j];
      if (a.element.contains(b.element) || b.element.contains(a.element)) continue;
      // Page content passing under a fixed or sticky bar is the covering check's business.
      if (pinnedLayer(a.element) !== pinnedLayer(b.element)) continue;
      const overlapX = Math.min(a.box.right, b.box.right) - Math.max(a.box.left, b.box.left);
      const overlapY = Math.min(a.box.bottom, b.box.bottom) - Math.max(a.box.top, b.box.top);
      if (overlapX > 4 && overlapY > 4) {
        report(`${i}x${j}`, `overlap: ${describe(a.element)} and ${describe(b.element)}`);
      }
    }
  }

  // 5. Small tap targets on a phone: what a finger reaches, walking out from
  // the centre while a press still lands on the control (a small control
  // with a larger hit area passes). An inline link in running text and an
  // openable figure (its card is the target, design.md "Openable figures")
  // are exempt.
  if (phone) {
    const lands = (element, x, y) => {
      if (x < 0 || x > width || y < 0 || y > visibleBottom) return false;
      const hit = document.elementFromPoint(x, y);
      return Boolean(hit && (element.contains(hit) || hit.contains(element) && hit.matches("label")));
    };
    const reach = (element, cx, cy, dx, dy) => {
      let steps = 0;
      while (steps < 40 && lands(element, cx + dx * (steps + 1), cy + dy * (steps + 1))) steps += 1;
      return steps;
    };
    for (const { element } of boxes) {
      if (element.matches('input[type="checkbox"], input[type="radio"]') && element.closest("label")) continue;
      if (element.closest("[data-fig]")) continue;
      if (element.matches("a") && getComputedStyle(element).display === "inline") continue;
      const box = element.getBoundingClientRect();
      if (box.height >= minTarget - 0.5 && box.width >= minTarget - 0.5) continue;
      const cx = box.left + box.width / 2;
      const cy = box.top + box.height / 2;
      if (!lands(element, cx, cy)) continue;
      const across = reach(element, cx, cy, -1, 0) + reach(element, cx, cy, 1, 0) + 1;
      const down = reach(element, cx, cy, 0, -1) + reach(element, cx, cy, 0, 1) + 1;
      if (across < minTarget - 1 || down < minTarget - 1) {
        report(element, `small target: ${describe(element)} reaches ${across}x${down}`);
      }
    }
  }

  // 6. A scroll box too short to show its rows.
  // Only choosers (a list in a sheet, dialog, menu or listbox) are held to
  // rows: a page or a conversation is read, not picked from.
  // `notChoosers` names a form sheet's body, which is filled in, not picked from.
  const chooser = (element) => !notChoosers.some((selector) => element.matches(selector))
    && (element.matches('[role="listbox"], [role="menu"]') || Boolean(element.closest('dialog, [role="dialog"], [aria-modal="true"], [role="listbox"], [role="menu"]')));
  for (const scroller of candidates.filter((element) => element !== document.body && isShown(element) && !ignored(element) && scrollsY(element) && !chooser(element))) {
    const box = scroller.getBoundingClientRect();
    if (box.height < 48 && box.bottom > 0 && box.top < visibleBottom) {
      report(scroller, `short scroll box: ${describe(scroller)} is ${Math.round(box.height)}px tall for ${scroller.scrollHeight}px of content`);
    }
  }
  for (const scroller of candidates.filter((element) => element !== document.body && isShown(element) && !ignored(element) && scrollsY(element) && chooser(element))) {
    const box = scroller.getBoundingClientRect();
    const shown = Math.min(box.bottom, visibleBottom) - Math.max(box.top, 0);
    let rows = [...scroller.children].filter(isShown);
    if (rows.length === 1) rows = [...rows[0].children].filter(isShown);
    const tops = [...new Set(rows.map((row) => Math.round(row.getBoundingClientRect().top)))].sort((a, b) => a - b);
    const gaps = tops.slice(1).map((top, index) => top - tops[index]).filter((gap) => gap > 8).sort((a, b) => a - b);
    // A row is what is picked: the median height of the controls inside, or else the step between children.
    const controls = [...scroller.querySelectorAll(interactiveSelector)].filter(isShown).map((control) => control.getBoundingClientRect().height).sort((a, b) => a - b);
    const rowHeight = controls.length >= 3 ? controls[Math.floor(controls.length / 2)]
      : gaps.length ? gaps[Math.floor(gaps.length / 2)] : rows.map((row) => row.getBoundingClientRect().height).sort((a, b) => a - b)[Math.floor(rows.length / 2)] ?? 0;
    // Only list-like boxes (chooser rows, chips): a conversation of tall cards is not rows.
    if (rowHeight > 0 && rowHeight <= 96 && shown < rowHeight * minRows - 1) {
      report(scroller, `short scroll box: ${describe(scroller)} shows ${Math.max(0, Math.round(shown))}px, under ${minRows} rows of ${Math.round(rowHeight)}px`);
    }
  }

  // 7. What must be in sight (the focused field, Send, the latest reply).
  for (const selector of mustSee) {
    const element = [...document.querySelectorAll(selector)].filter(isShown).at(-1);
    if (!element) {
      problems.push(`must see: nothing shown for ${selector}`);
      continue;
    }
    const box = element.getBoundingClientRect();
    const allowed = Math.min(box.height, visibleBottom * 0.5);
    // What its scroll boxes and the screen let through above the keyboard.
    const seen = clippedBox(element);
    const inSight = seen ? Math.min(seen.bottom, visibleBottom) - Math.max(seen.top, 0) : 0;
    // The browser scrolls a focused field on the page (not in a fixed layer) into view, if the page has room.
    const room = scrollRoom(element);
    const scrollable = !fixedLayer(element) && box.bottom - visibleBottom <= room.down && box.top >= -room.up;
    if (inSight < allowed - 1 && !scrollable) {
      problems.push(`must see: ${selector} (${describe(element)}) is ${Math.round(Math.max(0, inSight))}px in sight of ${Math.round(allowed)}px (top ${Math.round(box.top)}, visible to ${visibleBottom})`);
    } else {
      const cover = coverOf(element);
      if (cover && !ignored(cover)) problems.push(`must see: ${selector} is under ${describe(cover)}`);
    }
  }
  return problems;
}
