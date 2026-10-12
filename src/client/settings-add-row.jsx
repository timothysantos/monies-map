import "./settings-add-row.css";

// The quiet "+ Add ..." row that ends a group of Detail rows (Settings, and
// "Create account" on Imports), in the accent colour like the folding row.
export function AddRow({ children, onClick, disabled = false }) {
  return (
    <button type="button" className="lsd-row settings-add-row" disabled={disabled} onClick={onClick}>
      <span className="lsd-row-label">{children}</span>
    </button>
  );
}
