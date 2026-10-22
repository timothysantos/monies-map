import "./summary-lead.css";

import { splitsLeadCopy as copy } from "./copy/splits-lead-copy";

const OPTIONS = [
  { key: "share", label: copy.yourShare },
  { key: "group", label: copy.wholeGroup }
];

/**
 * Your share | Whole group above the Splits donut: two native radio buttons
 * drawn as the same segmented control as Summary's Plan | Simple (the
 * `lead-view-switch` look). The browser gives the radio group's arrow keys,
 * and each input covers its label and the space around it, a 44 px target.
 * The household reading has one chart and does not render this.
 */
export function SplitsDonutModeSwitch({ mode, onChange }) {
  return (
    <div className="split-donut-mode-bar">
      <div className="lead-view-switch" role="radiogroup" aria-label={copy.donutSwitchLabel} data-donut-mode-switch>
        {OPTIONS.map(({ key, label }) => (
          <label key={key}>
            <input type="radio" name="splits-donut-mode" checked={mode === key} onChange={() => onChange(key)} data-donut-mode={key} />
            {label}
          </label>
        ))}
      </div>
    </div>
  );
}
