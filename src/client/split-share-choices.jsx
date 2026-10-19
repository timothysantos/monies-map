// The share choices of Add to splits (0%, 50%, 100% for the first person),
// shared by the desktop dialog (entries-list.jsx) and the phone edit sheet
// (entry-mobile-sheet.jsx) so both read and behave the same.
export const SPLIT_SHARE_CHOICES = [0, 5000, 10000];

export function SplitShareChoices({ personName, value, disabled = false, onChange }) {
  return (
    <>
      <p className="entry-split-picker-hint">0% means {personName} owes none; if they paid, they are owed the full amount. 100% means this expense is all theirs.</p>
      <div className="entry-split-share-choices" role="radiogroup" aria-label={`${personName}'s share`}>
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
