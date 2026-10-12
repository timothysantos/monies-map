// The quiet "+ Add ..." row that ends a group of Detail rows on Settings, in
// the accent colour like the folding row.
export function AddRow({ children, onClick, disabled = false }) {
  return (
    <button type="button" className="lsd-row settings-add-row" disabled={disabled} onClick={onClick}>
      <span className="lsd-row-label">{children}</span>
    </button>
  );
}
