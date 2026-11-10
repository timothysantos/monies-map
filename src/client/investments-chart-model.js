// The Investments card's chart as data (design.md "Investments over
// time"), so it is tested without a page. Worth is drawn only at the months
// with a statement: a dot at each, and a line only between two months next
// to each other that both have one, so a month with no statement stays
// blank and nothing is filled in. The money put in is a stepped line over
// every month (it is known from the ledger). No forecast: the months end at
// this month.

const pad = 8;

/**
 * @param {Array<{ month: string, worthMinor: number | null, putInMinor: number }>} months
 * @param {{ width: number, height: number, left?: number, bottom?: number, ticks?: number }} size
 */
export function buildInvestmentsChart(months, { width, height, left = 0, bottom = 0, ticks = 0 }) {
  if (!months.length) {
    return null;
  }
  const values = months.flatMap((month) => [month.putInMinor, ...(month.worthMinor === null ? [] : [month.worthMinor])]);
  let low = Math.min(...values);
  let high = Math.max(...values);
  if (high === low) {
    high += 100_00;
    low = Math.max(0, low - 100_00);
  }
  const step = ticks > 1 ? niceStep((high - low) / (ticks - 1)) : 0;
  if (step) {
    low = Math.floor(low / step) * step;
    high = Math.max(low + step * (ticks - 1), Math.ceil(high / step) * step);
  }
  const plotLeft = left + pad;
  const plotRight = width - pad;
  const plotTop = pad;
  const plotBottom = height - bottom - pad;
  const x = (index) => (months.length === 1 ? (plotLeft + plotRight) / 2 : plotLeft + ((plotRight - plotLeft) * index) / (months.length - 1));
  const y = (minor) => plotBottom - ((plotBottom - plotTop) * (minor - low)) / (high - low);
  const round = (value) => Math.round(value * 10) / 10;

  const dots = [];
  const segments = [];
  months.forEach((month, index) => {
    if (month.worthMinor === null) return;
    dots.push({ month: month.month, x: round(x(index)), y: round(y(month.worthMinor)), worthMinor: month.worthMinor });
    const previous = months[index - 1];
    if (previous && previous.worthMinor !== null) {
      segments.push(`${round(x(index - 1))},${round(y(previous.worthMinor))} ${round(x(index))},${round(y(month.worthMinor))}`);
    }
  });
  // Stepped: flat through a month, then up or down to the next month's.
  const putInPoints = [];
  months.forEach((month, index) => {
    const at = round(y(month.putInMinor));
    if (index > 0) putInPoints.push(`${round(x(index))},${round(y(months[index - 1].putInMinor))}`);
    putInPoints.push(`${round(x(index))},${at}`);
  });
  const lastIndex = months.length - 1;
  putInPoints.push(`${round(plotRight)},${round(y(months[lastIndex].putInMinor))}`);

  return {
    width,
    height,
    dots,
    segments,
    putIn: putInPoints.join(" "),
    xLabels: months.map((month, index) => ({ month: month.month, x: round(x(index)) })),
    yTicks: step ? Array.from({ length: ticks }, (_, index) => {
      const value = high - ((high - low) * index) / (ticks - 1);
      return { valueMinor: value, y: round(y(value)) };
    }) : [],
    gridLeft: left,
    gridRight: width
  };
}

// A step of 1, 2, 2.5 or 5 times a power of ten dollars (in minor units).
function niceStep(raw) {
  const dollars = Math.max(1, raw / 100);
  const power = 10 ** Math.floor(Math.log10(dollars));
  const step = [1, 2, 2.5, 5, 10].find((candidate) => candidate * power >= dollars) * power;
  return step * 100;
}

// "$50k", "$1.2m", "$800" for an axis label.
export function shortDollars(minor) {
  const dollars = minor / 100;
  if (Math.abs(dollars) >= 1_000_000) return `$${trim(dollars / 1_000_000)}m`;
  if (Math.abs(dollars) >= 1_000) return `$${trim(dollars / 1_000)}k`;
  return `$${Math.round(dollars)}`;
}

const trim = (value) => String(Math.round(value * 10) / 10);
