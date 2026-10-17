import { messages } from "./copy/en-SG";

const copy = messages.summary.lead.view;

// Summary and Month share this preference. A second instance in the desktop
// floating bar has its own radio name, while both instances read one store.
export function LeadViewSwitch({ view, onChange, name = "lead-view" }) {
  return (
    <div className="lead-view-switch" role="radiogroup" aria-label={copy.label}>
      {["plan", "simple"].map((key) => (
        <label key={key}>
          <input type="radio" name={name} checked={view === key} onChange={() => onChange(key)} />
          {copy[key]}
        </label>
      ))}
    </div>
  );
}
