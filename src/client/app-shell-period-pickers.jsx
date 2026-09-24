import * as Popover from "@radix-ui/react-popover";

const MONTH_PICKER_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// One period picker: a trigger showing the current value, a year strip and
// that year's months. App owns which months exist, the selection rules and
// the URL updates. `closeOnSelect` closes after a pick (single month); range
// endpoints stay open so both ends can be adjusted.
export function PeriodMonthPicker({
  triggerLabel,
  disabled = false,
  title,
  hint,
  yearsAriaLabel,
  years,
  activeYear,
  onYearChange,
  months,
  selectedMonth,
  isMonthDisabled = () => false,
  closeOnSelect = false,
  onSelect
}) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className="period-range-segment" disabled={disabled}>
          {triggerLabel}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="period-picker-popover" sideOffset={10} align="center">
          <div className="period-picker-head">
            <strong>{title}</strong>
            <span>{hint}</span>
          </div>
          <div className="period-picker-years" role="tablist" aria-label={yearsAriaLabel}>
            {years.map((year) => (
              <button
                key={year}
                type="button"
                className={`period-picker-year ${activeYear === year ? "is-active" : ""}`}
                onClick={() => onYearChange(year)}
              >
                {year}
              </button>
            ))}
          </div>
          <div className="period-picker-months">
            {months.map((month) => {
              const monthIndex = Number(month.slice(5, 7)) - 1;
              const button = (
                <button
                  key={month}
                  type="button"
                  className={`period-picker-month ${month === selectedMonth ? "is-active" : ""}`}
                  disabled={isMonthDisabled(month)}
                  onClick={() => onSelect(month)}
                >
                  {MONTH_PICKER_LABELS[monthIndex]}
                </button>
              );
              return closeOnSelect ? <Popover.Close key={month} asChild>{button}</Popover.Close> : button;
            })}
          </div>
          <Popover.Arrow className="category-popover-arrow" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
