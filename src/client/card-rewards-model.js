// Summary's "Miles and cashback" card as data (design.md "Miles and
// cashback"): each picture's totals, cards, best card now, cap notices and
// looking back, from the server's answer (card-rewards-api.js). Pure, so
// the figures are tested without a page: every spending figure is the sum
// of the entries the server named, and every miles figure names the
// entries that earned it.

// "YYYY-MM:YYYY-MM" covering several periods.
function widestPeriod(periods) {
  const parts = periods.filter(Boolean).map((period) => period.split(":"));
  if (!parts.length) return "";
  const start = parts.map(([from]) => from).sort()[0];
  const end = parts.map(([from, to]) => to || from).sort().at(-1);
  return `${start}:${end}`;
}

const PHONE_CARDS = 3;

/**
 * @param {ReturnType<typeof import("./card-rewards-api").readCardRewards>} answer
 */
export function buildCardRewardsModel(answer) {
  if (!answer) return null;
  const names = new Map();
  for (const person of answer.people) {
    for (const card of person.cards) names.set(card.accountId, card.name);
  }
  const nameOf = (accountId) => names.get(accountId) ?? "";
  const pictures = answer.people.map((person) => {
    const miles = person.cards.filter((card) => card.unit === "miles");
    const cashback = person.cards.filter((card) => card.unit === "cashback");
    const total = (cards) => ({
      amount: cards.reduce((sum, card) => sum + card.earned, 0),
      ids: [...new Set(cards.flatMap((card) => card.ids))].sort(),
      period: widestPeriod(cards.map((card) => card.period))
    });
    // The cards that earned most first; a card with nothing yet last.
    const cards = [...person.cards].sort((left, right) => (left.unit === right.unit ? 0 : left.unit === "miles" ? -1 : 1) || right.earned - left.earned || left.name.localeCompare(right.name));
    const bestByCategory = new Map();
    for (const item of person.best) {
      const entry = bestByCategory.get(item.categoryName) ?? { categoryName: item.categoryName, miles: null, cashback: null };
      entry[item.unit] = { ...item, name: nameOf(item.accountId), usualName: item.usualAccountId ? nameOf(item.usualAccountId) : "" };
      bestByCategory.set(item.categoryName, entry);
    }
    return {
      personId: person.personId,
      name: person.name,
      milesTotal: miles.length ? total(miles) : null,
      cashbackTotal: cashback.length ? total(cashback) : null,
      cards,
      phoneCards: cards.slice(0, PHONE_CARDS),
      best: [...bestByCategory.values()],
      notices: person.notices.map((notice) => ({
        ...notice,
        name: nameOf(notice.accountId),
        alternativeName: notice.alternative ? nameOf(notice.alternative.accountId) : ""
      })),
      lookingBack: person.lookingBack.map((item) => ({
        ...item,
        changes: item.changes.map((change) => ({ ...change, fromName: nameOf(change.fromAccountId), toName: nameOf(change.toAccountId) }))
      }))
    };
  });
  return {
    suggestFrom: answer.suggestFrom,
    today: answer.today,
    pictures,
    notSetUp: answer.notSetUp,
    isEmpty: pictures.every((picture) => !picture.cards.length)
  };
}
