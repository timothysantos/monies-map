import { useEffect, useMemo, useState } from "react";

import { requestCardSuggestion } from "./ask-api";
import { cardSuggestionRequestFor, usableCardSuggestion } from "./ask-card-suggestion";

// How long the card's fields must stay still before Ask asks: typing a
// shop name sends one request, not one per letter.
const SETTLE_MS = 500;

// The card suggestion for the Ask card (ask-card-suggestion.js), or null.
// One read-only request per settled set of card fields, made only while the
// card can take a suggestion; a superseded request is aborted and its
// answer dropped. Answers stay in memory for this page only. Any failure is
// simply no suggestion.
export function useAskCardSuggestion({ card, context }) {
  const request = useMemo(() => cardSuggestionRequestFor(card), [card]);
  const key = request ? JSON.stringify(request) : "";
  const [answers, setAnswers] = useState(() => new Map());

  useEffect(() => {
    if (!key || answers.has(key)) {
      return undefined;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      requestCardSuggestion(JSON.parse(key), { signal: controller.signal }).then((suggestion) => {
        if (!controller.signal.aborted) {
          setAnswers((current) => new Map(current).set(key, suggestion));
        }
      });
    }, SETTLE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [answers, key]);

  return key ? usableCardSuggestion(answers.get(key) ?? null, card, context) : null;
}
