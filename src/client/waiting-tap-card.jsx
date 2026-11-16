import { useEffect, useId, useRef, useState } from "react";
import { Check, Clock } from "lucide-react";

import { tapDayWord, waitingTapCopy as copy } from "./copy/waiting-tap-copy";
import { completeWaitingTap, readTypedAmount, removeWaitingTap } from "./waiting-tap-api";
import "./waiting-tap-card.css";

// The waiting taps at the top of Entries (DOMAIN.md "Waiting Tap"; design.md
// "Waiting tap card"): an Apple Pay payment that reached the app without its
// amount, one line to finish. Save runs the Shortcut's own save, so the
// category guess, habits, trips and the foreign-currency estimate behave as
// for any Apple Pay entry. Lazy: the Entries chunk carries only the import.
// `doneLines` are the taps finished on this visit ({ key, text, personName }):
// a line stays after the refreshed list no longer has the tap.
// `personStyle(name)` gives a person's colour tokens (person-colour.js,
// passed in so this chunk adds no shared module to the first screen).
export function WaitingTapCards({ taps, doneLines = [], today, moneyHidden, focusTapId = "", personStyle, onSaved, onRemoved }) {
  const doneKeys = new Set(doneLines.map((line) => line.key));
  return (
    <section className="waiting-taps" aria-label={copy.label}>
      {doneLines.map((line) => (
        <p key={line.key} className="waiting-tap-done" role="status" data-waiting-tap={line.key} style={personStyle?.(line.personName)}>
          <Check size={16} aria-hidden="true" />
          {line.text}
        </p>
      ))}
      {taps.filter((tap) => !doneKeys.has(tap.id)).map((tap) => (
        <WaitingTapCard
          key={tap.id}
          tap={tap}
          today={today}
          moneyHidden={moneyHidden}
          focus={tap.id === focusTapId}
          personStyle={personStyle}
          onSaved={onSaved}
          onRemoved={onRemoved}
        />
      ))}
    </section>
  );
}

function WaitingTapCard({ tap, today, moneyHidden, focus, personStyle, onSaved, onRemoved }) {
  const currencies = [tap.currency, ...(tap.otherCurrencies ?? [])];
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(currencies[0]);
  const [state, setState] = useState({ busy: "", error: "" });
  const inputId = useId();
  const cardRef = useRef(null);
  const inputRef = useRef(null);

  // Opened from the Shortcut's link or an Ask reminder: this card in view,
  // its amount field ready.
  useEffect(() => {
    if (!focus) {
      return;
    }
    cardRef.current?.scrollIntoView?.({ block: "center" });
    inputRef.current?.focus({ preventScroll: true });
  }, [focus]);

  const line = copy.line({ merchant: tap.merchant, dayWord: tapDayWord(tap.date, today), time: tap.time, accountName: tap.accountName });

  async function save(event) {
    event.preventDefault();
    const typed = readTypedAmount(amount);
    if (!typed) {
      setState({ busy: "", error: copy.needAmount });
      inputRef.current?.focus();
      return;
    }
    setState({ busy: "save", error: "" });
    const result = await completeWaitingTap({ tapId: tap.id, amount: typed, currency }, copy.saveFailed);
    if (!result.ok) {
      setState({ busy: "", error: result.error });
      return;
    }
    onSaved?.(tap, copy.saved(tap.merchant));
  }

  async function remove() {
    setState({ busy: "remove", error: "" });
    const result = await removeWaitingTap(tap.id, copy.removeFailed);
    if (!result.ok) {
      setState({ busy: "", error: result.error });
      return;
    }
    onRemoved?.(tap, copy.removed(tap.merchant));
  }

  return (
    <form
      ref={cardRef}
      className="waiting-tap-card"
      data-waiting-tap={tap.id}
      style={personStyle?.(tap.personName)}
      onSubmit={save}
      noValidate
    >
      <p className="waiting-tap-line">
        <Clock size={16} aria-hidden="true" />
        <span>{line}</span>
      </p>
      <div className="waiting-tap-fields">
        <label className="waiting-tap-amount" htmlFor={inputId}>
          <span className="sr-only">{copy.amountLabel(tap.merchant)}</span>
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            enterKeyHint="done"
            placeholder={moneyHidden ? "" : copy.amountPlaceholder}
            value={amount}
            disabled={Boolean(state.busy)}
            aria-invalid={state.error === copy.needAmount ? "true" : undefined}
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>
        {currencies.length > 1 ? (
          <div className="waiting-tap-currencies" role="group" aria-label={copy.currencyLabel}>
            {currencies.map((code) => (
              <button
                key={code}
                type="button"
                className={`waiting-tap-currency${code === currency ? " is-active" : ""}`}
                aria-pressed={code === currency}
                disabled={Boolean(state.busy)}
                onClick={() => setCurrency(code)}
              >
                {code}
              </button>
            ))}
          </div>
        ) : (
          <span className="waiting-tap-currency-only">{currency}</span>
        )}
        <button type="submit" className="waiting-tap-save" disabled={Boolean(state.busy)}>
          {state.busy === "save" ? copy.saving : copy.save}
        </button>
      </div>
      <div className="waiting-tap-foot">
        {state.error ? <p className="waiting-tap-error" role="alert">{state.error}</p> : <span />}
        <button type="button" className="waiting-tap-remove" disabled={Boolean(state.busy)} onClick={remove}>
          {state.busy === "remove" ? copy.removing : copy.notPayment}
        </button>
      </div>
    </form>
  );
}
