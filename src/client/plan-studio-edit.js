// Plan Studio's edits (DOMAIN.md "Plan Studio"). The held plan is the saved
// plan plus `overrides` (only the rows changed since the last save), so a
// refresh of the saved plan flows through every row nobody touched. Changing
// a row takes the money from left over, or from a category the person picks;
// a locked row holds; the bar's lines move money between jobs; "What if I
// save more?" previews where the money would come from; one Undo stack
// covers it all until "Save plan" sends the whole change as one request.
import { flexibleRows, planTotals, primarySaveRow } from "./plan-studio-model.js";
import { sliderMaxMinor, stepMinorFor } from "./plan-studio-slider.js";

const UNDO_LIMIT = 60;
const JOB_LINE_STEP = 5000;
const JOB_SHARE_GRANULARITY = 500;
const WHAT_IF_SHARE_GRANULARITY = 100;

const sum = (values) => values.reduce((total, value) => total + value, 0);

/** The saved plan with the held changes on top, by row key. */
export function currentPlan(rows, overrides) {
  return Object.fromEntries(rows.map((row) => [row.key, overrides[row.key] ?? row.savedMinor]));
}

function toOverrides(rows, plan) {
  const overrides = {};
  for (const row of rows) {
    if (plan[row.key] !== undefined && plan[row.key] !== row.savedMinor) overrides[row.key] = plan[row.key];
  }
  return overrides;
}

/** The keys of editable rows whose held amount differs from the saved one. */
export function changedKeys(rows, plan) {
  return rows.filter((row) => row.editable && plan[row.key] !== undefined && plan[row.key] !== row.savedMinor).map((row) => row.key);
}

const rowOf = (rows, key) => rows.find((row) => row.key === key);

/**
 * One row's new amount. Income only changes itself. Anything else takes the
 * difference from left over (nothing else moves), or from the take-from
 * category: asking for more than it has gives what it has and says so.
 * @returns {{ plan: Record<string, number>, notice?: any }}
 */
export function setAmount({ rows, locks, takeFrom }, plan, key, nextMinor) {
  const row = rowOf(rows, key);
  if (!row || !row.editable) return { plan };
  if (locks[key]) return { plan, notice: { kind: "locked", label: row.label } };
  const next = Math.max(0, Math.round(nextMinor));
  const old = plan[key];
  if (next === old) return { plan };
  const source = row.job === "income" || takeFrom === "left" || takeFrom === key ? null : rowOf(rows, takeFrom);
  if (!source || !source.editable || locks[source.key]) {
    return { plan: { ...plan, [key]: next } };
  }
  const delta = next - old;
  if (delta > 0) {
    const take = Math.min(plan[source.key], delta);
    const result = { plan: { ...plan, [source.key]: plan[source.key] - take, [key]: old + take } };
    return take < delta ? { ...result, notice: { kind: "partial", amountMinor: take, label: source.label } } : result;
  }
  return { plan: { ...plan, [source.key]: plan[source.key] - delta, [key]: next } };
}

// Spread a change over rows in proportion to their size, in whole shares of
// `granularity` for all but the last row, which takes the remainder. A row
// never goes below zero. Returns what was actually applied.
function spread(rows, plan, deltaMinor, granularity) {
  const base = sum(rows.map((row) => plan[row.key]));
  const delta = Math.max(deltaMinor, -base);
  if (!rows.length || !delta) return { plan, appliedMinor: 0 };
  const next = { ...plan };
  if (base === 0) {
    next[rows[0].key] += delta;
    return { plan: next, appliedMinor: delta };
  }
  let remaining = delta;
  rows.forEach((row, index) => {
    const isLast = index === rows.length - 1;
    const proportional = Math.round((delta * plan[row.key]) / base / granularity) * granularity;
    const share = Math.max(-plan[row.key], isLast ? remaining : proportional);
    next[row.key] += share;
    remaining -= share;
  });
  return { plan: next, appliedMinor: delta - remaining };
}

/** Change a whole job: spread over its flexible rows in proportion to their size. */
export function adjustJob({ rows, locks }, plan, job, deltaMinor) {
  return spread(flexibleRows(rows, job, locks), plan, deltaMinor, JOB_SHARE_GRANULARITY);
}

/**
 * The slices the bar draws, in order. All jobs: Spend, Save, Invest, then
 * left over; inside a job: one per category, then left over. Left over is an
 * empty slice (never negative) when the plan is over-allocated.
 */
export function buildSegments(rows, plan, zoomJob) {
  const totals = planTotals(rows, plan);
  const left = { id: "left", kind: "left", amountMinor: Math.max(totals.left, 0) };
  if (zoomJob) {
    return [
      ...rows.filter((row) => row.job === zoomJob).map((row) => ({ id: row.key, kind: "row", key: row.key, label: row.label, job: row.job, amountMinor: plan[row.key] })),
      left
    ];
  }
  return [
    { id: "spend", kind: "job", job: "spend", amountMinor: totals.spend },
    { id: "save", kind: "job", job: "save", amountMinor: totals.save },
    { id: "invest", kind: "job", job: "invest", amountMinor: totals.invest },
    left
  ];
}

