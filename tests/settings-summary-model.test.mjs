import assert from "node:assert/strict";
import test from "node:test";

import { buildSettingsSummaries, describeAskAi, usesClaude } from "../src/client/settings-summary-model.js";
import { describeAccountLine } from "../src/client/settings-account-line.js";

const base = {
  people: [{ name: "Ethan" }, { name: "Serene" }],
  accounts: [{}, {}, {}],
  categories: [{}, {}],
  exceptions: [{ status: "open" }, { status: "resolved" }, { status: "open" }],
  unresolvedTransfers: [{}]
};

test("closed rows say what is in each section in a word", () => {
  const summaries = buildSettingsSummaries({ ...base, shortcutIsSetUp: false });
  assert.deepEqual(summaries.people, { text: "Ethan, Serene" });
  assert.deepEqual(summaries.accounts, { text: "3" });
  assert.deepEqual(summaries.categories, { text: "2" });
  assert.deepEqual(summaries.shortcutApi, { text: "Not set up", tone: "butter" });
  assert.deepEqual(summaries.trust, { text: "2 to check", tone: "butter" });
  assert.deepEqual(summaries.transfers, { text: "1 to pair", tone: "butter" });
  // Rows with nothing to summarise stay empty rather than invent a word.
  assert.equal(summaries.paymentWays.text, "");
  assert.equal(summaries.categoryRules.text, "");
  assert.equal(summaries.errorDiagnostics.text, "");
  assert.equal(summaries.activity.text, "");
});

test("rows that are clear say so, and a set-up shortcut loses its warning tone", () => {
  const summaries = buildSettingsSummaries({ ...base, shortcutIsSetUp: true, exceptions: [{ status: "resolved" }], unresolvedTransfers: [] });
  assert.deepEqual(summaries.shortcutApi, { text: "Set up" });
  assert.deepEqual(summaries.trust, { text: "All clear" });
  assert.deepEqual(summaries.transfers, { text: "All paired" });
});

test("Ask and AI names the model that answers and the credit state", () => {
  const visible = { visible: true, claudeConfigured: true };
  assert.equal(usesClaude({ ...visible, state: "ok" }), true);
  assert.equal(usesClaude({ ...visible, state: "unknown" }), true);
  assert.equal(usesClaude({ ...visible, state: "exhausted" }), false);
  assert.equal(usesClaude({ ...visible, state: "capped" }), false);
  assert.equal(usesClaude({ visible: true, claudeConfigured: false, state: "ok" }), false);
  assert.equal(usesClaude(null), false);

  assert.deepEqual(describeAskAi({ ...visible, state: "ok" }), {
    modelName: "Claude",
    subtitle: "Uses Claude",
    chip: { text: "Credits fine", tone: "mint" }
  });
  assert.deepEqual(describeAskAi({ ...visible, state: "exhausted" }), {
    modelName: "Basic model",
    subtitle: "Uses the basic model for now",
    chip: { text: "Credits used up", tone: "rose" }
  });
  assert.deepEqual(describeAskAi({ visible: true, claudeConfigured: false, state: "unknown" }), {
    modelName: "Basic model",
    subtitle: "Uses the basic model",
    chip: { text: "Claude not set up", tone: "butter" }
  });
  assert.equal(describeAskAi({ ...visible, state: "unknown" }).chip.text, "Not used yet");
});

test("an account line names the kind in words, never the stored value", () => {
  assert.equal(
    describeAccountLine({ institution: "Citibank", kind: "credit_card", ownerLabel: "Ethan" }),
    "Citibank • Credit card • Ethan"
  );
  assert.equal(describeAccountLine({ institution: "DBS", kind: "bank", ownerLabel: "Shared" }), "DBS • Bank • Shared");
  assert.doesNotMatch(describeAccountLine({ institution: "X", kind: "credit_card", ownerLabel: "Y" }), /_/);
});
