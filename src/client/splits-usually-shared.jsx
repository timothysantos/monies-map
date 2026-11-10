import "./splits-usually-shared.css";
import * as Dialog from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { usuallySharedCopy as copy } from "./copy/splits-usually-shared-copy";
import { moniesClient } from "./monies-client-service";
import { PrivateMoney } from "./money-privacy";
import { SheetSwipeDismiss } from "./sheet-swipe";
import { BottomActions, MetaChip } from "./ui/lead-support-detail";
import { useIsMobileLayout } from "./use-viewport";
import { useKeyboardInset } from "./use-keyboard-inset";
import {
  addUsualToSplits,
  getUsuallyShared,
  removeAddedFromSplits,
  USUALLY_SHARED_QUERY_KEY
} from "./usually-shared-api";
import {
  buildAddBody,
  figurePeriod,
  groupsAfterAdd,
  needsConfirm,
  refusedReasons,
  tickedEntries,
  undoBody,
  NON_GROUP_ID
} from "./usually-shared-model";

const { format: formatService } = moniesClient;

// "Usually shared, not on Splits yet" (DOMAIN.md "Usually Shared"): past
// expenses that look like the ones their payer usually puts on Splits, one
// card per shop. The server decides every group (the same rule that suggests
// the usual split for one entry); this section only lets the person untick
// entries and add a shop's ticked entries with that shop's usual split, with
// Undo after. Nothing is added by itself. It renders nothing until the list
// has something in it. On a phone it is one count row that opens a sheet.
export function SplitsUsuallyShared({ viewId, readOnly = false, fetchRequiredQuery = undefined, onChanged = undefined }) {
  const queryClient = useQueryClient();
  const isMobile = useIsMobileLayout();
  const [groups, setGroups] = useState(null);
  const [open, setOpen] = useState(false);
  // Entry ids the person unticked, by group key.
  const [unticked, setUnticked] = useState({});
  const [confirming, setConfirming] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState("");
  const [content, setContent] = useState(null);
  const generation = useRef(0);
  useKeyboardInset(content);

  const load = useCallback(async () => {
    generation.current += 1;
    const mine = generation.current;
    try {
      const fetchList = fetchRequiredQuery
        ?? ((options) => queryClient.fetchQuery({ queryKey: options.queryKey, queryFn: options.fetcher, retry: false, staleTime: 0 }));
      const data = await fetchList({
        queryKey: [...USUALLY_SHARED_QUERY_KEY, viewId],
        signal: undefined,
        abortMessage: "Usually shared request aborted.",
        fetcher: ({ signal }) => getUsuallyShared(signal, copy.loadFailed)
      });
      if (mine === generation.current) setGroups(data?.groups ?? []);
    } catch {
      // The list is only a convenience: a failed read shows nothing.
      if (mine === generation.current) setGroups((current) => current ?? []);
    }
  }, [fetchRequiredQuery, queryClient, viewId]);

  useEffect(() => {
    if (!readOnly) void load();
  }, [load, readOnly]);

  // A later visit reads the list again, never a stale one.
  const forget = () => queryClient.removeQueries({ queryKey: USUALLY_SHARED_QUERY_KEY });

  const toggleEntry = (groupKey, entryId) => setUnticked((current) => {
    const next = new Set(current[groupKey] ?? []);
    if (next.has(entryId)) next.delete(entryId); else next.add(entryId);
    return { ...current, [groupKey]: next };
  });

  async function add(group, { confirmed = false } = {}) {
    const ticked = tickedEntries(group, unticked[group.key]);
    if (!ticked.length || busy) return;
    if (needsConfirm(ticked.length) && !confirmed) {
      setConfirming(group.key);
      return;
    }
    setBusy(group.key);
    setError("");
    setNotice(null);
    try {
      const result = await addUsualToSplits(buildAddBody(group, unticked[group.key], { confirmed }), copy.failed);
      forget();
      setConfirming("");
      setGroups((current) => groupsAfterAdd(current ?? [], group.key, result));
      const reasons = refusedReasons(result);
      if (result.addedCount > 0) {
        setNotice({ kind: "added", count: result.addedCount, undo: undoBody(result), reasons, refusedCount: result.refused.length });
        onChanged?.();
      } else {
        setError(reasons.join(" ") || copy.failed);
      }
    } catch (failure) {
      setError(failure instanceof Error && failure.message ? failure.message : copy.failed);
    } finally {
      setBusy("");
    }
  }

  async function undo() {
    if (!notice?.undo || busy) return;
    setBusy("undo");
    setError("");
    try {
      await removeAddedFromSplits(notice.undo, copy.undoFailed);
      forget();
      setNotice({ kind: "undone" });
      onChanged?.();
      await load();
    } catch (failure) {
      setError(failure instanceof Error && failure.message ? failure.message : copy.undoFailed);
    } finally {
      setBusy("");
    }
  }

  if (readOnly || !groups) return null;
  const entryCount = groups.reduce((sum, group) => sum + group.entries.length, 0);
  if (!entryCount && !notice && !error) return null;

  const list = (
    <div className="split-usually-list">
      {groups.map((group) => (
        <UsuallySharedGroup
          key={group.key}
          group={group}
          unticked={unticked[group.key]}
          confirming={confirming === group.key}
          busy={busy}
          onToggle={(entryId) => toggleEntry(group.key, entryId)}
          onAdd={(options) => void add(group, options)}
          onCancelConfirm={() => setConfirming("")}
        />
      ))}
    </div>
  );
  const messages = (
    <>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {notice?.kind === "added" ? (
        <div className="split-usually-notice" role="status">
          <span>
            {copy.added(notice.count)}
            {notice.refusedCount ? ` ${copy.notAdded(notice.refusedCount)} ${notice.reasons.join(" ")}` : ""}
          </span>
          <button type="button" className="lsd-quiet" disabled={Boolean(busy)} onClick={() => void undo()}>
            {busy === "undo" ? copy.undoing : copy.undo}
          </button>
        </div>
      ) : null}
      {notice?.kind === "undone" ? <p className="split-usually-notice" role="status">{copy.undone}</p> : null}
    </>
  );

  return (
    <section className="split-usually-shared" aria-label={copy.title}>
      {entryCount ? (
        <div className="split-match-inbox-callout split-usually-callout">
          <div>
            <strong>{copy.title}</strong>
            <p>{copy.summary(entryCount, groups.length)}</p>
          </div>
          <button type="button" className="dialog-primary" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
            {open && !isMobile ? copy.hide : copy.review}
          </button>
        </div>
      ) : null}
      {!isMobile ? <>{open ? list : null}{messages}</> : messages}
      {isMobile ? (
        <Dialog.Root open={open} onOpenChange={setOpen}>
          <Dialog.Portal>
            <Dialog.Overlay className="note-dialog-overlay" />
            <Dialog.Content ref={setContent} className="note-dialog-content split-dialog-content split-list-sheet split-usually-sheet">
              <SheetSwipeDismiss onClose={() => setOpen(false)} />
              <div className="note-dialog-head split-dialog-head">
                <div>
                  <Dialog.Title>{copy.sheetTitle}</Dialog.Title>
                  <Dialog.Description>{copy.sheetHint}</Dialog.Description>
                </div>
              </div>
              <div className="split-list-sheet-body" data-sheet-body>
                {list}
                {messages}
              </div>
              <BottomActions className="is-sheet-bar split-list-sheet-actions" primaryLabel={copy.close} onPrimary={() => setOpen(false)} />
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      ) : null}
    </section>
  );
}

