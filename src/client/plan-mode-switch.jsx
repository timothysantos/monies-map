import { planStudioAddCopy } from "./copy/plan-studio-add-copy";

const copy = planStudioAddCopy.modes;

/**
 * Sliders | List, two native radio buttons drawn as the same segmented
 * control as Summary's Plan | Simple (the `lead-view-switch` look): the
 * browser gives the radio group's keys, and each input covers its label and
 * the space around it, a 44 px target. The stored values stay "studio" and
 * "tables" (saved choices keep working); only the words shown changed. A dot
 * beside Sliders says changes made there are held and not saved yet (they are
 * kept while the list shows).
 *
 * `inline` is the switch alone, for the toolbar's row; without it the switch
 * sits on a row of its own (over the list, which has no toolbar).
 */
export function PlanModeSwitch({ mode, onChange, studioDirty = false, inline = false }) {
  const control = (
    <div className={`lead-view-switch${inline ? " plan-mode-inline" : ""}`} role="radiogroup" aria-label={copy.label} data-plan-mode-switch>
      {["studio", "tables"].map((key) => (
        <label key={key} title={key === "studio" && studioDirty ? copy.unsavedStudio : undefined}>
          <input type="radio" name="plan-mode" checked={mode === key} onChange={() => onChange(key)} data-plan-mode={key} />
          {copy[key]}
          {key === "studio" && studioDirty ? <i className="plan-mode-dot" role="img" aria-label={copy.unsavedStudio} data-plan-mode-dirty /> : null}
        </label>
      ))}
    </div>
  );
  if (inline) return control;
  return (
    <div className="plan-mode-bar" data-plan-mode-bar>
      {control}
    </div>
  );
}
