import { splitShareCopy as copy } from "./copy/split-share-copy";

// The share choices of Add to splits (0%, 50%, 100% for the first person),
// shared by the desktop dialog (entries-list.jsx) and the phone edit sheet
// (entry-mobile-sheet.jsx) so both read and behave the same.
export const SPLIT_SHARE_CHOICES = [0, 5000, 10000];

export function SplitShareChoices({ personName, otherPersonName = copy.otherPersonFallback, value, disabled = false, onChange }) {
  return (
    <>
      <p className="entry-split-picker-hint">{copy.shareHint(personName, otherPersonName)}</p>
      <div className="entry-split-share-choices" role="radiogroup" aria-label={copy.shareGroup(personName)}>
        {SPLIT_SHARE_CHOICES.map((basisPoints) => (
          <button
            key={basisPoints}
            type="button"
            role="radio"
            aria-checked={value === basisPoints}
            className={`entry-split-share-choice${value === basisPoints ? " is-selected" : ""}`}
            disabled={disabled}
            onClick={() => onChange(basisPoints)}
          >
            {basisPoints / 100}%
          </button>
        ))}
      </div>
    </>
  );
}
