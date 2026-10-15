// How Plan Studio says money: whole dollars unless the amount has cents (a
// typed $137.50), dots when money is hidden. Built once per render from the
// page's hidden state, so every figure changes in the same frame.
const whole = new Intl.NumberFormat("en-SG", { style: "currency", currency: "SGD", maximumFractionDigits: 0 });
const withCents = new Intl.NumberFormat("en-SG", { style: "currency", currency: "SGD" });
const HIDDEN = "••••";

export function makeStudioFormat(hidden) {
  const money = (minor) => {
    if (hidden) return HIDDEN;
    return (minor % 100 === 0 ? whole : withCents).format(minor / 100);
  };
  return {
    hidden,
    money,
    // "+$50" or "−$50" (a true minus sign), dots when hidden.
    signed: (minor) => (hidden ? HIDDEN : `${minor < 0 ? "−" : "+"}${money(Math.abs(minor))}`),
    // Plain digits for a text field: 137 or 137.50.
    field: (minor) => (minor % 100 === 0 ? String(minor / 100) : (minor / 100).toFixed(2))
  };
}
