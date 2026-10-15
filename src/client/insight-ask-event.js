// "Ask about this" on a Money insights line (design.md "Insight questions";
// docs/flows/ask-flow.md "Insight questions"). The line asks the shell to
// open Ask with it through a window event, so no Ask code enters the first
// screen: App.jsx opens the Ask page on a phone, or the Ask panel beside
// the page on a wider screen, and Ask builds the answer card from this.

export const ASK_INSIGHT_EVENT = "monies:ask-insight";

/**
 * The insight as Ask needs it, nothing more of the page: the line as it
 * reads, its think line, the signal's primary figure and what it is based
 * on (money-signals/types.ts, SignalBasis).
 * @param {{ key: string, kind: string, numbers?: { primaryMinor?: number }, phrasings?: Array<{ think?: string }>, basis?: object }} signal
 * @param {{ fact: string, think?: string }} line
 */
export function askAboutInsight(signal, line) {
  window.dispatchEvent(new CustomEvent(ASK_INSIGHT_EVENT, {
    detail: {
      insight: {
        key: signal.key,
        kind: signal.kind,
        fact: line.fact,
        think: line.think ?? signal.phrasings?.[0]?.think ?? "",
        primaryMinor: signal.numbers?.primaryMinor ?? null,
        basis: signal.basis ?? { lines: [] }
      }
    }
  }));
}

// An insight line is itself the trigger of the figure menu (figure-menu.js,
// fig "insight"): choosing its Ask about this fires this event on the line,
// and the line asks Ask as the removed "Ask about this" link did.
export const INSIGHT_LINE_ASK_EVENT = "monies:insight-line-ask";

/**
 * Makes a line's menu choice run the Ask hand-off for its signal and line.
 * Returns the unbind function (an effect's cleanup).
 * @param {EventTarget} node
 * @param {Parameters<typeof askAboutInsight>[0]} signal
 * @param {Parameters<typeof askAboutInsight>[1]} line
 */
export function bindInsightLine(node, signal, line) {
  const onAsk = () => askAboutInsight(signal, line);
  node.addEventListener(INSIGHT_LINE_ASK_EVENT, onAsk);
  return () => node.removeEventListener(INSIGHT_LINE_ASK_EVENT, onAsk);
}
