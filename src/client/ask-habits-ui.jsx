import { Check, ChevronDown, ChevronRight, Undo2, X } from "lucide-react";
import { useState } from "react";

import { askHabitsCopy } from "./copy/ask-habits-copy";

const copy = askHabitsCopy;

// When a line was done: "Today, 6:42 pm", "Yesterday, 9:05 am" or "12 Oct,
// 7:30 pm", in the browser's own time zone.
export function formatDoneWhen(isoTime, now = new Date()) {
  const when = new Date(isoTime);
  if (Number.isNaN(when.getTime())) {
    return "";
  }
  const dayStart = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const daysAgo = Math.round((dayStart(now) - dayStart(when)) / 86_400_000);
  const day = daysAgo === 0 ? copy.done.today : daysAgo === 1 ? copy.done.yesterday : when.toLocaleDateString("en-SG", { day: "numeric", month: "short" });
  return copy.done.when(day, when.toLocaleTimeString("en-SG", { hour: "numeric", minute: "2-digit" }));
}

// The one quiet suggestion under an entry's card: what its habits say, with
// a tick to do it and a cross for "not this time". It never moves anything
// by itself and never asks twice.
export function AskSuggestionRow({ suggestion, busy, error, onApply, onDismiss }) {
  if (!suggestion) {
    return null;
  }
  return (
    <div className="ask-habit-row" role="group" aria-label={copy.suggestion.group} data-ask-habit-suggestion>
      <p className="ask-habit-text">{suggestion.text}</p>
      <div className="ask-habit-actions">
        <button type="button" className="ask-habit-button is-apply" aria-label={copy.suggestion.apply} title={copy.suggestion.apply} disabled={busy === "apply"} onClick={onApply}>
          <Check size={18} aria-hidden="true" />
        </button>
        <button type="button" className="ask-habit-button" aria-label={copy.suggestion.dismiss} title={copy.suggestion.dismiss} disabled={busy === "apply"} onClick={onDismiss}>
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      {error ? <p className="ask-habit-error" role="alert">{error}</p> : null}
    </div>
  );
}

// What Ask did by itself to this entry, right under its card, with Undo.
export function AskDoneInline({ items, busy, error, onUndo }) {
  const live = items.filter((item) => !item.undone);
  if (!live.length) {
    return null;
  }
  return (
    <div className="ask-habit-row is-done" role="group" aria-label={copy.done.inlineLabel} data-ask-done-inline>
      <ul className="ask-habit-lines">
        {live.map((item) => (
          <li key={item.id}>
            <span className="ask-habit-text">{item.summary}</span>
            <button type="button" className="ask-habit-undo" disabled={Boolean(busy)} onClick={() => void onUndo(item)}>
              <Undo2 size={14} aria-hidden="true" />
              {busy === item.id ? copy.done.undoing : copy.done.undo}
            </button>
          </li>
        ))}
      </ul>
      {error ? <p className="ask-habit-error" role="alert">{error}</p> : null}
    </div>
  );
}

// The last 30 days of what Ask did by itself: what, which entry, when, Undo,
// and Stop doing this for the habit behind it. Folded until opened.
export function AskDoneForYou({ items, busy, error, onUndo, onStop }) {
  const [open, setOpen] = useState(false);
  if (!items.length) {
    return null;
  }
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <section className="ask-done" aria-label={copy.done.title} data-ask-done-list>
      <button type="button" className="ask-done-toggle" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <span className="ask-done-title">{copy.done.title}</span>
        <span className="ask-done-count">{copy.done.count(items.length)}</span>
        <Chevron size={16} aria-hidden="true" />
      </button>
      {open ? (
        <div className="ask-done-body">
          <p className="ask-done-hint">{copy.done.hint}</p>
          <ul className="ask-done-items">
            {items.map((item) => (
              <li key={item.id} className={`ask-done-item${item.undone ? " is-undone" : ""}`} data-done-kind={item.kind}>
                <div className="ask-done-main">
                  <strong>{item.summary}</strong>
                  <small>{item.entryDescription} · {formatDoneWhen(item.at)}</small>
                </div>
                {item.undone ? (
                  <span className="ask-done-state">{copy.done.undone}</span>
                ) : (
                  <div className="ask-done-actions">
                    <button type="button" className="ask-habit-undo" disabled={Boolean(busy)} onClick={() => void onUndo(item)}>
                      <Undo2 size={14} aria-hidden="true" />
                      {busy === item.id ? copy.done.undoing : copy.done.undo}
                    </button>
                    {item.habitId ? (
                      <button type="button" className="ask-habit-stop" disabled={Boolean(busy)} onClick={() => void onStop(item)}>
                        {copy.done.stop}
                      </button>
                    ) : null}
                  </div>
                )}
              </li>
            ))}
          </ul>
          {error ? <p className="ask-habit-error" role="alert">{error}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
