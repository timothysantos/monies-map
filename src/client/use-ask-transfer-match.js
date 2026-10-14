import { useEffect, useMemo, useState } from "react";

import { requestTransferMatches } from "./ask-api";
import { resolveTransferMatch, transferMatchRequestFor } from "./ask-transfer-match";

// How long the card's fields must stay still before Ask looks: typing an
// amount sends one request, not one per digit.
const SETTLE_MS = 400;

// The other-side candidates for an Ask draft transfer
// (ask-transfer-match.js), or null while there is nothing to show. One
// read-only request per settled amount, date, wallet and direction; a
// superseded request is aborted and its answer dropped. Answers stay in
// memory for this page only. Any failure is simply no candidates.
export function useAskTransferMatch({ card }) {
  const request = useMemo(() => transferMatchRequestFor(card), [card]);
  const key = request ? JSON.stringify(request) : "";
  const [answers, setAnswers] = useState(() => new Map());

  useEffect(() => {
    if (!key || answers.has(key)) {
      return undefined;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      requestTransferMatches(JSON.parse(key), { signal: controller.signal }).then((candidates) => {
        if (!controller.signal.aborted) {
          setAnswers((current) => new Map(current).set(key, candidates));
        }
      });
    }, SETTLE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [answers, key]);

  const candidates = key ? answers.get(key) ?? null : null;
  return useMemo(() => (candidates && card ? resolveTransferMatch(card, candidates) : null), [candidates, card]);
}
