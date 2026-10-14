import { ChevronDown, ChevronRight } from "lucide-react";

import { ScreenErrorBoundary } from "./screen-error-boundary";
import { MetaChip } from "./ui-components";

// One Settings section in the page's list (design.md, "Lead · Support ·
// Detail"; "Settings"). Closed, it is one 48 px row in the list: the title on
// the left, a short status word on the right ("Ethan, Serene", 6, "1 to
// check") and a chevron. Open, the row stays in place (tinted, chevron down)
// and the section's body unfolds under it. The title stays an h3 inside the
// toggle button so specs and assistive tech name the section by it.
//
// The list's rounded groups come from CSS in settings-route.css: a run of
// closed rows is one group, and an open section's body breaks the run.
// That keeps every row a stable element, so focus stays on the toggle that
// was pressed.
/**
 * @param {{
 *   id?: string, title: string, value?: any, valueTone?: string,
 *   isOpen: boolean, onToggle: () => void, className?: string, children?: any
 * }} props
 */
export function SettingsSection({ id, title, value = null, valueTone = undefined, isOpen, onToggle, className = "", children = null }) {
  const Chevron = isOpen ? ChevronDown : ChevronRight;
  return (
    <section id={id} className={`settings-section${isOpen ? " is-open" : ""}${className ? ` ${className}` : ""}`}>
      <button type="button" className="settings-section-toggle" onClick={onToggle} aria-expanded={isOpen}>
        <h3 className="settings-section-title">{title}</h3>
        <span className="settings-section-value">
          {value ? (valueTone ? <MetaChip tone={valueTone}>{value}</MetaChip> : <span className="settings-section-status">{value}</span>) : null}
          <Chevron size={16} aria-hidden="true" />
        </span>
      </button>
      {isOpen ? <div className="settings-section-body">{children}</div> : null}
    </section>
  );
}

// Contains a crash inside one section (a data shape it cannot draw) so the
// rest of Settings stays usable. The fallback is the app's own "could not be
// shown" panel with Try again and Reload app; it takes the section's place.
/** @param {{ children?: any }} props */
export function GuardedSettingsSection({ children }) {
  return <ScreenErrorBoundary level="section">{children}</ScreenErrorBoundary>;
}
