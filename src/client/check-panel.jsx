import { ChevronRight, CircleCheck } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import "./ui/lead-support-detail.css";
import "./check-route.css";
import { buildCheckView, describeCheckChange, nextRowIdAfter, reportTotal } from "./check-model";
import { CheckLinkPairsDialog } from "./check-link-pairs-dialog";
import { CheckLinkTwoDialog } from "./check-link-two-dialog";
import { createCheckOwner } from "./check-data-owner";
import { postTransferLink, postTransferSettle } from "./check-api";
import { checkCopy } from "./copy/check-copy";
import { formatDate, moneyWithCurrency } from "./formatters";
import { todayInAppTimeZone } from "./app-dates";
import { useMoneyPrivacy } from "./money-privacy";
import { forgetReturnToCheck, readReturnToCheck, rememberReturnToCheck } from "./return-to-check";
import { EmptyState, ErrorPanel, InlineError, StateBanner } from "./ui-states";
import { useRouteWorkReport } from "./use-route-work-status";

// The "Check my books" page (docs/flows/check-flow.md). It opens, runs the
// check once and shows what it found in plain words, grouped by what went
// wrong. It only looks: its writes are "This is fine" (and its undo) and, on
// the person's confirmation, the link of clear transfer pairs
// (check-link-pairs-dialog.jsx).
// Nothing runs in the background and nothing is preloaded: the check starts
// because the person opened the page or pressed "Check again".
//
// A problem is fixed where it is when the app already has a dialog for it
// (link two sides, the Transfer details dialog, the correction of a settled
// mistake): the dialog opens over this page and closing it leaves the list
// where it was. Any other fix opens its page, leaving a marker so that page
// shows "‹ Check my books" and this page, when it opens again, puts the
// scroll, the open rows and the line "Fixed. N things left." back
// (docs/flows/check-flow.md, "Fixing and coming back").

// Loaded only when the person opens them.
const CheckTransferDialog = lazy(() => import("./check-transfer-dialog").then((module) => ({ default: module.CheckTransferDialog })));
const SplitCorrectionDialog = lazy(() => import("./split-correction-dialog").then((module) => ({ default: module.SplitCorrectionDialog })));

// How long "Fixed. 3 things left." replaces the "Checking ..." line.
const CHANGE_LINE_MS = 6000;

const OPEN_GROUPS_KEY = "monies-map:check-open-groups";

function readOpenGroups() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(OPEN_GROUPS_KEY) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeOpenGroups(value) {
  try {
    window.localStorage.setItem(OPEN_GROUPS_KEY, JSON.stringify(value));
  } catch {
    // Storage blocked: the choice lasts until the page is left.
  }
}

const formatMoney = (minor, currency) => moneyWithCurrency(minor, currency);

const groupDomId =(key) => `check-group-${key.replace(/[^a-z0-9_]+/gi, "-")}`;