// What a segment can give or take: a job, through its flexible rows; a row,
// when it is editable and unlocked. Null when it cannot move at all.
function capacityOf(segment, { rows, locks }, plan) {
  if (segment.kind === "left") return { canGive: Infinity, canTake: true };
  if (segment.kind === "job") {
    const flexible = flexibleRows(rows, segment.job, locks);
    return flexible.length ? { canGive: sum(flexible.map((row) => plan[row.key])), canTake: true } : null;
  }
  const row = rowOf(rows, segment.key);
  return row?.editable && !locks[segment.key] ? { canGive: plan[segment.key], canTake: true } : null;
}

function applyToSegment(segment, ctx, plan, deltaMinor) {
  if (segment.kind === "left") return { plan, appliedMinor: deltaMinor };
  if (segment.kind === "job") return adjustJob(ctx, plan, segment.job, deltaMinor);
  return { plan: { ...plan, [segment.key]: plan[segment.key] + deltaMinor }, appliedMinor: deltaMinor };
}

/**
 * Drag the line after segment `index` to `targetCumMinor` (the bar's value at
 * the pointer): the segment before it grows or shrinks by the move and the one
 * after it does the opposite, so money moves between neighbours. The last
 * line (before left over) only changes the segment before it.
 */
export function moveLine(ctx, plan, segments, index, targetCumMinor) {
  const a = segments[index];
  const b = segments[index + 1];
  if (!a || !b) return { plan };
  const step = a.kind === "job" ? JOB_LINE_STEP : stepMinorFor(sliderMaxMinor({ plannedMinor: a.amountMinor, actualMinor: 0 }));
  const cum = sum(segments.slice(0, index + 1).map((segment) => segment.amountMinor));
  let delta = Math.round(targetCumMinor / step) * step - cum;
  if (!delta) return { plan };
  const capA = capacityOf(a, ctx, plan);
  const capB = capacityOf(b, ctx, plan);
  if (!capA || !capB) {
    const blocked = !capA ? a : b;
    return { plan, notice: { kind: "line_locked", label: blocked.label ?? blocked.job ?? "" } };
  }
  delta = Math.max(delta, -capA.canGive);
  if (b.kind !== "left") delta = Math.min(delta, capB.canGive);
  if (!delta) return { plan };
  const first = applyToSegment(a, ctx, plan, delta);
  if (!first.appliedMinor) return { plan };
  const second = applyToSegment(b, ctx, first.plan, -first.appliedMinor);
  return { plan: second.plan };
}

/**
 * Preview "What if I save more?": the saving target as a new total, and where
 * the money would come from. Left over pays first; the rest comes from the
 * category the person picked, or, by default, from the flexible categories in
 * proportion (never more than a row holds, never from a locked one). A lower
 * target gives money back to left over. Changes the plan only; nothing about
 * spending is predicted. Null when there is no savings line to change.
 */
export function previewSaveTarget({ rows, locks, plan, targetMinor, takeFromKey }) {
  const saveRow = primarySaveRow(rows, locks, plan);
  if (!saveRow) return null;
  const totals = planTotals(rows, plan);
  const target = Math.max(0, Math.round(targetMinor));
  const extra = target - totals.save;
  const next = { ...plan, [saveRow.key]: Math.max(0, plan[saveRow.key] + extra) };
  if (extra <= 0) {
    return { plan: next, saveKey: saveRow.key, extraMinor: extra, fromLeftMinor: 0, givenBackMinor: -extra, takenFrom: [], shortfallMinor: 0, totals: planTotals(rows, next) };
  }
  const fromLeft = Math.min(extra, Math.max(totals.left, 0));
  const rest = extra - fromLeft;
  let takenFrom = [];
  if (rest > 0) {
    const picked = takeFromKey && takeFromKey !== "auto" ? rowOf(rows, takeFromKey) : null;
    const pool = picked
      ? (picked.editable && !locks[picked.key] ? [picked] : [])
      : flexibleRows(rows, "spend", locks);
    const result = spread(pool, next, -rest, WHAT_IF_SHARE_GRANULARITY);
    takenFrom = pool
      .map((row) => ({ key: row.key, label: row.label, minor: next[row.key] - result.plan[row.key] }))
      .filter((part) => part.minor > 0);
    Object.assign(next, result.plan);
  }
  const taken = sum(takenFrom.map((part) => part.minor));
  return { plan: next, saveKey: saveRow.key, extraMinor: extra, fromLeftMinor: fromLeft, givenBackMinor: 0, takenFrom, shortfallMinor: rest - taken, totals: planTotals(rows, next) };
}

/**
 * What "Save plan" changes: each editable row whose held amount differs from
 * the saved one, and what its stored row must still hold on the server (the
 * request fails whole if the plan changed underneath).
 */
export function buildRowUpdates(rows, plan) {
  const updates = [];
  for (const row of rows) {
    if (!row.editable || plan[row.key] === undefined || plan[row.key] === row.savedMinor) continue;
    updates.push({ key: row.key, section: row.section, rowId: row.ids[0], plannedMinor: plan[row.key], expectedMinor: row.sourceMinors[0] });
  }
  return updates;
}

