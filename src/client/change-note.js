// The change note under a big number (owner, 2026-11-11): "▲ 12%" and the
// quiet words after it. Worked out only from two figures the card already
// has; with no base to compare to (nothing, or too small), or money hidden,
// there is no note: never an estimate. `upIsGood` sets the tone (mint for
// growth in investments, rose for spending that went up).
export function changeNote({ current, base, upIsGood, minBase = 1, hidden = false }) {
  if (hidden || base === null || base === undefined || !(base >= minBase) || !Number.isFinite(current)) return null;
  const percent = Math.round((Math.abs(current) / base) * 100);
  if (percent === 0 || current === 0) return null;
  const up = current > 0;
  return { arrow: up ? "▲" : "▼", percent, tone: up === upIsGood ? "mint" : "rose" };
}
