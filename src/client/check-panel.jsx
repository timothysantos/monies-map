import { ChevronRight, CircleCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useNavigate } from "react-router-dom";

import "./ui/lead-support-detail.css";
import "./check-route.css";
import { buildCheckView } from "./check-model";
import { createCheckOwner } from "./check-data-owner";
import { checkCopy } from "./copy/check-copy";
import { formatDate, moneyWithCurrency } from "./formatters";
import { useMoneyPrivacy } from "./money-privacy";
import { EmptyState, ErrorPanel, InlineError, StateBanner } from "./ui-states";
import { useRouteWorkReport } from "./use-route-work-status";

// The "Check my books" page (docs/flows/check-flow.md). It opens, runs the
// check once and shows what it found in plain words, grouped by what went
// wrong. Read-only: the one thing it writes is "This is fine" (and its undo).
// Nothing runs in the background and nothing is preloaded: the check starts
// because the person opened the page or pressed "Check again".

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

const groupDomId = (key) => `check-group-${key.replace(/[^a-z0-9_]+/gi, "-")}`;

export function CheckPanel({ view, runBackgroundRefresh, fetchRequiredQuery }) {
  const navigate = useNavigate();
  const { areTotalsVisible } = useMoneyPrivacy();
  const [owner] = useState(() => createCheckOwner({ fetchRequiredQuery }));
  const state = useSyncExternalStore(owner.subscribe, owner.getSnapshot, owner.getSnapshot);
  const [openState, setOpenState] = useState(readOpenGroups);
  const [expanded, setExpanded] = useState(() => new Set());
  const [showHidden, setShowHidden] = useState(false);
  const showHiddenRef = useRef(false);
  showHiddenRef.current = showHidden;
  const panelRef = useRef(null);

  const isChecking = state.status === "loading";
  // The route is ready once its check has answered, with a report or a failure.
  useRouteWorkReport({ ready: state.status === "ready", busy: isChecking });

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
      formatMoney: (minor, currency) => moneyWithCurrency(minor, currency),
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

  const openFix = useCallback((row) => navigate(row.fix.path), [navigate]);

  const viewing = view.id === "household" ? checkCopy.viewingHousehold : checkCopy.viewingPerson(view.label);
  const hasReport = Boolean(checkView);
  const firstFailure = state.failed && !hasReport;
  const announcement = isChecking
    ? checkCopy.announceChecking
    : firstFailure
      ? checkCopy.errors.loadFailedTitle
      : checkView?.announcement ?? "";

  return (
    <article className="panel check-panel" aria-labelledby="check-title" aria-busy={isChecking} ref={panelRef}>
      <div className="panel-head check-head">
        <div>
          <h2 id="check-title">{checkCopy.title}</h2>
          <span className="panel-context">{viewing}</span>
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
            <InlineError message={state.writeError === "hide" ? checkCopy.hidden.hideFailed : checkCopy.hidden.restoreFailed} className="check-write-error" />
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
                  renderRow={(row) => (
                    <CheckRow
                      key={row.id}
                      row={row}
                      onOpenFix={openFix}
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

function CheckGroup({ group, onToggle, onToggleExpanded, renderRow }) {
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

function CheckRow({ row, onOpenFix = undefined, onHide = undefined, onUndo = undefined, onShowAgain = undefined }) {
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
            {row.fix ? (
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