function readStorage() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function CheckPanel({ view, runBackgroundRefresh, fetchRequiredQuery, categories = [], onEntryMutation = undefined, onSplitMutation = undefined }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { areTotalsVisible } = useMoneyPrivacy();
  const [owner] = useState(() => createCheckOwner({ fetchRequiredQuery }));
  const state = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  // Coming back from a page a fix opened: the marker it left (read here, forgotten
  // below, so it serves this one visit only).
  const [returned, setReturned] = useState(() => readReturnToCheck(readStorage()));
  const lastArrivalRef = useRef(returned?.id ?? "");
  const returnHandledRef = useRef(false);
  const [openState, setOpenState] = useState(readOpenGroups);
  const [expanded, setExpanded] = useState(() => new Set(returned?.expanded ?? []));
  const [showHidden, setShowHidden] = useState(false);
  const showHiddenRef = useRef(false);
  showHiddenRef.current = showHidden;
  const panelRef = useRef(null);

  const isChecking = state.status === "loading";
  // The route is ready once its check has answered, with a report or a failure.
  useRouteWorkReport({ ready: state.status === "ready", busy: isChecking });

  // Arriving from the page a fix opened: forget the marker (it serves this one
  // visit). When this page was never left on screen (the person went back before
  // the other page had loaded) it is still mounted, so it reads again and puts
  // itself back here; on a fresh mount the check below is that read.
  useEffect(() => {
    // Still mounted while another page loads: that is leaving, not arriving.
    if (location.pathname !== "/check") {
      return;
    }
    const marker = readReturnToCheck(readStorage());
    if (!marker) {
      return;
    }
    forgetReturnToCheck(readStorage());
    if (marker.id !== lastArrivalRef.current) {
      lastArrivalRef.current = marker.id;
      returnHandledRef.current = false;
      setExpanded(new Set(marker.expanded));
      setReturned(marker);
      void owner.run({ viewId: view.id, includeHidden: showHiddenRef.current });
    }
  }, [location.key, location.pathname, owner, view.id]);

  // The check starts because the page opened (or the person's view changed).
  useEffect(() => {
    const controller = new AbortController();
    void owner.run({ viewId: view.id, includeHidden: showHiddenRef.current, signal: controller.signal });
    return () => controller.abort();
  }, [owner, view.id]);

  const checkAgain = useCallback(() => {
    setExpanded(new Set());
    void owner.run({ viewId: view.id, includeHidden: showHiddenRef.current });
  }, [owner, view.id]);

  const checkView = useMemo(() => (state.report
    ? buildCheckView({
      report: state.report,
      openState,
      expanded,
      showHidden,
      justHiddenId: state.lastHidden?.id ?? "",
      areTotalsVisible,
      formatMoney,
      formatTime: formatDate,
      thisYear: new Date().getFullYear()
    })
    : null), [areTotalsVisible, expanded, openState, showHidden, state.lastHidden, state.report]);

  const toggleGroup = useCallback((group) => {
    setOpenState((current) => {
      const next = { ...current, [group.key]: !group.isOpen };
      writeOpenGroups(next);
      return next;
    });
  }, []);

  const toggleExpanded = useCallback((key) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleHiddenList = useCallback(() => {
    const next = !showHidden;
    setShowHidden(next);
    if (next) {
      void owner.run({ viewId: view.id, includeHidden: true });
    }
  }, [owner, showHidden, view.id]);

  const hideRow = useCallback(async (row) => {
    const finding = state.report?.findings.find((item) => item.id === row.id);
    if (finding && await owner.hide(finding)) {
      void runBackgroundRefresh(() => owner.refresh());
    }
  }, [owner, runBackgroundRefresh, state.report]);

  const showRowAgain = useCallback(async (row) => {
    const finding = state.report?.findings.find((item) => item.id === row.id);
    if (finding && await owner.show(finding)) {
      void runBackgroundRefresh(() => owner.refresh());
    }
  }, [owner, runBackgroundRefresh, state.report]);

  // Focus follows the person: to the Undo that replaced the row they hid, and
  // back to the row they restored.
  const lastHiddenId = state.lastHidden?.id ?? "";
  useEffect(() => {
    if (lastHiddenId) {
      panelRef.current?.querySelector(`[data-hidden-now="${CSS.escape(lastHiddenId)}"] button`)?.focus();
    }
  }, [lastHiddenId]);
  const restoredIdRef = useRef("");
  useEffect(() => {
    if (restoredIdRef.current) {
      const id = restoredIdRef.current;
      restoredIdRef.current = "";
      panelRef.current?.querySelector(`[data-finding-id="${CSS.escape(id)}"] button`)?.focus();
    }
  });

  // Fixing means going to another page: keep where this one stood (scroll, the
  // rows opened with "Show more", how many problems there are) so that page can
  // offer the way back and this one can put itself back.
  const openFix = useCallback((row) => {
    const destination = new URL(row.fix.path, window.location.origin);
    rememberReturnToCheck(readStorage(), {
      id: `${Date.now()}`,
      destPath: destination.pathname,
      checkPath: location.pathname + location.search,
      scrollY: window.scrollY,
      before: state.report ? reportTotal(state.report) : null,
      expanded: [...expanded],
      checkIdx: Number.isFinite(window.history.state?.idx) ? window.history.state.idx : null
    });
    navigate(row.fix.path);
  }, [expanded, location.pathname, location.search, navigate, state.report]);

  // ---- The line after a fix: replaces "Checking ..." for a few seconds -------
  const [changeLine, setChangeLine] = useState("");
  const changeTimerRef = useRef(0);
  const showChange = useCallback((text) => {
    window.clearTimeout(changeTimerRef.current);
    setChangeLine(text);
    if (text) {
      changeTimerRef.current = window.setTimeout(() => setChangeLine(""), CHANGE_LINE_MS);
    }
  }, []);
  useEffect(() => () => window.clearTimeout(changeTimerRef.current), []);

  // Back from another page: the list was read again on opening, so say what
  // changed, and put the scroll back once the rows are there (never after the
  // person scrolls themselves).
  useEffect(() => {
    if (!returned || returnHandledRef.current || state.status !== "ready" || !state.report) {
      return;
    }
    returnHandledRef.current = true;
    showChange(describeCheckChange(returned.before, reportTotal(state.report)));
    if (!returned.scrollY) {
      return;
    }
    let frames = 0;
    let stopped = false;
    const stop = () => { stopped = true; };
    window.addEventListener("wheel", stop, { passive: true, once: true });
    window.addEventListener("touchmove", stop, { passive: true, once: true });
    window.addEventListener("keydown", stop, { once: true });
    const settle = () => {
      if (stopped || frames > 40) return;
      window.scrollTo({ top: returned.scrollY, behavior: "instant" });
      frames += 1;
      if (Math.abs(window.scrollY - returned.scrollY) > 2) {
        window.requestAnimationFrame(settle);
      }
    };
    window.requestAnimationFrame(settle);
  }, [returned, showChange, state.report, state.status]);

  // ---- Fixing here: the dialog the app already has, over this page -----------
  // `fixing` is { row } for the problem whose dialog is open.
  const [fixing, setFixing] = useState(null);
  const fixOpenerRef = useRef(null);
  const openFixHere = useCallback((row) => {
    fixOpenerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setFixing({ row });
  }, []);

  // After a fix the dialog closes; focus goes to the next problem in the same
  // group (so a person can work down a list), else the page title. Waits for
  // the dialog's own focus handling to finish.
  const focusAfterFix = useCallback((nextId) => {
    window.setTimeout(() => window.requestAnimationFrame(() => {
      const next = nextId ? panelRef.current?.querySelector(`[data-finding-id="${CSS.escape(nextId)}"] .check-fix`) : null;
      const target = next ?? panelRef.current?.querySelector("#check-title");
      if (target instanceof HTMLElement) {
        target.focus();
      }
    }), 0);
  }, []);

  // Closing without a fix puts focus back on the button that opened it.
  const closeFixHere = useCallback(() => {
    setFixing(null);
    const opener = fixOpenerRef.current;
    window.setTimeout(() => window.requestAnimationFrame(() => {
      if (opener?.isConnected) {
        opener.focus();
      }
    }), 0);
  }, []);

  // Runs one existing command for a problem: the row leaves at once and comes
  // back if the server refuses (check-data-owner.js `resolveInPlace`); on
  // success the pages that show the same records are told, the list is read
  // again quietly, and the line says what is left. Resolves true when kept.
  const fixHere = useCallback(async (row, write, { mutation = "entry" } = {}) => {
    const finding = state.report?.findings.find((item) => item.id === row.id);
    if (!finding) {
      return false;
    }
    const before = reportTotal(state.report);
    const siblings = checkView?.tiers.flatMap((section) => section.groups).find((group) => group.rows.some((item) => item.id === row.id));
    const nextId = nextRowIdAfter((siblings?.shownRows ?? []).filter((item) => !item.justHidden).map((item) => item.id), row.id);
    const ok = await owner.resolveInPlace(finding, write);
    if (!ok) {
      return false;
    }
    showChange(describeCheckChange(before, reportTotal(owner.getSnapshot().report)));
    const month = row.month ?? todayInAppTimeZone().slice(0, 7);
    const invalidation = { month, invalidateEntries: true, invalidateMonth: true, invalidateSummary: true };
    onEntryMutation?.(invalidation);
    if (mutation === "split") {
      onSplitMutation?.(invalidation);
    }
    void runBackgroundRefresh(() => owner.refresh());
    setFixing(null);
    focusAfterFix(nextId);
    return true;
  }, [checkView, focusAfterFix, onEntryMutation, onSplitMutation, owner, runBackgroundRefresh, showChange, state.report]);

  // "Link these N clear pairs": the dialog lives here, not in the group, so it
  // stays open with its result when the linked pairs leave the list.
  const [linkPairsCount, setLinkPairsCount] = useState(0);
  const linkPairsOpenerRef = useRef(null);
  const openLinkPairs = useCallback((count) => {
    linkPairsOpenerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setLinkPairsCount(count);
  }, []);
  const closeLinkPairs = useCallback(() => {
    setLinkPairsCount(0);
    // Focus goes back to the button that opened it; if that button is gone
    // (everything was linked) it goes to the page title instead of the top of
    // the document. Waits for the dialog's own focus handling to finish.
    const opener = linkPairsOpenerRef.current;
    window.setTimeout(() => window.requestAnimationFrame(() => {
      const target = opener?.isConnected ? opener : panelRef.current?.querySelector("#check-title");
      if (target instanceof HTMLElement) {
        target.focus();
      }
    }), 0);
  }, []);
  const afterLinkPairs = useCallback(() => {
    void runBackgroundRefresh(() => owner.refresh());
  }, [owner, runBackgroundRefresh]);

  const viewing = view.id === "household" ? checkCopy.viewingHousehold : checkCopy.viewingPerson(view.label);
  const hasReport = Boolean(checkView);
  const firstFailure = state.failed && !hasReport;
  const announcement = isChecking
    ? checkCopy.announceChecking
    : firstFailure
      ? checkCopy.errors.loadFailedTitle
      : changeLine || (checkView?.announcement ?? "");

  return (
    <article className="panel check-panel" aria-labelledby="check-title" aria-busy={isChecking} ref={panelRef}>
      <div className="panel-head check-head">
        <div>
          <h2 id="check-title" tabIndex={-1}>{checkCopy.title}</h2>
          <span className="panel-context check-context" data-changed={changeLine ? "true" : "false"}>{changeLine || viewing}</span>
        </div>
        <button type="button" className="check-again" onClick={checkAgain} disabled={isChecking || state.status === "idle"}>
          {isChecking ? checkCopy.checking : checkCopy.checkAgain}
        </button>
      </div>
      <p className="check-intro">{checkCopy.intro}</p>
      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>

      {!hasReport && !firstFailure ? <CheckSkeleton /> : null}
      {firstFailure ? (
        <ErrorPanel
          className="check-error"
          title={checkCopy.errors.loadFailedTitle}
          detail={checkCopy.errors.loadFailedDetail}
          actions={[{ label: checkCopy.errors.retry, onClick: checkAgain, primary: true }]}
        />
      ) : null}

      {hasReport ? (
        <div className={`check-results${isChecking ? " is-checking" : ""}`}>
          {state.failed ? (
            <StateBanner
              tone="butter"
              role="alert"
              title={checkCopy.errors.againFailedTitle}
              detail={checkCopy.errors.againFailedDetail}
              actions={[{ label: checkCopy.errors.retry, onClick: checkAgain, primary: true }]}
            />
          ) : null}
          {state.writeError ? (
            <InlineError message={state.writeError === "hide" ? checkCopy.hidden.hideFailed : state.writeError === "fix" ? checkCopy.inPlace.fixFailed : checkCopy.hidden.restoreFailed} className="check-write-error" />
          ) : null}

          {checkView.isEmpty ? (
            <EmptyState
              className="check-empty"
              icon={<CircleCheck />}
              title={checkView.headline.text}
            >
              {checkView.headline.detail}
            </EmptyState>
          ) : (
            <section className="check-summary" data-tone={checkView.headline.tone} aria-labelledby="check-summary-title">
              <h3 id="check-summary-title" className="check-summary-title">{checkView.headline.text}</h3>
              <p className="check-summary-detail">{checkView.headline.detail}</p>
            </section>
          )}

          {checkView.tiers.map((section) => (
            <section key={section.tier} className="check-tier" data-tone={section.tone} data-tier={section.tier} aria-labelledby={`check-tier-${section.tier}`}>
              <div className="check-tier-head">
                <h3 id={`check-tier-${section.tier}`}>
                  <span>{section.title}</span>
                  <span className="check-count">{section.count}</span>
                </h3>
                <p>{section.detail}</p>
              </div>
              {section.groups.map((group) => (
                <CheckGroup
                  key={group.key}
                  group={group}
                  onToggle={toggleGroup}
                  onToggleExpanded={toggleExpanded}
                  onLinkPairs={openLinkPairs}
                  renderRow={(row) => (
                    <CheckRow
                      key={row.id}
                      row={row}
                      onOpenFix={openFix}
                      onFixHere={openFixHere}
                      onHide={hideRow}
                      onUndo={(item) => {
                        restoredIdRef.current = item.id;
                        void showRowAgain(item);
                      }}
                    />
                  )}
                />
              ))}
            </section>
          ))}

          {checkView.unavailable.length ? (
            <section className="check-unavailable" aria-label={checkCopy.unavailable.title}>
              {checkView.unavailable.map((item) => (
                <div key={item.headingId} className="check-unavailable-row">
                  <div>
                    <strong>{item.heading}</strong>
                    <p>{checkCopy.unavailable.title}</p>
                  </div>
                  <button type="button" className="lsd-quiet" onClick={checkAgain} disabled={isChecking}>{checkCopy.unavailable.retry}</button>
                </div>
              ))}
            </section>
          ) : null}

          {checkView.hiddenToggle ? (
            <div className="check-hidden-toggle">
              <button type="button" className="lsd-quiet" onClick={toggleHiddenList}>{checkView.hiddenToggle}</button>
            </div>
          ) : null}

          {checkView.hidden ? (
            <section className="check-tier check-hidden" data-tone="neutral" aria-labelledby="check-hidden-title">
              <div className="check-tier-head">
                <h3 id="check-hidden-title">
                  <span>{checkCopy.hidden.title}</span>
                  <span className="check-count">{checkView.hidden.count}</span>
                </h3>
                <p>{checkCopy.hidden.detail}</p>
              </div>
              {checkView.hidden.groups.map((group) => (
                <CheckGroup
                  key={group.key}
                  group={group}
                  onToggle={toggleGroup}
                  onToggleExpanded={toggleExpanded}
                  renderRow={(row) => <CheckRow key={row.id} row={row} onShowAgain={showRowAgain} />}
                />
              ))}
            </section>
          ) : null}
        </div>
      ) : null}
      {fixing?.row.inPlace?.type === "link_pair" ? (
        <CheckLinkTwoDialog
          entryIds={fixing.row.inPlace.entryIds}
          areTotalsVisible={areTotalsVisible}
          formatMoney={formatMoney}
          onClose={closeFixHere}
          onConfirm={(pair) => fixHere(fixing.row, () => postTransferLink(pair))}
        />
      ) : null}
      {fixing?.row.inPlace?.type === "transfer" ? (
        <Suspense fallback={null}>
          <CheckTransferDialog
            entryId={fixing.row.inPlace.entryId}
            categories={categories}
            onClose={closeFixHere}
            onLink={(pair) => fixHere(fixing.row, () => postTransferLink(pair))}
            onSettle={(body) => fixHere(fixing.row, () => postTransferSettle(body))}
          />
        </Suspense>
      ) : null}
      {fixing?.row.inPlace?.type === "correct_settled" ? (
        <Suspense fallback={null}>
          <SplitCorrectionDialog
            sourceRecordId={fixing.row.inPlace.recordId}
            onClose={closeFixHere}
            onAdded={() => void fixHere(fixing.row, async () => true, { mutation: "split" })}
          />
        </Suspense>
      ) : null}
      {linkPairsCount > 0 ? (
        <CheckLinkPairsDialog
          owner={owner}
          viewId={view.id}
          pairCount={linkPairsCount}
          areTotalsVisible={areTotalsVisible}
          formatMoney={formatMoney}
          onClose={closeLinkPairs}
          onLinked={afterLinkPairs}
        />
      ) : null}
    </article>
  );
}

// Reserves the height of a typical first result so nothing moves when it lands.
function CheckSkeleton() {
  return (
    <div className="check-skeleton state-skeleton" aria-hidden="true">
      <p className="check-skeleton-title">{checkCopy.checking}</p>
      <p className="state-detail">{checkCopy.checkingDetail}</p>
      <div className="sk sk-lines" />
      <div className="sk sk-row" />
      <div className="sk sk-row" />
      <div className="sk sk-row" />
    </div>
  );
}

function CheckGroup({ group, onToggle, onToggleExpanded, renderRow, onLinkPairs = undefined }) {
  const id = groupDomId(group.key);
  return (
    <div className="check-group" data-group={group.key} data-open={group.isOpen ? "true" : "false"}>
      <h4 className="check-group-heading">
        <button type="button" className="check-group-toggle" aria-expanded={group.isOpen} aria-controls={id} onClick={() => onToggle(group)}>
          <span className="check-group-title">{group.heading}</span>
          <span className="check-count">{group.count}</span>
          <ChevronRight size={18} aria-hidden="true" className="check-chevron" />
        </button>
      </h4>
      <div id={id} className="check-group-body" hidden={!group.isOpen}>
        {group.isOpen ? (
          <>
            {group.incomplete ? <p className="check-note">{checkCopy.group.incomplete}</p> : null}
            {group.notListed ? <p className="check-note">{group.notListed}</p> : null}
            {group.clearPairs && onLinkPairs ? (
              <div className="check-clear-pairs">
                <p className="check-note">{group.clearPairs.explain}</p>
                <button type="button" className="check-fix check-link-pairs-button" aria-label={group.clearPairs.ariaLabel} onClick={() => onLinkPairs(group.clearPairs.count)}>{group.clearPairs.label}</button>
              </div>
            ) : null}
            <ul className="check-items">{group.shownRows.map(renderRow)}</ul>
            {group.moreCount > 0 ? (
              <button type="button" className="lsd-quiet check-more" onClick={() => onToggleExpanded(group.key)}>{checkCopy.group.showMore(group.moreCount)}</button>
            ) : null}
            {group.canShowFewer ? (
              <button type="button" className="lsd-quiet check-more" onClick={() => onToggleExpanded(group.key)}>{checkCopy.group.showFewer}</button>
            ) : null}
            {group.showing ? <p className="check-note">{group.showing}</p> : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

function CheckRow({ row, onOpenFix = undefined, onFixHere = undefined, onHide = undefined, onUndo = undefined, onShowAgain = undefined }) {
  if (row.justHidden) {
    return (
      <li className="check-item check-item-hidden" data-hidden-now={row.id}>
        <span role="status">{checkCopy.hidden.notice}</span>
        <button type="button" className="lsd-quiet" aria-label={checkCopy.hidden.undoFor(row.title)} onClick={() => onUndo?.(row)}>{checkCopy.hidden.undo}</button>
      </li>
    );
  }
  return (
    <li className="check-item" data-finding-id={row.id} data-kind={row.kind}>
      <h5 className="check-item-title">{row.title}</h5>
      <p className="check-item-summary">{row.summary}</p>
      {row.evidence.length ? (
        <ul className="check-evidence">
          {row.evidence.map((line, index) => (
            <li key={index}>
              <span className="check-evidence-label">{line.label}</span>
              {line.detail ? <span className="check-evidence-detail">{line.detail}</span> : null}
              {line.note ? <span className="check-evidence-note">{line.note}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {row.money ? <p className="check-item-money">{row.money}</p> : null}
      <div className="check-item-actions">
        {onShowAgain ? (
          <button type="button" className="check-fix" aria-label={checkCopy.hidden.showAgainFor(row.title)} onClick={() => onShowAgain(row)}>{checkCopy.hidden.showAgain}</button>
        ) : (
          <>
            {row.inPlace ? (
              <>
                <button type="button" className="check-fix" aria-label={checkCopy.item.fixFor(row.inPlace.label, row.title)} onClick={() => onFixHere?.(row)}>{row.inPlace.label}</button>
                <button type="button" className="lsd-quiet check-open" aria-label={checkCopy.item.fixFor(row.openLabel, row.title)} onClick={() => onOpenFix?.(row)}>{row.openLabel}</button>
              </>
            ) : row.fix ? (
              <button type="button" className="check-fix" aria-label={checkCopy.item.fixFor(row.fix.label, row.title)} onClick={() => onOpenFix?.(row)}>{row.fix.label}</button>
            ) : row.fixNote ? (
              <p className="check-item-note">{row.fixNote}</p>
            ) : null}
            <button type="button" className="lsd-quiet check-fine" aria-label={checkCopy.item.thisIsFineFor(row.title)} onClick={() => onHide?.(row)}>{checkCopy.item.thisIsFine}</button>
          </>
        )}
      </div>
    </li>
  );
}
