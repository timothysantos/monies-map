// Keeps the saved card in step with what Ask did by itself (or undid) to its
// entry, without a reload: the card shows the entry's category and whether
// it is on Splits. Pure; a line about another entry changes nothing.

function isFor(card, item) {
  return Boolean(card) && card.status === "saved" && card.saved?.entryId === item.entryId;
}

// Ask applied a safe action to the card's entry.
export function patchCardAfterAuto(card, item) {
  if (!isFor(card, item) || item.undone) {
    return card;
  }
  if (item.kind === "category" && item.to) {
    return { ...card, fields: { ...card.fields, categoryName: item.to } };
  }
  if (item.kind === "split" && item.splitExpenseId) {
    return {
      ...card,
      share: { on: true, splitGroupId: card.share?.splitGroupId ?? "" },
      saved: { ...card.saved, splitExpenseId: item.splitExpenseId }
    };
  }
  return card;
}

// The person undid one of them.
export function patchCardAfterUndo(card, item) {
  if (!isFor(card, item)) {
    return card;
  }
  if (item.kind === "category" && item.from) {
    return { ...card, fields: { ...card.fields, categoryName: item.from } };
  }
  if (item.kind === "split") {
    return {
      ...card,
      share: { on: false, splitGroupId: "" },
      saved: { ...card.saved, splitExpenseId: null, splitExpenseMonth: null, splitGroupName: "" }
    };
  }
  return card;
}
