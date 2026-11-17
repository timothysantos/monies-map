import { useEffect, useState } from "react";

import { flushCashQueue, readCashQueue, removeWaitingCash, subscribeCashQueue } from "./cash-queue";
import { savedWhat } from "./cash-pad-model";
import { cashPadCopy as copy } from "./copy/cash-pad-copy";

// What is waiting to send on this phone (cash-queue.js), at the end of Ask's
// conversation: the same list, words and Remove the quick pad shows, so a
// card saved here with no connection stays in sight until it has gone
// (docs/flows/ask-flow.md "No connection"). The App sends the list when the
// connection returns; Send now tries at once.
export function AskWaitingList({ areTotalsVisible, onSent }) {
  const [waiting, setWaiting] = useState(() => readCashQueue());
  const [message, setMessage] = useState("");
  useEffect(() => subscribeCashQueue(setWaiting), []);

  async function sendNow() {
    setMessage("");
    const count = await flushCashQueue({ onSaved: onSent });
    if (count) setMessage(copy.sent(count));
  }

  if (!waiting.length) {
    return message ? <p className="ask-note" role="status">{message}</p> : null;
  }
  return (
    <section className="cash-pad-waiting ask-waiting" aria-label={copy.waitingTitle} data-ask-waiting>
      <p className="cash-pad-eyebrow">{copy.waitingTitle}</p>
      <p className="cash-pad-hint">{copy.waitingDetail}</p>
      <ul>
        {waiting.map((item) => (
          <li key={item.requestId}>
            <span>
              {savedWhat(item.label, areTotalsVisible)}
              {item.error ? <small className="cash-pad-waiting-error">{copy.notSent(item.error)}</small> : null}
            </span>
            <button type="button" className="cash-pad-link" onClick={() => removeWaitingCash(item.requestId)}>{copy.remove}</button>
          </li>
        ))}
      </ul>
      <button type="button" className="cash-pad-link" onClick={() => void sendNow()}>{copy.sendNow}</button>
      {message ? <p className="cash-pad-hint" role="status">{message}</p> : null}
    </section>
  );
}
