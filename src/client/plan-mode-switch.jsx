import { planStudioAddCopy } from "./copy/plan-studio-add-copy";

const copy = planStudioAddCopy.modes;

/**
 * Studio | Tables, two native radio buttons drawn as the same segmented
 * control as Summary's Plan | Simple (the `lead-view-switch` look): the
 * browser gives the radio group's keys, and each input covers its label and
 * the space around it, a 44 px target. A dot beside Studio says changes made
 * there are held and not saved yet (they are kept while Tables shows).
 */
export function PlanModeSwitch({ mode, onChange, studioDirty = false }) {
  return (
    <div className="plan-mode-bar" data-plan-mode-bar>
      <div className="lead-view-switch" role="radiogroup" aria-label={copy.label} data-plan-mode-switch>
        {["studio", "tables"].map((key) => (
          <label key={key} title={key === "studio" && studioDirty ? copy.unsavedStudio : undefined}>
            <input type="radio" name="plan-mode" checked={mode === key} onChange={() => onChange(key)} data-plan-mode={key} />
            {copy[key]}
            {key === "studio" && studioDirty ? <i className="plan-mode-dot" role="img" aria-label={copy.unsavedStudio} data-plan-mode-dirty /> : null}
          </label>
        ))}
      </div>
    </div>
  );
}
