import { Eye, EyeOff } from "lucide-react";
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState } from "react";

const MONEY_TOTALS_VISIBILITY_STORAGE_KEY = "monies-map:money-totals-visible";
const MoneyPrivacyContext = createContext(null);

function readInitialVisibility() {
  if (typeof window === "undefined") {
    return false;
  }

  return window.localStorage.getItem(MONEY_TOTALS_VISIBILITY_STORAGE_KEY) === "true";
}

function writeMoneyPrivacyDocumentState(areTotalsVisible) {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.moneyPrivacy = areTotalsVisible ? "visible" : "hidden";
  }
}

// Privacy is a display preference. It deliberately starts hidden on each new
// browser and never changes financial data, filters, or stored entry rows.
export function MoneyPrivacyProvider({ children }) {
  const [areTotalsVisible, setAreTotalsVisible] = useState(readInitialVisibility);

  // Shared formatters read this state during descendant rendering, not after a
  // later effect, so the toggle changes every money label in the same frame.
  writeMoneyPrivacyDocumentState(areTotalsVisible);

  // Set this before the browser paints child pages so shared money formatters
  // cannot briefly reveal a value during the first render.
  useLayoutEffect(() => {
    writeMoneyPrivacyDocumentState(areTotalsVisible);
  }, [areTotalsVisible]);

  useEffect(() => {
    window.localStorage.setItem(MONEY_TOTALS_VISIBILITY_STORAGE_KEY, String(areTotalsVisible));
  }, [areTotalsVisible]);

  const value = useMemo(() => ({
    areTotalsVisible,
    toggleTotalsVisibility: () => setAreTotalsVisible((visible) => !visible)
  }), [areTotalsVisible]);

  return <MoneyPrivacyContext.Provider value={value}>{children}</MoneyPrivacyContext.Provider>;
}

export function useMoneyPrivacy() {
  const context = useContext(MoneyPrivacyContext);
  if (!context) {
    throw new Error("useMoneyPrivacy must be used inside MoneyPrivacyProvider.");
  }
  return context;
}

export function PrivateMoney({ children, className = "" }) {
  const { areTotalsVisible } = useMoneyPrivacy();
  return <span className={`private-money ${className}`.trim()}>{areTotalsVisible ? children : "••••"}</span>;
}

export function TotalsVisibilityToggle({ className = "" }) {
  const { areTotalsVisible, toggleTotalsVisibility } = useMoneyPrivacy();
  const label = areTotalsVisible ? "Hide money totals" : "Show money totals";
  const Icon = areTotalsVisible ? Eye : EyeOff;

  return (
    <button
      type="button"
      className={`totals-visibility-toggle ${className}`.trim()}
      aria-label={label}
      aria-pressed={areTotalsVisible}
      title={label}
      onClick={toggleTotalsVisibility}
    >
      <Icon size={18} aria-hidden="true" />
    </button>
  );
}
