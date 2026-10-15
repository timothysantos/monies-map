import * as Popover from "@radix-ui/react-popover";
import { useEffect, useId, useRef, useState } from "react";

import { planStudioCopy } from "./copy/plan-studio-copy";
import { applyChip, parseAmountInput } from "./plan-studio-slider";
import { SheetDialog } from "./sheet-dialog";
import { useIsMobileLayout } from "./use-viewport";

const copy = planStudioCopy.amount;
// The chips, as the amounts they add or take away (minor units).
const CHIP_DELTAS = [500, 1000, 5000, -500, -1000, -5000];

// What a typed amount looks like next to the saved one.
function changeLine(parsed, savedMinor, fmt) {
  if (!parsed.ok) return "";
  if (parsed.minor === savedMinor) return copy.noChange;
  return copy.change(fmt.signed(parsed.minor - savedMinor));
}

export function AmountBody({ inputId, text, error, parsed, savedMinor, fmt, onText, onSubmit, onChip, onResetToSaved, inputRef }) {
  return (
    <div className="ps-amount-body">
      <label className="ps-amount-field" htmlFor={inputId}>
        <span>{copy.field}</span>
        <input
          id={inputId}
          ref={inputRef}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          enterKeyHint="done"
          value={text}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={`${inputId}-info`}
          onChange={(event) => onText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onSubmit();
            }
          }}
        />
      </label>
      <p className="ps-amount-info" id={`${inputId}-info`} aria-live="polite">
        {error ? <span className="ps-amount-error" role="alert">{copy.errors[error]}</span> : <span>{changeLine(parsed, savedMinor, fmt)}</span>}
      </p>
      <p className="ps-amount-saved">{copy.saved(fmt.money(savedMinor))}</p>
      <div className="ps-amount-chips" role="group" aria-label={copy.field}>
        {CHIP_DELTAS.map((delta, index) => (
          <button key={delta} type="button" className="ps-chip" onClick={() => onChip(delta)}>{copy.chips[index]}</button>
        ))}
      </div>
      <button type="button" className="ps-amount-reset" onClick={onResetToSaved}>{copy.resetRow}</button>
    </div>
  );
}

/**
 * The amount a row plans, as a button that opens a small popover (a bottom
 * sheet on a phone) with a field for a more exact amount than the slider can
 * say: dollars and cents, Enter applies, Escape cancels, a refused amount says
 * why, chips add or take away a few dollars, and "Reset to saved" puts the
 * saved amount back in the field. Applying hands the new amount to the studio;
 * nothing is saved until "Save plan".
 */
export function AmountEditor({ label, valueMinor, savedMinor, fmt, disabled = false, display, onApply }) {
  const isPhone = useIsMobileLayout();
  const inputId = useId();
  const inputRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const parsed = parseAmountInput(text);

  function openEditor() {
    setText(fmt.field(valueMinor));
    setError("");
    setOpen(true);
  }

  function close() {
    setOpen(false);
  }

  function submit() {
    const result = parseAmountInput(text);
    if ("reason" in result) {
      setError(result.reason);
      inputRef.current?.focus();
      return;
    }
    onApply(result.minor);
    close();
  }

  function changeText(next) {
    setText(next);
    setError("");
  }

  function chip(delta) {
    const base = parsed.ok ? parsed.minor : valueMinor;
    setText(fmt.field(applyChip(base, delta)));
    setError("");
  }

  // On a phone the sheet's own first field takes focus; a popover is focused here.
  useEffect(() => {
    if (open && !isPhone) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [open, isPhone]);

  const body = (
    <AmountBody
      inputId={inputId}
      text={text}
      error={error}
      parsed={parsed}
      savedMinor={savedMinor}
      fmt={fmt}
      onText={changeText}
      onSubmit={submit}
      onChip={chip}
      onResetToSaved={() => changeText(fmt.field(savedMinor))}
      inputRef={inputRef}
    />
  );
  const trigger = (
    <button
      type="button"
      className="ps-amount"
      aria-label={planStudioCopy.row.amountButton(label)}
      aria-haspopup="dialog"
      aria-expanded={open}
      disabled={disabled}
      data-ps-amount
      onClick={isPhone ? openEditor : undefined}
    >
      {display}
    </button>
  );

  if (isPhone) {
    return (
      <>
        {trigger}
        {open ? (
          <SheetDialog
            className="ps-amount-sheet"
            title={copy.title(label)}
            descriptionHidden
            description={copy.saved(fmt.money(savedMinor))}
            primaryLabel={copy.set}
            quietLabel={copy.cancel}
            errorMessage=""
            onSubmit={submit}
            onClose={close}
          >
            {body}
          </SheetDialog>
        ) : null}
      </>
    );
  }

  return (
    <Popover.Root open={open} onOpenChange={(next) => (next ? openEditor() : close())}>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="ps-pop"
          side="bottom"
          align="end"
          sideOffset={6}
          collisionPadding={12}
          aria-label={copy.title(label)}
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <p className="ps-pop-title">{copy.title(label)}</p>
          {body}
          <div className="ps-pop-actions">
            <button type="button" className="ps-quiet" onClick={close}>{copy.cancel}</button>
            <button type="button" className="ps-primary" onClick={submit}>{copy.set}</button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
