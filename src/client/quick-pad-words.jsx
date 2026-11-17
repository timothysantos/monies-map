import { useRef, useState } from "react";

import { AskChangeCard } from "./ask-turn-cards";
import { requestAskTurn, runChangeSteps } from "./ask-turn-api";
import { cashPadCopy as copy } from "./copy/cash-pad-copy";

// The quick pad's one words box (design.md "Cash pad", "Words later";
// DOMAIN.md "Quick Entry"): the person types or dictates what a quick
// payment was ("dinner ramen split with joyce"). It goes through Ask's turn
// route with that entry in focus (`words: true`), so the server, not the
// model, resolves the name, category, person and split, and with AI off the
// rules read it. The answer is Ask's own change card, shown here in place
// with one Save; a question back shows its chips; nothing is saved without
// Save, through the card's existing commands, and Undo takes it back.
// Lives in Ask's lazy chunk with the pad.

let nextId = 0;

/**
 * @param {{
 *   entryId: string,
 *   personId: string,
 *   month: string,
 *   otherName?: string,
 *   autoFocus?: boolean,
 *   onSaved?: (change: any) => void,
 *   onUndone?: (change: any) => void
 * }} props
 */
export function QuickPadWords({ entryId, personId, month, otherName = "", autoFocus = false, onSaved = () => {}, onUndone = () => {} }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState(/** @type {any} */ (null));
  const historyRef = useRef(/** @type {{ role: "user" | "app", text: string }[]} */ ([]));
  const inputRef = useRef(/** @type {HTMLInputElement | null} */ (null));

  async function send(words) {
    const said = String(words ?? "").replace(/\s+/g, " ").trim();
    if (!said || busy) return;
    setBusy(true);
    setAnswer(null);
    const turn = await requestAskTurn({
      text: said,
      history: historyRef.current.slice(-4),
      viewId: personId,
      scope: "direct_plus_shared",
      month,
      page: "ask",
      focus: { kind: "saved_entry", entryId, words: true }
    });
    setBusy(false);
    const reply = turn.ok ? turn.reply : null;
    if (!reply) {
      setAnswer({ kind: "note", text: copy.words.failed });
      return;
    }
    historyRef.current = [...historyRef.current, { role: "user", text: said }];
    if (reply.kind === "change") {
      nextId += 1;
      setText("");
      setAnswer({ kind: "change", item: { id: `quick-words-${nextId}`, change: reply.change, status: "draft" }, assumptions: reply.assumptions ?? [] });
    } else if (reply.kind === "clarify") {
      historyRef.current = [...historyRef.current, { role: "app", text: reply.question }];
      setAnswer({ kind: "clarify", question: reply.question, options: reply.options ?? [] });
    } else if (reply.kind === "note") {
      setAnswer({ kind: "note", text: reply.text });
    } else {
      setAnswer({ kind: "note", text: copy.words.other });
    }
  }

  async function save() {
    if (answer?.kind !== "change" || answer.item.status !== "draft") return;
    const { change } = answer.item;
    setAnswer((current) => ({ ...current, item: { ...current.item, status: "saving" } }));
    const result = await runChangeSteps(change.save);
    if (!result.ok) {
      setAnswer((current) => ({ ...current, item: { ...current.item, status: "draft" }, error: result.error }));
      return;
    }
    setAnswer((current) => ({ ...current, item: { ...current.item, status: "saved", result: result.result }, error: "" }));
    onSaved(change);
  }

  async function undo() {
    if (answer?.kind !== "change" || answer.item.status !== "saved") return;
    const { change, result: saved } = answer.item;
    setAnswer((current) => ({ ...current, item: { ...current.item, status: "undoing" } }));
    const result = await runChangeSteps(change.undo, { result: saved ?? null });
    if (!result.ok) {
      setAnswer((current) => ({ ...current, item: { ...current.item, status: "saved" }, error: result.error }));
      return;
    }
    setAnswer((current) => ({ ...current, item: { ...current.item, status: "undone" }, error: "" }));
    onUndone(change);
  }

  const saving = answer?.kind === "change" && (answer.item.status === "saving" || answer.item.status === "undoing");
  const settled = answer?.kind === "change" && answer.item.status !== "draft" && answer.item.status !== "saving";
  return (
    <div className="quick-words">
      {answer?.kind === "change" && answer.item.status !== "undone" ? null : (
        <form className="cash-pad-note" onSubmit={(event) => { event.preventDefault(); void send(text); }}>
          <input
            ref={inputRef}
            autoFocus={autoFocus}
            className="cash-pad-note-input"
            value={text}
            maxLength={200}
            enterKeyHint="send"
            placeholder={copy.words.placeholder(otherName)}
            aria-label={copy.words.label}
            onChange={(event) => setText(event.target.value)}
          />
          <button type="submit" className="cash-pad-chip" disabled={busy || !text.trim()}>{busy ? copy.words.reading : copy.words.send}</button>
        </form>
      )}
      {answer?.kind === "note" ? <p className="cash-pad-hint" role="status">{answer.text}</p> : null}
      {answer?.kind === "clarify" ? (
        <div className="quick-words-question" role="group" aria-label={answer.question}>
          <p className="cash-pad-hint">{answer.question}</p>
          {answer.options.length ? (
            <div className="cash-pad-chips">
              {answer.options.map((option) => (
                <button key={option} type="button" className="cash-pad-chip" disabled={busy} onClick={() => void send(option)}>{option}</button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {answer?.kind === "change" ? (
        <>
          {answer.item.status === "undone" ? <p className="cash-pad-hint" role="status">{copy.words.undone}</p> : (
            <div className="quick-words-card">
              <AskChangeCard
                item={answer.item}
                busy={saving}
                settled={settled}
                onSave={() => void save()}
                onDiscard={() => setAnswer(null)}
                onUndo={() => void undo()}
                onConfirm={undefined}
                onRule={undefined}
                onOpen={undefined}
                onChooseTransfer={undefined}
              />
            </div>
          )}
          {answer.item.status === "draft" && answer.assumptions.length ? (
            <p className="cash-pad-hint">{answer.assumptions.map((line) => line.text).join(" ")}</p>
          ) : null}
          {answer.error ? <p className="cash-pad-error" role="alert">{answer.error}</p> : null}
        </>
      ) : null}
    </div>
  );
}
