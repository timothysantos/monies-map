import "./plan-studio.css";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { planStudioCopy } from "./copy/plan-studio-copy";
import { moniesClient } from "./monies-client-service";
import { useMoneyPrivacy } from "./money-privacy";
import { getPersonColour } from "./person-colour";
import { paletteColour } from "./palette-colour";
import { BigPicture } from "./plan-studio-bar";
import {
  buildChanges,
  buildRowUpdates,
  buildSegments,
  changedKeys,
  createEditState,
  currentPlan,
  previewSaveTarget,
  studioReducer
} from "./plan-studio-edit";
import { makeStudioFormat } from "./plan-studio-format";
import {
  balanceVerdict,
  buildStudioRows,
  dayOfMonthFor,
  expectedByToday,
  expectedSpendByToday,
  paceVerdict,
  planTotals,
  primarySaveRow,
  rowStatus,
  sharedHalves,
  suggestFix
} from "./plan-studio-model";
import { PaceCard } from "./plan-studio-pace";
import { StudioRow } from "./plan-studio-row";
import { sliderMaxMinor, stepMinorFor } from "./plan-studio-slider";
import { incomeSegments, rowInfo, studioGroups, unplannedIncome } from "./plan-studio-v2-model";
import { WhatIfCard } from "./plan-studio-whatif";
import { ResponsiveSelect } from "./responsive-select";
import { ConfirmLead, SheetDialog } from "./sheet-dialog";
import { useRouteWorkBusy } from "./use-route-work-status";
import { PiggyBank } from "lucide-react";

const { categories: categoryService } = moniesClient;
const copy = planStudioCopy;
const NOTICE_MS = 4500;

// The money jobs' colours are 1970s palette picks (design.md "Plan Studio"),
// so a colour preset re-colours them with the rest of the app.
const JOB_COLOURS = {
  income: paletteColour("#758C4D"),
  spend: paletteColour("#A98466"),
  save: paletteColour("#566432"),
  invest: paletteColour("#7A587D")
};

// What a row's track reaches and steps by. The track is sized from the saved
// plan, so it holds still while a thumb moves; a plan typed past its end
// stretches the track to fit.
function rowScale(row, plannedMinor) {
  const base = sliderMaxMinor({ plannedMinor: row.savedMinor, actualMinor: row.actualMinor });
  const maxMinor = plannedMinor > base ? sliderMaxMinor({ plannedMinor, actualMinor: row.actualMinor }) : base;
  return { maxMinor, stepMinor: stepMinorFor(maxMinor) };
}

function noticeText(notice, fmt) {
  if (!notice) return "";
  const text = copy.notices;
  switch (notice.kind) {
    case "undone": return text.undone;
    case "nothing_to_undo": return text.nothingToUndo;
    case "reset": return text.reset;
    case "saved": return text.saved;
    case "locked": return text.locked(notice.label);
    case "line_locked": return text.lineLocked(notice.label);
    case "partial": return text.partial(fmt.money(notice.amountMinor), notice.label);
    case "what_if_applied": return copy.whatIf.applied;
    case "extra_saved": return copy.extraIncome.done;
    default: return "";
  }
}

/**
 * Plan Studio (DOMAIN.md "Plan Studio", design.md "Plan Studio"): the Month
 * plan as money jobs. A big picture of where planned money in goes with lines
 * to drag, how the month is going against the plan, "What if I save more?",
 * and every income row, planned item and budget bucket with a slider and an
 * exact amount. Changes are held here, with one Undo stack, until "Save plan"
 * sends them as one request (`onSave`); the Month page's own plan list below
 * stays the place for notes, accounts, matching entries and adding or
 * removing a line.
 *
 * It reads only the Month page's rows and the lead's figures (no request of
 * its own besides the save), so the numbers agree with the lead above.
 *
 * The combined household view is read only (as its plan tables are): the
 * same picture with no sliders, lines, Save plan or What if, and a line that
 * says to switch to a person view.
 *
 * The list is one list grouped by what the money does (Money in, Spend, Save,
 * Invest; src/client/plan-studio-v2-model.js), whichever stored section a line
 * lives in. The Month page hands in what its dialogs and commands do for a
 * line (`menuActionsFor`) and for adding one (`onAddLine`); `onDirtyChange`
 * tells it whether changes are held, and `visible` false keeps the held
 * changes while the Tables view is showing.
 *
 * @param {{
 *   month: string, monthLabel: string, categories: any[], incomeRows: any[], planSections: any[],
 *   readOnly?: boolean, readOnlyHint?: string, figures: null | { income: number, spending: number, invested: number, kept: number },
 *   today: string, onSave: (request: { changes: any[], updates: any[] }) => Promise<void>,
 *   menuActionsFor?: (row: any) => any, onAddLine?: (kind: "income" | "line") => void,
 *   onDirtyChange?: (dirty: boolean) => void, visible?: boolean
 * }} props
 */
