import { ExternalLink, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  buildClaudeCreditNotice,
  isCreditNoticeHidden,
  nextCreditNoticeDismissal,
  readCreditNoticeDismissal,
  validateTopUpAmount,
  writeCreditNoticeDismissal
} from "./claude-credit-model";
import { useClaudeCreditStatus } from "./claude-credit-status";
import { claudeCreditCopy as copy } from "./copy/claude-credit-copy";
import { useMoneyPrivacy } from "./money-privacy";
import { SheetDialog } from "./sheet-dialog";
import { useIsMobileLayout } from "./use-viewport";
import { DetailRow, DetailRows, LeadCard } from "./ui/lead-support-detail";
import { useRouteWorkBusy } from "./use-route-work-status";
// Shipped with Ask and Settings, the two routes that import this module.
import "./claude-credit-notice.css";

// The Claude credit notice (design.md "Claude credit notice"): one calm
// inline notice at the top of the Ask conversation while Claude credits are
// low, used up or capped, with the Claude Console link, "I've topped up"
// and a dismiss for this browser session. Settings shows the same line and
// actions in its Ask and AI section (settings-sections.jsx). Nothing here
// is a modal or a browser alert; the top-up form is the app's own sheet.

function sessionStore() {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

// The dismissed state for this browser session. What shows is derived from
// it and the status on every render; the effect only stores the change (a
// worse state, or fine again, clears it).
function useCreditNoticeDismissal(status) {
  const [dismissed, setDismissed] = useState(() => readCreditNoticeDismissal(sessionStore()));
  const next = nextCreditNoticeDismissal(dismissed, status);
  useEffect(() => {
    if (next !== dismissed) {
      writeCreditNoticeDismissal(sessionStore(), next);
      setDismissed(next);
    }
  }, [dismissed, next]);
  const dismiss = useCallback((state) => {
    writeCreditNoticeDismissal(sessionStore(), state);
    setDismissed(state);
  }, []);
  return [next, dismiss];
}

// The two actions: the Claude Console billing page in a new tab (the app
// cannot buy credit) and "I've topped up".
export function ClaudeCreditActions({ actions, onToppedUp }) {
  return (
    <div className="claude-credit-actions">
      {actions.map((action) => (action.href ? (
        <a key={action.id} className="claude-credit-action" href={action.href} target="_blank" rel="noopener noreferrer">
          {action.label}
          <ExternalLink size={14} aria-hidden="true" />
        </a>
      ) : (
        <button key={action.id} type="button" className="claude-credit-action" onClick={onToppedUp}>
          {action.label}
        </button>
      )))}
    </div>
  );
}

// "I've topped up": the amount bought in US dollars, then Save or Cancel at
// the bottom. A bottom sheet on a phone (Save under the thumb, lifted above
// the keyboard), a small dialog on a wide screen. Open while it shows, so
// no optional work runs under it; closes only when the save succeeded.
export function ClaudeTopUpForm({ onClose, onSave }) {
  const isMobile = useIsMobileLayout();
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const savingRef = useRef(false);
  useRouteWorkBusy(true);

  async function save() {
    if (savingRef.current) {
      return;
    }
    const checked = validateTopUpAmount(amount);
    if (!checked.ok) {
      setError(checked.error);
      return;
    }
    savingRef.current = true;
    setIsSaving(true);
    setError("");
    const result = await onSave(checked.creditUsd);
    savingRef.current = false;
    setIsSaving(false);
    if (result.ok) {
      onClose();
    } else {
      setError(result.error);
    }
  }

  const close = () => {
    if (!savingRef.current) {
      onClose();
    }
  };
  const saveLabel = isSaving ? copy.form.saving : copy.form.save;

  // Lead: what the money is for. Detail: the one field. Cancel and Save are
  // the bottom bar of the shared sheet frame (a sheet on a phone, a small
  // dialog on a wide screen).
  return (
    <SheetDialog
      className={isMobile ? "claude-topup-sheet" : "claude-topup-dialog"}
      title={copy.form.title}
      description={copy.form.description}
      closeLabel={copy.form.close}
      lead={(
        <LeadCard className="sheet-dialog-lead" category={{ icon: Sparkles }} title={copy.regionLabel} />
      )}
      errorMessage={error}
      primaryLabel={saveLabel}
      primaryDisabled={isSaving || !amount.trim()}
      quietLabel={copy.form.cancel}
      isSubmitting={isSaving}
      isDirty={Boolean(amount.trim())}
      onSubmit={save}
      onClose={close}
    >
      <DetailRows label={copy.form.title}>
        <DetailRow label={copy.form.amountLabel}>
          <input
            name="creditUsd"
            type="text"
            inputMode="decimal"
            enterKeyHint="done"
            autoComplete="off"
            value={amount}
            aria-invalid={error ? "true" : undefined}
            onChange={(event) => {
              setAmount(event.target.value);
              setError("");
            }}
          />
        </DetailRow>
      </DetailRows>
    </SheetDialog>
  );
}

// The notice at the top of the Ask conversation. `enabled` turns true once
// the Ask screen is usable: only then is the status read (lazily, through
// the query cache), so it never delays Ask or the first screen.
export function AskClaudeCreditNotice({ queryClient, enabled, fetchRequiredQuery }) {
  const { areTotalsVisible } = useMoneyPrivacy();
  const { status, markToppedUp } = useClaudeCreditStatus({ queryClient, enabled, fetchRequiredQuery });
  const [dismissed, dismiss] = useCreditNoticeDismissal(status);
  const [formOpen, setFormOpen] = useState(false);
  const notice = buildClaudeCreditNotice(status, { areTotalsVisible });
  const shown = notice && !isCreditNoticeHidden(notice, dismissed);

  return (
    <>
      {shown ? (
        <section className={`claude-credit-notice is-${notice.tone}`} data-credit-state={notice.state} aria-label={copy.regionLabel}>
          <p>{notice.text}</p>
          <button
            type="button"
            className="claude-credit-dismiss"
            aria-label={notice.dismissLabel}
            onClick={(event) => {
              // The button goes with the notice: keep focus on the conversation.
              const log = event.currentTarget.closest('[role="log"]');
              dismiss(notice.state);
              if (log instanceof HTMLElement) {
                window.requestAnimationFrame(() => {
                  if (!document.activeElement || document.activeElement === document.body) log.focus({ preventScroll: true });
                });
              }
            }}
          >
            <X size={16} aria-hidden="true" />
          </button>
          <ClaudeCreditActions actions={notice.actions} onToppedUp={() => setFormOpen(true)} />
        </section>
      ) : null}
      {formOpen ? <ClaudeTopUpForm onClose={() => setFormOpen(false)} onSave={markToppedUp} /> : null}
    </>
  );
}
