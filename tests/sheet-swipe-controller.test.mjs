// Swipe down to dismiss a phone bottom sheet (design.md, "Mobile Sheet"):
// the pure gesture rules. A clean sheet closes on a long enough drag or a
// quick flick; a sheet with changes springs back and asks "Discard
// changes?"; a save in flight, a text field, a text selection or content
// scrolled away from its top never starts a drag; sideways movement (a chip
// row scrolling) and a long press are left to the browser.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  SHEET_SWIPE,
  canStartSheetDrag,
  createSheetSwipeController,
  resolveSheetRelease,
  sheetDismissThreshold
} from "../src/client/sheet-swipe-controller.js";

const SHEET_HEIGHT = 600;

function controller({ dirty = false, submitting = false } = {}) {
  const state = { dirty, submitting };
  const swipe = createSheetSwipeController({ isDirty: () => state.dirty, isSubmitting: () => state.submitting });
  return { swipe, state };
}

// A drag from (x, 100) straight down to `toY` in `steps` moves over `ms`,
// then a release `restMs` after the last move.
function drag(swipe, { toY, x = 200, steps = 6, ms = 300, restMs = 0, context = {} }) {
  const startY = 100;
  const started = swipe.start({ x, y: startY, t: 0 }, { sheetHeight: SHEET_HEIGHT, scrollTops: [0, 0], ...context });
  const moves = [];
  for (let step = 1; step <= steps; step += 1) {
    moves.push(swipe.move({ x, y: startY + ((toY - startY) * step) / steps, t: (ms * step) / steps }));
  }
  const outcome = swipe.end({ y: toY, t: ms + restMs });
  return { started, moves, outcome };
}

test("the dismiss threshold is 30% of the sheet, between 80 and 160 px", () => {
  assert.equal(sheetDismissThreshold(400), 120);
  assert.equal(sheetDismissThreshold(200), SHEET_SWIPE.minDismissPx);
  assert.equal(sheetDismissThreshold(900), SHEET_SWIPE.maxDismissPx);
  assert.equal(sheetDismissThreshold(Number.NaN), SHEET_SWIPE.minDismissPx);
});

test("a clean sheet dragged past the threshold dismisses; short of it, it springs back", () => {
  const { swipe } = controller();
  // 600 px sheet: threshold 160 px. A slow drag with a rest before release.
  const past = drag(swipe, { toY: 100 + 170, restMs: 200 });
  assert.equal(past.started, true);
  assert.deepEqual(past.moves.at(-1), { preventDefault: true, offset: 170 });
  assert.equal(past.outcome, "dismiss");

  const short = drag(swipe, { toY: 100 + 150, restMs: 200 });
  assert.equal(short.outcome, "spring-back");
});

test("a quick flick dismisses below the threshold, but a twitch does not", () => {
  const { swipe } = controller();
  // 60 px in 40 ms: 1.5 px/ms, well over the flick speed.
  const flick = drag(swipe, { toY: 160, steps: 4, ms: 40 });
  assert.equal(flick.outcome, "dismiss");

  // The same distance, but the finger rested 150 ms before letting go.
  const rested = drag(swipe, { toY: 160, steps: 4, ms: 40, restMs: 150 });
  assert.equal(rested.outcome, "spring-back");

  // Fast but only 20 px: under flickMinPx.
  const twitch = drag(swipe, { toY: 120, steps: 2, ms: 10 });
  assert.equal(twitch.outcome, "spring-back");
});

test("a sheet with changes springs back and asks instead of closing", () => {
  const { swipe } = controller({ dirty: true });
  assert.equal(drag(swipe, { toY: 300, restMs: 200 }).outcome, "confirm");
  assert.equal(drag(swipe, { toY: 160, steps: 4, ms: 40 }).outcome, "confirm");
  // Short of the threshold it just springs back, no question.
  assert.equal(drag(swipe, { toY: 150, restMs: 200 }).outcome, "spring-back");
});

test("the draft is read at release, so a change made mid-drag still asks", () => {
  const { swipe, state } = controller();
  swipe.start({ x: 0, y: 0, t: 0 }, { sheetHeight: SHEET_HEIGHT });
  swipe.move({ x: 0, y: 100, t: 100 });
  state.dirty = true;
  swipe.move({ x: 0, y: 200, t: 200 });
  assert.equal(swipe.end({ y: 200, t: 400 }), "confirm");
});

