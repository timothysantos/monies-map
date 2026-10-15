import { useRollingNumber } from "./plan-studio-motion";

/**
 * An amount that rolls to its new value (design.md "Plan Studio"). Money
 * hidden shows dots at once; reduced motion shows the new amount at once.
 * `signed` shows a plus or minus sign (a difference); `abs` the size only.
 */
export function RollingMoney({ minor, fmt, signed = false, abs = false, className = "" }) {
  const shown = useRollingNumber(abs ? Math.abs(minor) : minor);
  return <span className={`ps-num ${className}`.trim()}>{signed ? fmt.signed(shown) : fmt.money(shown)}</span>;
}
