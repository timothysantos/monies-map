import "./locked-statement-dialog.css";
import { Eye, EyeOff, Lock } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { importMessages } from "./copy/en-SG-imports";
import { SheetDialog } from "./sheet-dialog";
import { LeadCard } from "./ui/lead-support-detail";

// The question a locked statement asks (design.md "Locked statements"): the
// app's one dialog frame, a sheet above the keyboard on a phone. The typed
// password is read from the field when the person answers and the field is
// emptied at once: it is never in React state, a query key or a URL, and
// nothing here saves it or sends it anywhere (docs/audits/locked-statements.md).
// Escape, a tap outside and the swipe down all skip the file.
//
// `request` is the question (pdf-unlock.js `PasswordRequest`): `wrong` when
// the last try failed, `canTryAgain` false once the tries ran out, when only
// skipping is offered. `isChecking` while the password is being tried.
// `onAnswer` gets `{ password, useForBatch }`, or null to skip.
export function LockedStatementDialog({ request, isChecking = false, onAnswer }) {
  const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));
  const useForOthersRef = useRef(/** @type {HTMLInputElement | null} */ (null));
  const [isVisible, setIsVisible] = useState(false);
  const isOutOfTries = !request.canTryAgain;

  // A wrong try keeps the dialog open: the field is back, ready for another.
  useEffect(() => {
    if (request.wrong && !isOutOfTries) {
      passwordRef.current?.focus();
    }
  }, [request.wrong, request.wrongTries, isOutOfTries]);

  function submit() {
    const input = passwordRef.current;
    const password = input?.value ?? "";
    if (!input || !password) {
      input?.focus();
      return;
    }
    const useForBatch = Boolean(useForOthersRef.current?.checked);
    input.value = "";
    onAnswer({ password, useForBatch });
  }

  return (
    <SheetDialog
      className="locked-statement-dialog"
      title={importMessages.lockedTitle}
      description={importMessages.lockedHint}
      descriptionHidden
      closeLabel={importMessages.lockedClose}
      lead={(
        <LeadCard
          className="sheet-dialog-lead"
          category={{ icon: Lock }}
          title={request.fileName}
        >
          <p className="lsd-note">{importMessages.lockedHint}</p>
        </LeadCard>
      )}
      errorMessage={isOutOfTries ? importMessages.lockedGaveUp(request.maxTries) : request.wrong ? importMessages.lockedWrong : ""}
      primaryLabel={isChecking ? importMessages.lockedOpening : importMessages.lockedOpen}
      primaryDisabled={isChecking}
      hideSubmit={isOutOfTries}
      quietLabel={importMessages.lockedSkip}
      onQuiet={() => onAnswer(null)}
      isSubmitting={isChecking}
      onSubmit={submit}
      onClose={() => onAnswer(null)}
    >
      {isOutOfTries ? null : (
        <>
          <div className="sheet-dialog-field locked-statement-field">
            <label htmlFor="locked-statement-password">{importMessages.lockedFieldLabel}</label>
            <div className="locked-statement-input-row">
              <input
                id="locked-statement-password"
                ref={passwordRef}
                className="table-edit-input"
                type={isVisible ? "text" : "password"}
                // Keeps password managers, autofill and spell check out of it.
                name="statement-file-key"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                inputMode="text"
                enterKeyHint="go"
                data-lpignore="true"
                data-1p-ignore="true"
                data-bwignore="true"
                data-form-type="other"
                aria-invalid={request.wrong || undefined}
                disabled={isChecking}
              />
              <button
                type="button"
                className="icon-action locked-statement-toggle"
                aria-label={isVisible ? importMessages.lockedHidePassword : importMessages.lockedShowPassword}
                aria-pressed={isVisible}
                title={isVisible ? importMessages.lockedHidePassword : importMessages.lockedShowPassword}
                onClick={() => setIsVisible((current) => !current)}
              >
                {isVisible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
              </button>
            </div>
          </div>
          <label className="locked-statement-others">
            <input ref={useForOthersRef} type="checkbox" name="statement-share-key" disabled={isChecking} />
            <span>{importMessages.lockedUseForOthers}</span>
          </label>
        </>
      )}
    </SheetDialog>
  );
}