test("while a save is in flight the swipe is ignored", () => {
  const { swipe, state } = controller({ submitting: true });
  const blocked = drag(swipe, { toY: 400 });
  assert.equal(blocked.started, false);
  assert.ok(blocked.moves.every((move) => move.preventDefault === false && move.offset === null));
  assert.equal(blocked.outcome, "none");

  // A save that starts mid-drag lets go of the sheet (it returns to 0) and
  // the release does nothing.
  state.submitting = false;
  swipe.start({ x: 0, y: 0, t: 0 }, { sheetHeight: SHEET_HEIGHT });
  assert.deepEqual(swipe.move({ x: 0, y: 120, t: 100 }), { preventDefault: true, offset: 120 });
  state.submitting = true;
  assert.deepEqual(swipe.move({ x: 0, y: 220, t: 200 }), { preventDefault: false, offset: 0 });
  assert.equal(swipe.end({ y: 300, t: 300 }), "none");

  assert.equal(resolveSheetRelease({ offset: 400, velocity: 3, sheetHeight: SHEET_HEIGHT, isDirty: false, isSubmitting: true }), "spring-back");
});

test("content scrolled away from its top keeps the drag for scrolling", () => {
  assert.equal(canStartSheetDrag({ scrollTops: [0, 0, 0] }), true);
  assert.equal(canStartSheetDrag({ scrollTops: [0, 12, 0] }), false);
  // Half a pixel of iOS rubber-band still counts as scrolled.
  assert.equal(canStartSheetDrag({ scrollTops: [0.5] }), false);

  const { swipe } = controller();
  const scrolled = drag(swipe, { toY: 400, context: { scrollTops: [0, 240] } });
  assert.equal(scrolled.started, false);
  assert.ok(scrolled.moves.every((move) => move.preventDefault === false));
  assert.equal(scrolled.outcome, "none");
});

test("a long list or chip row inside the body keeps its touches, even at its top", () => {
  assert.equal(canStartSheetDrag({ startsInNestedScroller: true, scrollTops: [0, 0] }), false);
  const { swipe } = controller();
  const nested = drag(swipe, { toY: 400, context: { startsInNestedScroller: true } });
  assert.equal(nested.started, false);
  assert.ok(nested.moves.every((move) => move.preventDefault === false && move.offset === null));
  assert.equal(nested.outcome, "none");
});

test("text fields, a text selection, a second finger and an open question never start a drag", () => {
  assert.equal(canStartSheetDrag({ startsInTextField: true }), false);
  assert.equal(canStartSheetDrag({ hasTextSelection: true }), false);
  assert.equal(canStartSheetDrag({ touchCount: 2 }), false);
  assert.equal(canStartSheetDrag({ isConfirmOpen: true }), false);
  assert.equal(canStartSheetDrag({ isSubmitting: true }), false);
});

test("a sideways move hands the gesture back, so a chip row scrolls", () => {
  const { swipe } = controller();
  swipe.start({ x: 200, y: 100, t: 0 }, { sheetHeight: SHEET_HEIGHT });
  // Mostly sideways from the first move: never held back.
  assert.deepEqual(swipe.move({ x: 194, y: 102, t: 16 }), { preventDefault: false, offset: null });
  assert.deepEqual(swipe.move({ x: 170, y: 106, t: 32 }), { preventDefault: false, offset: null });
  // Once given up, a later downward move does not take the sheet.
  assert.deepEqual(swipe.move({ x: 170, y: 400, t: 48 }), { preventDefault: false, offset: null });
  assert.equal(swipe.end({ y: 400, t: 60 }), "none");
});

test("an upward move scrolls the content, and a long press is left alone", () => {
  const { swipe } = controller();
  swipe.start({ x: 0, y: 300, t: 0 }, { sheetHeight: SHEET_HEIGHT });
  assert.equal(swipe.move({ x: 0, y: 280, t: 20 }).preventDefault, false);
  assert.equal(swipe.end({ y: 100, t: 100 }), "none");

  swipe.start({ x: 0, y: 100, t: 0 }, { sheetHeight: SHEET_HEIGHT });
  assert.deepEqual(swipe.move({ x: 0, y: 300, t: 900 }), { preventDefault: false, offset: null });
  assert.equal(swipe.end({ y: 300, t: 950 }), "none");
});

