// Where Ask's conversation scrolls when something new arrives (design.md
// "Ask conversation scroll"). The bottom of the conversation normally sits
// on the chip row, but the item the person must read (the card that was
// just made or changed, or the newest answer) never has its top cut by the
// header: when it is taller than the room left, its top goes just under the
// header instead, so the card's name and amount show while Save is in reach.

const FOCUS_GAP = 8;

/**
 * The scroll offset for a conversation of `scrollHeight` shown `clientHeight`
 * tall, keeping the top of the focus item (`focusTop`, from the top of the
 * content; null for none) in view.
 * @param {{ scrollHeight: number, clientHeight: number, focusTop?: number | null, gap?: number }} input
 */
export function threadScrollTarget({ scrollHeight, clientHeight, focusTop = null, gap = FOCUS_GAP }) {
  const end = Math.max(0, scrollHeight - clientHeight);
  if (focusTop === null || !Number.isFinite(focusTop)) {
    return end;
  }
  return Math.max(0, Math.min(end, focusTop - gap));
}

/**
 * The element to keep in view after an update: the card when it was just
 * made or changed, else the first new element that carries content (not a
 * "Reply from …" caption, a status line, or an empty spacer).
 * @param {{ box: Element, previous: WeakSet<Element>, card: Element | null, cardChanged: boolean }} input
 */
export function findThreadFocus({ box, previous, card, cardChanged }) {
  if (card && cardChanged) {
    return card;
  }
  for (const child of Array.from(box.children)) {
    if (previous.has(child)) continue;
    if (child.matches(".is-source, .is-status") || !child.getBoundingClientRect().height) continue;
    return child;
  }
  return null;
}

/** Remembers which elements were already in the conversation. */
export function rememberThreadChildren(box) {
  const seen = new WeakSet();
  if (box) {
    for (const child of Array.from(box.children)) seen.add(child);
  }
  return seen;
}

/**
 * Scrolls the conversation to its end, unless that would cut the focus
 * item's top: then the focus item's top goes just under the header. The
 * conversation box scrolls on a phone and in the dock; on a wide page the
 * window does.
 * @param {{ box: HTMLElement, end: HTMLElement | null, focus: Element | null, behavior: ScrollBehavior }} input
 */
export function scrollThreadToNews({ box, end, focus, behavior }) {
  const boxScrolls = box.scrollHeight > box.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(box).overflowY);
  if (boxScrolls) {
    const focusTop = focus ? focus.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop : null;
    box.scrollTo({ top: threadScrollTarget({ scrollHeight: box.scrollHeight, clientHeight: box.clientHeight, focusTop }), behavior });
    return;
  }
  if (focus && end) {
    // The window scrolls: where the focus would sit once the end is at the
    // bottom of the screen.
    const shift = end.getBoundingClientRect().bottom - window.innerHeight;
    if (focus.getBoundingClientRect().top - shift < FOCUS_GAP) {
      focus.scrollIntoView?.({ block: "start", behavior });
      return;
    }
  }
  end?.scrollIntoView?.({ block: "end", behavior });
}
