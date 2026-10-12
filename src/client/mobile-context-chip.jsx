import { getPersonColourVars } from "./person-colour";

// Who the phone's View and scope control is showing: a person's chip in their
// colour (the Entries row colour) or a neutral chip for the household. Used by
// the Support bar (App.jsx) and the sheet's lead (mobile-context-sheet.jsx).
export function ContextPersonChip({ label, isHousehold, className = "" }) {
  return (
    <span
      className={`mobile-context-person-chip${isHousehold ? " is-household" : ""}${className ? ` ${className}` : ""}`}
      style={isHousehold ? undefined : getPersonColourVars(label)}
    >
      {label}
    </span>
  );
}