test("a clearly downward start is held back before the slop; a diagonal one is not", () => {
  const { swipe } = controller();
  swipe.start({ x: 0, y: 0, t: 0 }, { sheetHeight: SHEET_HEIGHT });
  assert.deepEqual(swipe.move({ x: 1, y: 6, t: 10 }), { preventDefault: true, offset: null });
  assert.deepEqual(swipe.move({ x: 1, y: 30, t: 20 }), { preventDefault: true, offset: 30 });
  assert.equal(swipe.isDragging, true);
  assert.equal(swipe.cancel(), "spring-back");
  assert.equal(swipe.isDragging, false);

  swipe.start({ x: 0, y: 0, t: 0 }, { sheetHeight: SHEET_HEIGHT });
  assert.deepEqual(swipe.move({ x: 5, y: 6, t: 10 }), { preventDefault: false, offset: null });
  assert.equal(swipe.cancel(), "none");
});

test("the sheet never moves above where it rests", () => {
  const { swipe } = controller();
  swipe.start({ x: 0, y: 100, t: 0 }, { sheetHeight: SHEET_HEIGHT });
  swipe.move({ x: 0, y: 140, t: 50 });
  assert.deepEqual(swipe.move({ x: 0, y: 60, t: 100 }), { preventDefault: true, offset: 0 });
  assert.equal(swipe.end({ y: 60, t: 300 }), "spring-back");
});

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

test("every sheet with a draft tells the swipe whether it changed; the phone Splits dialog swipes too", () => {
  const clientDir = path.join(root, "src/client");
  const files = readdirSync(clientDir, { recursive: true }).map(String).filter((name) => /\.jsx?$/.test(name));
  const sheets = files.filter((name) => /<EntryMobileSheet\b/.test(read(`src/client/${name}`)));
  assert.deepEqual(sheets.sort(), [
    "entries-panel.jsx",
    "entry-composer-section.jsx",
    "import-batch-bar.jsx",
    "import-preview-row-list.jsx",
    "month-plan-sheet.jsx",
    // The shared dialog frame: the topped-up form, the notes, the confirmations
    // and the Settings editors all render through it.
    "sheet-dialog.jsx"
  ]);
  // The import progress sheet only shows the batch; it has no draft.
  const withoutDraft = new Set(["import-batch-bar.jsx"]);
  for (const name of sheets.filter((file) => !withoutDraft.has(file))) {
    const source = read(`src/client/${name}`);
    // From each opening tag to its onSave prop (every sheet has one).
    const openings = source.match(/<EntryMobileSheet\b[\s\S]*?onSave=/g) ?? [];
    assert.ok(openings.length > 0, name);
    for (const opening of openings) {
      assert.match(opening, /isDirty=\{/, `${name}: an EntryMobileSheet without isDirty would close a changed draft on a swipe`);
    }
  }
  const sheet = read("src/client/entry-mobile-sheet.jsx");
  assert.match(sheet, /useSheetSwipeDismiss\(\{ sheet, isDirty, isSubmitting, onClose \}\)/);
  assert.match(sheet, /data-sheet-body/);
  const splits = read("src/client/splits-dialogs.jsx");
  assert.match(splits, /useSheetSwipeDismiss\(\{ sheet: content, enabled: isMobileLayout, isDirty, isSubmitting, onClose \}\)/);
});

test("the gesture never blocks native scrolling it does not own", () => {
  const source = read("src/client/sheet-swipe.jsx");
  assert.match(source, /addEventListener\("touchstart", onTouchStart, \{ passive: true \}\)/);
  // touchmove cancels only a move the controller claimed for the sheet.
  assert.match(source, /if \(result\.preventDefault\) \{[\s\S]*?event\.preventDefault\(\);/);
  assert.doesNotMatch(read("src/client/sheet-swipe.css"), /touch-action/);
  assert.doesNotMatch(source, /touchAction|touch-action:/);
});
