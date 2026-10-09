// Where a statement layout prints personal details, for the fixture
// sanitizers (scripts/sanitize-ocr-tsv.mjs, scripts/create-sanitized-statement-pdf.mjs).
// Areas are on page 1 in the OCR reference frame (an A4 page rendered at
// 220 dpi, 1820 x 2572): [left, top, right, bottom], with the placeholder
// text drawn into a sanitized image.
export const STATEMENT_PRIVATE_AREAS = {
  "hsbc-visa-revolution": {
    referenceWidth: 1820,
    referenceHeight: 2572,
    page: 1,
    areas: [
      { box: [140, 400, 760, 470], placeholder: "TEST CARD HOLDER", size: 30 }, // card holder name
      { box: [140, 470, 760, 540], placeholder: "4000-0000-0000-0000", size: 28 }, // full card number
      { box: [140, 935, 1160, 1005], placeholder: "TEST CARD HOLDER 4000-XXXX-XXXX-0000", size: 22 }, // holder bar above the transactions
      { box: [140, 2190, 760, 2400], placeholder: "TEST CARD HOLDER\n1 TEST AVENUE\n#01-01\nSINGAPORE 000000", size: 22 } // mailing address
    ]
  }
};

export function statementLayout(flags, fallback = "hsbc-visa-revolution") {
  const layoutFlag = flags.indexOf("--layout");
  const name = layoutFlag >= 0 ? flags[layoutFlag + 1] : fallback;
  const layout = STATEMENT_PRIVATE_AREAS[name];
  if (!layout) {
    throw new Error(`Unknown layout ${name}. Known: ${Object.keys(STATEMENT_PRIVATE_AREAS).join(", ")}`);
  }
  return layout;
}

// Terms that must not survive sanitizing, passed at run time so the real
// values are never written into the repo.
export function privateCheckTerms() {
  return (process.env.OCR_SANITIZE_CHECK_TERMS ?? "").split(",").map((term) => term.trim()).filter(Boolean);
}