function UsuallySharedGroup({ group, unticked, confirming, busy, onToggle, onAdd, onCancelConfirm }) {
  const ticked = tickedEntries(group, unticked);
  const isBusy = busy === group.key;
  return (
    <article className="split-usually-group" data-usually-shop={group.shopName}>
      <div className="split-usually-head">
        <div className="split-usually-title">
          <strong>{group.shopName}</strong>
          <span>{copy.entriesCount(group.entries.length)}</span>
        </div>
        <MetaChip person={group.ownerName}>{group.ownerName}</MetaChip>
        <span
          className="split-usually-total"
          data-fig="spent"
          data-fig-ids={group.entries.map((entry) => entry.id).join(" ")}
          data-fig-period={figurePeriod(group)}
          data-fig-name={group.shopName}
          tabIndex={0}
          role="button"
        >
          <PrivateMoney>{formatService.moneyWithCurrency(group.totalMinor, group.currency)}</PrivateMoney>
        </span>
      </div>
      <p className="split-usually-detail">
        {copy.usually({
          ownerName: group.ownerName,
          otherPersonName: group.otherPersonName,
          groupName: group.groupName,
          basisPoints: group.basisPoints,
          inGroup: group.groupId !== NON_GROUP_ID
        })}{" "}
        {copy.evidence(group)}
      </p>
      <ul className="split-usually-entries">
        {group.entries.map((entry) => (
          <li key={entry.id}>
            <label>
              <input
                type="checkbox"
                checked={!(unticked?.has(entry.id))}
                onChange={() => onToggle(entry.id)}
                aria-label={copy.includeEntry(entry.description, formatService.formatDateOnly(entry.date))}
              />
              <span className="split-usually-entry-date">{formatService.formatDateOnly(entry.date)}</span>
              <span className="split-usually-entry-amount"><PrivateMoney>{formatService.moneyWithCurrency(entry.amountMinor, entry.currency)}</PrivateMoney></span>
            </label>
          </li>
        ))}
      </ul>
      <div className="split-usually-actions">
        {confirming ? (
          <>
            <span className="split-usually-confirm-hint">{copy.confirmHint(ticked.length)}</span>
            <button type="button" className="lsd-quiet" disabled={isBusy} onClick={onCancelConfirm}>{copy.cancel}</button>
            <button type="button" className="lsd-primary" disabled={isBusy || !ticked.length} onClick={() => onAdd({ confirmed: true })}>
              {isBusy ? copy.adding : copy.confirmAll(ticked.length)}
            </button>
          </>
        ) : (
          <button type="button" className="lsd-primary" disabled={Boolean(busy) || !ticked.length} onClick={() => onAdd({})}>
            {isBusy ? copy.adding : copy.add(ticked.length)}
          </button>
        )}
      </div>
    </article>
  );
}