export default function PlanStudio({
  month, monthLabel, categories, incomeRows, planSections, figures, today, onSave, readOnly = false, readOnlyHint = "",
  menuActionsFor = () => ({}), onAddLine = undefined, onDirtyChange = undefined, visible = true
}) {
  const { areTotalsVisible } = useMoneyPrivacy();
  const fmt = useMemo(() => makeStudioFormat(!areTotalsVisible), [areTotalsVisible]);
  const keptMinor = figures?.kept ?? 0;
  // The savings row's "actual" is the money kept so far (the Month lead's
  // Saved), as the money jobs measure it.
  const rows = useMemo(
    () => buildStudioRows({ incomeRows, planSections, month }).map((row) => ({
      ...row,
      ...(row.job === "save" ? { actualMinor: Math.max(0, keptMinor) } : {}),
      ...(readOnly ? { editable: false } : {})
    })),
    [incomeRows, planSections, month, keptMinor, readOnly]
  );
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const [state, dispatch] = useReducer(studioReducer, undefined, createEditState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const send = useCallback((action) => dispatch({ ...action, rows: rowsRef.current }), []);
  const [zoom, setZoom] = useState(null);
  const [save, setSave] = useState({ phase: "idle", error: "" });
  const savingRef = useRef(false);
  const [noticeShown, setNoticeShown] = useState(null);
  const [extraAsk, setExtraAsk] = useState(false);

  const plan = useMemo(() => currentPlan(rows, state.overrides), [rows, state.overrides]);
  const totals = useMemo(() => planTotals(rows, plan), [rows, plan]);
  const when = useMemo(() => dayOfMonthFor(month, today), [month, today]);
  const spentMinor = figures?.spending ?? 0;
  const incomeMinor = figures?.income ?? 0;
  const changed = changedKeys(rows, plan);
  const dirtyNow = changed.length > 0;
  useEffect(() => { onDirtyChange?.(dirtyNow); }, [dirtyNow, onDirtyChange]);
  // Held changes, an open what-if and a save in flight hold back optional
  // background work, as every other open editor on the page does.
  useRouteWorkBusy(changed.length > 0 || Boolean(state.whatIf) || save.phase === "saving");

  // A job's slices only exist while it has rows.
  const zoomJob = zoom && rows.some((row) => row.job === zoom) ? zoom : null;
  const segments = useMemo(() => buildSegments(rows, plan, zoomJob), [rows, plan, zoomJob]);

  // Notices speak for a few seconds and clear themselves.
  useEffect(() => {
    if (!state.notice) return undefined;
    setNoticeShown(state.notice);
    const timer = window.setTimeout(() => {
      setNoticeShown(null);
      send({ type: "clearNotice" });
    }, NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [state.noticeSeq, state.notice, send]);

  const dotColours = useMemo(() => Object.fromEntries(rows.map((row) => {
    if (row.job === "income") return [row.key, paletteColour(getPersonColour(row.ownerName))];
    if (row.job === "spend") {
      const category = categoryService.get(categories, { categoryName: row.categoryName });
      return [row.key, paletteColour(category?.colorHex ?? "#8B897A")];
    }
    return [row.key, JOB_COLOURS[row.job]];
  })), [rows, categories]);

  const balance = useMemo(() => {
    const verdict = balanceVerdict(totals);
    if (fmt.hidden) return { ...verdict, title: copy.balance.hidden.title, text: copy.balance.hidden.text() };
    const words = copy.balance[verdict.kind];
    return { ...verdict, title: words.title, text: words.text(fmt.money(verdict.amountMinor)) };
  }, [totals, fmt]);

  const fixPlan = useMemo(() => suggestFix({ rows, plan, locks: state.locks, totals }), [rows, plan, state.locks, totals]);
  const fix = !readOnly && fixPlan && (fixPlan.kind === "lower" || fixPlan.kind === "save")
    ? { ...fixPlan, label: fixPlan.kind === "lower" ? copy.balance.lower(fixPlan.label, fmt.money(fixPlan.byMinor)) : copy.balance.addToSavings(fmt.money(fixPlan.byMinor)) }
    : null;

  const expectedMinor = expectedSpendByToday(rows, plan, when);
  const verdict = paceVerdict({ spentMinor, plannedSpendMinor: totals.spend, expectedMinor });
  const moneyInText = incomeMinor >= totals.income ? copy.pace.inOnPlan : copy.pace.inToCome(fmt.money(totals.income - incomeMinor));
  const paceChip = { tone: verdict.tone, text: fmt.hidden ? copy.pace.hiddenVerdict : copy.pace.verdict[verdict.kind] };

  // What if I save more?
  const saveRow = rows.find((row) => row.job === "save" && row.editable);
  const preview = useMemo(
    () => (state.whatIf ? previewSaveTarget({ rows, locks: state.locks, plan, targetMinor: state.whatIf.targetMinor, takeFromKey: state.whatIf.takeFromKey }) : null),
    [rows, plan, state.locks, state.whatIf]
  );
  const whatIfMax = sliderMaxMinor({ plannedMinor: Math.max(totals.save, 1) + Math.max(totals.left, 0), actualMinor: 0 });
  const flexible = rows.filter((row) => row.job === "spend" && row.editable && row.dueDay === null && !state.locks[row.key]);
  const whatIfTakeOptions = [{ value: "auto", label: copy.whatIf.spreadAuto }, ...flexible.map((row) => ({ value: row.key, label: row.label }))];

  const takeOptions = [
    { value: "left", label: copy.toolbar.leftOver },
    ...rows.filter((row) => row.job !== "income" && row.editable).map((row) => ({ value: row.key, label: row.label }))
  ];

  const onSet = useCallback((key, minor) => send({ type: "set", key, minor }), [send]);
  const onGestureStart = useCallback(() => send({ type: "gestureStart" }), [send]);
  const onGestureEnd = useCallback(() => send({ type: "gestureEnd" }), [send]);
  const onToggleLock = useCallback((key) => send({ type: "toggleLock", key }), [send]);
  const onMoveLine = useCallback((index, targetMinor) => send({ type: "moveLine", zoom: zoomJob, index, targetMinor }), [send, zoomJob]);
  const onNudge = useCallback((key, direction) => {
    const row = rowsRef.current.find((item) => item.key === key);
    const current = currentPlan(rowsRef.current, stateRef.current.overrides)[key];
    const { stepMinor } = rowScale(row, current);
    send({ type: "set", key, minor: current + direction * stepMinor });
  }, [send]);

  // Save plan: every held change in one request. Adding extra income to
  // Savings goes through the same path with that one change put on top.
  async function handleSave(planToSave = plan) {
    const changes = buildChanges(rows, planToSave);
    if (!changes.length || savingRef.current) return false;
    savingRef.current = true;
    setSave({ phase: "saving", error: "" });
    try {
      await onSave({ changes, updates: buildRowUpdates(rows, planToSave) });
      send({ type: "saved" });
      setSave({ phase: "idle", error: "" });
      return true;
    } catch (error) {
      setSave({ phase: "error", error: error?.status === 409 ? copy.notices.saveConflict : copy.notices.saveFailed });
      return false;
    } finally {
      savingRef.current = false;
    }
  }

  // Money that arrived beyond the plan. Never shown with money hidden (it
  // would say which side of the plan the month is on).
  const extraMinor = unplannedIncome({ receivedMinor: incomeMinor, plannedInMinor: totals.income });
  const extraSaveRow = primarySaveRow(rows, state.locks, plan);
  const extraTarget = extraSaveRow ? plan[extraSaveRow.key] + extraMinor : 0;
  const incomeParts = incomeSegments(rows, plan);

  async function confirmExtra() {
    if (!extraSaveRow || !extraMinor) return;
    const saved = await handleSave({ ...plan, [extraSaveRow.key]: plan[extraSaveRow.key] + extraMinor });
    setExtraAsk(false);
    if (saved) send({ type: "notify", notice: { kind: "extra_saved" } });
  }

  if (!rows.length) return null;
  const saving = save.phase === "saving";
  const dirty = changed.length > 0;
  const groups = studioGroups(rows);

  const extra = !fmt.hidden && extraMinor > 0 ? (
    <p className="ps-extra" data-ps-extra>
      <span>{copy.extraIncome.line(fmt.money(extraMinor))}</span>
      {!readOnly && extraSaveRow ? (
        <button type="button" className="ps-quiet ps-extra-add" onClick={() => setExtraAsk(true)} data-ps-extra-add>{copy.extraIncome.add}</button>
      ) : null}
    </p>
  ) : null;

  return (
    <section
      className={`plan-studio${fmt.hidden ? " is-hidden-money" : ""}`}
      style={{ "--ps-job-income": JOB_COLOURS.income, "--ps-job-spend": JOB_COLOURS.spend, "--ps-job-save": JOB_COLOURS.save, "--ps-job-invest": JOB_COLOURS.invest }}
      aria-label={copy.region}
      aria-busy={saving || undefined}
      id={visible ? "month-plan" : undefined}
      data-plan-studio
      data-fig-period={`${month}:${month}`}
      hidden={!visible || undefined}
      inert={saving || !visible || undefined}
    >
      {readOnly ? <p className="ps-notice is-readonly" data-ps-readonly>{readOnlyHint}</p> : (
      <>
      <div className="ps-toolbar" role="toolbar" aria-label={copy.region}>
        <button type="button" className="ps-quiet" disabled={!state.history.length} onClick={() => send({ type: "undo" })} data-ps-undo>{copy.toolbar.undo}</button>
        <button type="button" className="ps-quiet" disabled={!dirty} onClick={() => send({ type: "reset" })} data-ps-reset>{copy.toolbar.reset}</button>
        <label className="ps-take">
          <span>{copy.toolbar.takeFrom}</span>
          <ResponsiveSelect
            value={state.takeFrom}
            options={takeOptions}
            title={copy.toolbar.takeFromLabel}
            className="ps-select"
            onValueChange={(value) => send({ type: "takeFrom", value })}
          />
        </label>
        <button type="button" className="ps-primary" disabled={!dirty || saving} onClick={() => handleSave()} data-ps-save>
          {saving ? copy.toolbar.saving : copy.toolbar.save}
        </button>
      </div>
      <p className="ps-notice" role="status" aria-live="polite" data-ps-notice>{noticeText(noticeShown, fmt)}</p>
      </>
      )}
      {save.phase === "error" ? (
        <div className="ps-save-error" role="alert" data-ps-save-error>
          <span>{save.error}</span>
          <button type="button" className="ps-quiet" onClick={() => handleSave()}>{copy.notices.retry}</button>
        </div>
      ) : null}
      <BigPicture
        monthLine={copy.monthLine(monthLabel, when.isCurrent ? when.day : 0, when.daysInMonth)}
        paceChip={paceChip}
        balance={balance}
        fix={fix}
        onFix={() => fixPlan && send({
          type: "set",
          key: fixPlan.rowKey,
          minor: plan[fixPlan.rowKey] + (fixPlan.kind === "lower" ? -fixPlan.byMinor : fixPlan.byMinor),
          takeFrom: "left"
        })}
        segments={segments}
        totals={totals}
        zoom={zoomJob}
        onZoom={setZoom}
        fmt={fmt}
        dotColours={dotColours}
        jobColours={JOB_COLOURS}
        incomeParts={incomeParts}
        onMoveLine={onMoveLine}
        onGestureStart={onGestureStart}
        onGestureEnd={onGestureEnd}
        dragging={state.gesture}
        readOnly={readOnly}
      />
      <div className="ps-cards" data-ps-cards>
        <PaceCard
          fmt={fmt}
          incomeMinor={incomeMinor}
          plannedInMinor={totals.income}
          spentMinor={spentMinor}
          plannedSpendMinor={totals.spend}
          expectedMinor={expectedMinor}
          isCurrent={when.isCurrent}
          verdict={verdict}
          moneyInText={moneyInText}
          extra={extra}
        />
        {readOnly ? null : <WhatIfCard
          fmt={fmt}
          hasSaveRow={Boolean(saveRow)}
          saveTotalMinor={totals.save}
          totals={totals}
          preview={preview}
          targetMinor={state.whatIf?.targetMinor ?? totals.save}
          maxMinor={whatIfMax}
          stepMinor={stepMinorFor(whatIfMax)}
          takeOptions={whatIfTakeOptions}
          takeFromKey={state.whatIf?.takeFromKey ?? "auto"}
          onTry={(minor) => send({ type: "whatIfTry", targetMinor: minor })}
          onTakeFrom={(value) => send({ type: "whatIfTakeFrom", value })}
          onApply={() => send({ type: "whatIfApply" })}
          onCancel={() => send({ type: "whatIfCancel" })}
        />}
      </div>
      <div className="ps-columns" data-ps-columns>
        {groups.map((group) => (
          <div className="ps-group" key={group.job} id={group.job === "income" && visible ? "month-plan-income" : undefined} data-ps-group={group.job}>
            <div className="ps-group-head">
              <b>{copy.jobs[group.job]}</b>
              <span className="ps-muted">{copy.groupPlanned(fmt.money(totals[group.job]))}</span>
              {!readOnly && onAddLine && (group.job === "income" || group.job === "spend") ? (
                <button
                  type="button"
                  className="ps-quiet ps-group-add"
                  aria-label={group.job === "income" ? copy.group.addIncomeLabel : copy.group.addLineLabel}
                  onClick={() => onAddLine(group.job === "income" ? "income" : "line")}
                  data-ps-add={group.job}
                >
                  {group.job === "income" ? copy.group.addIncome : copy.group.addLine}
                </button>
              ) : null}
            </div>
            {group.rows.map((row) => {
              const planned = plan[row.key];
              const pace = expectedByToday(row, planned, when);
              return (
                <StudioRow
                  key={row.key}
                  row={row}
                  plannedMinor={planned}
                  savedMinor={row.savedMinor}
                  locked={Boolean(state.locks[row.key])}
                  fmt={fmt}
                  status={rowStatus(row, planned, { ...when, keptMinor })}
                  paceMinor={when.isCurrent ? pace : null}
                  scale={rowScale(row, planned)}
                  halves={sharedHalves(row, planned)}
                  dotColour={dotColours[row.key]}
                  readOnlyReason={readOnly ? "" : copy.row.readOnly}
                  info={rowInfo({ row, plannedMinor: planned, totals, when })}
                  menuActions={readOnly ? {} : menuActionsFor(row)}
                  onSet={onSet}
                  onNudge={onNudge}
                  onGestureStart={onGestureStart}
                  onGestureEnd={onGestureEnd}
                  onToggleLock={onToggleLock}
                />
              );
            })}
          </div>
        ))}
      </div>
      {extraAsk && extraSaveRow ? (
        <SheetDialog
          className="ps-extra-dialog"
          title={copy.extraIncome.confirmTitle}
          description={copy.extraIncome.confirmText(fmt.money(extraMinor), fmt.money(plan[extraSaveRow.key]), fmt.money(extraTarget))}
          descriptionHidden
          lead={(
            <ConfirmLead neutral icon={PiggyBank} title={copy.extraIncome.confirmTitle}>
              <p className="lsd-note">{copy.extraIncome.confirmText(fmt.money(extraMinor), fmt.money(plan[extraSaveRow.key]), fmt.money(extraTarget))}</p>
              <p className="lsd-note">{copy.extraIncome.confirmLeft(fmt.money(totals.left - extraMinor))}</p>
              {changed.length ? <p className="lsd-note">{copy.extraIncome.alsoSaves(changed.length)}</p> : null}
            </ConfirmLead>
          )}
          primaryLabel={copy.extraIncome.confirm}
          primaryDisabled={saving}
          isSubmitting={saving}
          quietLabel={copy.extraIncome.cancel}
          onSubmit={confirmExtra}
          onClose={() => setExtraAsk(false)}
        />
      ) : null}
    </section>
  );
}