/** The request body's changes: one update per stored row that changed. */
export function buildChanges(rows, plan) {
  return buildRowUpdates(rows, plan).map(({ rowId, expectedMinor, plannedMinor }) => ({ action: "update", rowId, expectedMinor, plannedMinor }));
}

/**
 * The create change for a line the studio adds itself (the extra income
 * line, a Savings line): the same fields the Month plan row sheet saves.
 */
export function createChangeForRow(row, sectionKey) {
  return {
    action: "create",
    rowId: row.id,
    sectionKey,
    categoryName: row.categoryName,
    label: row.label,
    plannedMinor: row.plannedMinor,
    planDate: null,
    accountName: null,
    note: row.note ?? null,
    ownershipType: row.ownershipType,
    ...(row.ownershipType === "direct" ? { ownerName: row.ownerName } : { splitBasisPoints: row.splits?.[0]?.ratioBasisPoints ?? 5000 })
  };
}

export function createEditState() {
  return { overrides: {}, history: [], locks: {}, takeFrom: "left", whatIf: null, gesture: false, notice: null, noticeSeq: 0 };
}

const withNotice = (state, notice) => ({ ...state, notice, noticeSeq: state.noticeSeq + 1 });
const pushHistory = (state) => [...state.history, state.overrides].slice(-UNDO_LIMIT);
const sameOverrides = (a, b) => {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
};

// A change to the plan: no step when nothing changed; one Undo step unless a
// drag is already running (a drag is one step).
function commitPlan(state, rows, result) {
  const overrides = toOverrides(rows, result.plan);
  const changed = !sameOverrides(overrides, state.overrides);
  let next = state;
  if (changed) {
    next = { ...state, overrides, history: state.gesture ? state.history : pushHistory(state) };
  }
  return result.notice ? withNotice(next, result.notice) : next;
}

/**
 * The studio's reducer. Every action carries the current `rows`.
 * Actions: set, adjustJob, moveLine, gestureStart, gestureEnd, undo, reset,
 * toggleLock, takeFrom, whatIfTry, whatIfTakeFrom, whatIfApply, whatIfCancel,
 * saved, notify, clearNotice.
 */
export function studioReducer(state, action) {
  const { rows } = action;
  const plan = currentPlan(rows, state.overrides);
  // A one-tap fix names where its money comes from (left over), whatever Take from says.
  const ctx = { rows, locks: state.locks, takeFrom: action.takeFrom ?? state.takeFrom };
  switch (action.type) {
    case "set":
      return commitPlan(state, rows, setAmount(ctx, plan, action.key, action.minor));
    case "adjustJob":
      return commitPlan(state, rows, adjustJob(ctx, plan, action.job, action.deltaMinor));
    case "moveLine":
      return commitPlan(state, rows, moveLine(ctx, plan, buildSegments(rows, plan, action.zoom ?? null), action.index, action.targetMinor));
    case "gestureStart":
      return { ...state, gesture: true, history: pushHistory(state) };
    case "gestureEnd": {
      const last = state.history[state.history.length - 1];
      const unchanged = last !== undefined && sameOverrides(last, state.overrides);
      return { ...state, gesture: false, history: unchanged ? state.history.slice(0, -1) : state.history };
    }
    case "undo": {
      if (!state.history.length) return withNotice(state, { kind: "nothing_to_undo" });
      const overrides = state.history[state.history.length - 1];
      return withNotice({ ...state, overrides, history: state.history.slice(0, -1), whatIf: null }, { kind: "undone" });
    }
    case "reset":
      if (!Object.keys(state.overrides).length) return state;
      return withNotice({ ...state, overrides: {}, history: pushHistory(state), whatIf: null }, { kind: "reset" });
    case "toggleLock":
      return { ...state, locks: { ...state.locks, [action.key]: !state.locks[action.key] } };
    case "takeFrom":
      return { ...state, takeFrom: action.value };
    case "whatIfTry": {
      if (action.targetMinor === planTotals(rows, plan).save) return { ...state, whatIf: null };
      return { ...state, whatIf: { targetMinor: action.targetMinor, takeFromKey: state.whatIf?.takeFromKey ?? "auto" } };
    }
    case "whatIfTakeFrom":
      return state.whatIf ? { ...state, whatIf: { ...state.whatIf, takeFromKey: action.value } } : state;
    case "whatIfApply": {
      if (!state.whatIf) return state;
      const preview = previewSaveTarget({ rows, locks: state.locks, plan, targetMinor: state.whatIf.targetMinor, takeFromKey: state.whatIf.takeFromKey });
      if (!preview) return { ...state, whatIf: null };
      return withNotice({ ...state, overrides: toOverrides(rows, preview.plan), history: pushHistory(state), whatIf: null }, { kind: "what_if_applied" });
    }
    case "whatIfCancel":
      return { ...state, whatIf: null };
    case "saved":
      return withNotice({ ...state, overrides: {}, history: [], whatIf: null, gesture: false }, { kind: "saved" });
    case "notify":
      return withNotice(state, action.notice);
    case "clearNotice":
      return { ...state, notice: null };
    default:
      return state;
  }
}
