import { useEffect, useMemo, useState } from "react";

import { requestSplitSuggestion } from "./ask-api";
import { splitSuggestionRequestFor, usableSplitSuggestion } from "./ask-split-suggestion";

// How long the card's fields must stay still before Ask asks: typing a
// shop name sends one request, not one per letter.
const SETTLE_MS = 500;

// The split suggestion for the Ask card (ask-split-suggestion.js), or null.
// One read-only request per settled set of card fields, made only while
// the card can take a suggestion; a superseded request is aborted and its
// answer dropped. Answers stay in memory for this page only, so changing a
// field back does not ask again. Any failure is simply no suggestion.
export function useAskSplitSuggestion({ card, context, splitGroups }) {
  const request = useMemo(() => splitSuggestionRequestFor(card, context), [card, context]);
  const key = request ? JSON.stringify(request) : "";
  const [answers, setAnswers] = useState(() => new Map());

  useEffect(() => {
    if (!key || answers.has(key)) {
      return undefined;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      requestSplitSuggestion(JSON.parse(key), { signal: controller.signal }).then((suggestion) => {
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

  return key ? usableSplitSuggestion(answers.get(key) ?? null, splitGroups) : null;
}
