import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  parseStatementText,
  statementRowsToCsv
} from "../src/lib/statement-import.ts";

test("HSBC Visa Revolution OCR TSV imports statement rows and checkpoint", async () => {
  const tsv = await readFile("tests/fixtures/hsbc-ocr/hsbc-visa-revolution-apr-2026.tsv", "utf8");
  const parsed = parseStatementText(`__OCR_TSV__\n${tsv}`, "HSBC-8155-apr-2026.pdf");

  assert.equal(parsed.parserKey, "hsbc_visa_revolution_ocr_pdf");
  assert.equal(parsed.sourceLabel, "HSBC-8155-apr-2026");
  assert.deepEqual(parsed.checkpoints, [{
    accountName: "HSBC Visa Revolution",
    checkpointMonth: "2026-04",
    statementStartDate: "2026-03-06",
    statementEndDate: "2026-04-05",
    statementBalanceMinor: 0,
    previousBalanceMinor: 0,
    note: "Imported from HSBC Visa Revolution OCR statement"
  }]);
  assert.deepEqual(parsed.rows, [
    {
      date: "2026-03-09",
      description: "IKEA - ONLINE SINGAPORE",
      expense: "117.80",
      income: "",
      account: "HSBC Visa Revolution",
      category: "Shopping",
      note: "txn date: 2026-03-06",
      type: "expense"
    },
    {
      date: "2026-04-04",
      description: "PAYMENT VIA UOB VISA DIRECT SG",
      expense: "",
      income: "117.80",
      account: "HSBC Visa Revolution",
      category: "Transfer",
      note: "txn date: 2026-04-02",
      type: "transfer"
    }
  ]);
  assert.match(parsed.warnings[0], /local OCR/i);

  const csv = statementRowsToCsv(parsed.rows);
  assert.match(csv, /^date,description,expense,income,account,category,note,type/m);
  assert.match(csv, /2026-03-09,IKEA - ONLINE SINGAPORE,117\.80,,HSBC Visa Revolution,Shopping,txn date: 2026-03-06,expense/);
  assert.match(csv, /2026-04-04,PAYMENT VIA UOB VISA DIRECT SG,,117\.80,HSBC Visa Revolution,Transfer,txn date: 2026-04-02,transfer/);
});

test("HSBC OCR parser rejects unrelated OCR TSV", () => {
  assert.throws(
    () => parseStatementText("__OCR_TSV__\nlevel\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n5\t1\t1\t1\t1\t1\t0\t0\t10\t10\t90\tOther"),
    /Unsupported statement PDF|does not look like an HSBC Visa Revolution statement/
  );
});
