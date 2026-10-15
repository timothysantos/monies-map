// Naming rule (AGENTS.md, "Every visible name must be understandable to a
// non-technical person"): no product-internal or designer words in the words
// Plan Studio shows. Walks every string in the Plan Studio copy modules
// (calling each function with sample figures) and rejects the banned words,
// then checks the Sliders | List switch and the Add to Savings dialog by name.
import assert from "node:assert/strict";
import test from "node:test";

import { planStudioAddCopy } from "../src/client/copy/plan-studio-add-copy.js";
import { planStudioCopy } from "../src/client/copy/plan-studio-copy.js";
import { findRetiredNames, RETIRED_NAMES } from "../src/domain/retired-names.ts";

// "Tables" is rejected as a name; "studio" as a name; internal nouns always.
const BANNED = [
  [/\bstudio\b/i, "studio"],
  [/\btables?\b/i, "tables"],
  [/\bbuckets?\b/i, "bucket"],
  [/\bDTOs?\b/, "DTO"],
  [/\bmodes?\b/i, "mode"],
  [/\bplan (line|row)s?\b/i, "plan line / plan row"],
  [/\bjobs?\b/i, "job"]
];

function visibleStrings(value, path = "copy", out = []) {
  if (typeof value === "string") {
    out.push([path, value]);
  } else if (typeof value === "function") {
    // Most take figures and a label; a few take a list of { name, amount }.
    for (const args of [["$1,200", 3, "$40", "Food"], [[{ name: "Tim", amount: "$1" }]]]) {
      try {
        visibleStrings(value(...args), `${path}()`, out);
        break;
      } catch {
        // try the next sample
      }
    }
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => visibleStrings(item, `${path}[${index}]`, out));
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) visibleStrings(item, `${path}.${key}`, out);
  }
  return out;
}

const strings = [...visibleStrings(planStudioCopy, "planStudioCopy"), ...visibleStrings(planStudioAddCopy, "planStudioAddCopy")];

test("the walk reaches the copy: it sees the toolbar, the row menu and the extra income dialog", () => {
  const paths = strings.map(([path]) => path);
  for (const expected of ["planStudioCopy.toolbar.save", "planStudioCopy.menu.editDetails", "planStudioCopy.extraIncome.confirmTitle()", "planStudioAddCopy.modes.studio"]) {
    assert.ok(paths.includes(expected), expected);
  }
  assert.ok(strings.length > 150, `walked ${strings.length} strings`);
});

test("no Plan Studio string uses a product-internal or designer word", () => {
  const offences = [];
  for (const [path, text] of strings) {
    for (const [pattern, name] of BANNED) {
      if (pattern.test(text)) offences.push(`${path}: "${text}" (${name})`);
    }
    for (const problem of findRetiredNames(text)) offences.push(`${path}: "${text}" (${problem})`);
  }
  assert.deepEqual(offences, []);
});

test("the guard rejects what it should: a sample of the old names trips it", () => {
  for (const old of ["Studio", "Tables", "Studio, with changes not saved yet", "Add a budget bucket", "Every planned dollar has a job.", "Change this one in the plan line"]) {
    assert.ok(BANNED.some(([pattern]) => pattern.test(old)), old);
  }
  assert.ok(!BANNED.some(([pattern]) => pattern.test("Sliders")));
});

test("the switch is Sliders | List, named 'How to show the plan'", () => {
  assert.equal(planStudioAddCopy.modes.studio, "Sliders");
  assert.equal(planStudioAddCopy.modes.tables, "List");
  assert.equal(planStudioAddCopy.modes.label, "How to show the plan");
});

test("the Add to Savings dialog says what it does in plain words", () => {
  assert.equal(planStudioCopy.extraIncome.confirmTitle("$500"), "Add $500 to Savings?");
  assert.equal(planStudioCopy.extraIncome.confirmText("$500"), "This adds $500 to your Savings and counts it as extra money in, so the plan still adds up.");
});

test("the retired names are rejected in plan copy, and their replacements pass", () => {
  for (const [old, now] of [
    ["Overplanned", "Planned more than you earn"],
    ["To allocate", "Not planned yet"],
    ["Money jobs", "Where your money goes"],
    ["Wallets in view", "The accounts shown"],
    ["Add a budget bucket", "Add a monthly budget"],
    ["Planned items", "Bills and dated payments"],
    ["Worth $5 on 1 Jan, from its statement", "$5 on 1 Jan, as the statement says"]
  ]) {
    assert.equal(findRetiredNames(old).length, 1, old);
    assert.deepEqual(findRetiredNames(now), [], now);
  }
  assert.equal(RETIRED_NAMES.length, 7);
});
