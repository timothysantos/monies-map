import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parseStatementText } from "../src/lib/statement-import.ts";
import { parseCurrentTransactionSpreadsheet } from "../src/lib/statement-import/xls.ts";

function readWorkbookFixture(name) {
  const file = new URL(`./fixtures/uob-current-transactions/${name}`, import.meta.url);
  const buffer = readFileSync(file);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

test("parseStatementText rejects unsupported statement layouts with a clear error", () => {
  assert.throws(
    () => parseStatementText("not a supported statement", "unsupported.pdf"),
    /Unsupported statement PDF/
  );
});

test("parseCurrentTransactionSpreadsheet rejects empty or unreadable XLS buffers", () => {
  const emptyBuffer = new ArrayBuffer(0);

  assert.throws(
    () => parseCurrentTransactionSpreadsheet(emptyBuffer, "empty.xls"),
    /Unsupported XLS file/
  );
});

test("parseCurrentTransactionSpreadsheet preserves the normalized UOB current-transaction contract", () => {
  const parsed = parseCurrentTransactionSpreadsheet(
    readWorkbookFixture("ACC_TXN_History_02052026194007.xls"),
    "ACC_TXN_History_02052026194007.xls"
  );

  assert.equal(parsed.parserKey, "uob_current_transactions_xls");
  assert.equal(parsed.sourceLabel, "ACC_TXN_History_02052026194007");
  assert.equal(parsed.rows.length, 1);
  assert.deepEqual(Object.keys(parsed.rows[0]).sort(), [
    "account",
    "category",
    "date",
    "description",
    "expense",
    "income",
    "note",
    "type"
  ]);
  assert.equal(parsed.checkpoints.length, 0);
  assert.equal(parsed.warnings.length, 0);
});

for (const [scenarioId, fixtureName, expectedAccountName] of [
  ["I13", "CC_TXN_History_06052026211223-onecard-tim-06-may.xls", "UOB One Card"],
  ["I14", "CC_TXN_History_06052026211316-ladys-tim-06-may.xls", "UOB Lady's Card"]
]) {
  test(`parseCurrentTransactionSpreadsheet preserves the ${scenarioId} UOB credit-card contract`, () => {
    const parsed = parseCurrentTransactionSpreadsheet(
      readWorkbookFixture(fixtureName),
      fixtureName
    );

    assert.equal(parsed.parserKey, "uob_credit_card_current_transactions_xls");
    assert.equal(parsed.rows[0].account, expectedAccountName);
    assert.equal(parsed.sourceLabel.endsWith(fixtureName.replace(/\.xls$/i, "")), true);
    assert.equal(parsed.rows.length > 0, true);
    assert.deepEqual(Object.keys(parsed.rows[0]).sort(), [
      "account",
      "category",
      "date",
      "description",
      "expense",
      "income",
      "note",
      "reference",
      "type"
    ]);
    assert.equal(parsed.checkpoints.length, 0);
    assert.equal(parsed.warnings.length, 0);
  });
}
