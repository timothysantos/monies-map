// Waiting files (DOMAIN.md "Waiting File"): what the server accepts, judged
// by a file's first bytes and then its name, on the repo's near-real
// sanitised bank files. Everything else is refused before it is stored.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  checkWaitingFile,
  describeRefusal,
  joinChunks,
  sanitizeWaitingFileName,
  sha256Hex,
  splitIntoChunks
} from "../src/domain/waiting-files.ts";
import { WAITING_FILE_MAX_BYTES } from "../src/domain/waiting-files-config.ts";

const fixture = (path) => new Uint8Array(readFileSync(new URL(`./fixtures/${path}`, import.meta.url)));
const text = (value) => new TextEncoder().encode(value);

const PDF = fixture("locked-pdf/uob-one-savings-apr-2026.plain.pdf");
const LOCKED_PDF = fixture("locked-pdf/uob-one-savings-apr-2026.locked-aes-128.pdf");
const XLS = fixture("uob-current-transactions/ACC_TXN_History_04052026210351.xls");
const OCBC_CSV = fixture("ocbc-activity/TransactionHistory_20260628140517-ocbc-360-sanitized.csv");
const HSBC_TSV = fixture("hsbc-ocr/hsbc-visa-revolution-apr-2026.tsv");

test("bank files the importer reads are accepted, kind from their bytes", () => {
  assert.deepEqual(checkWaitingFile(PDF, "eStatement Apr 2026.pdf"), { ok: true, kind: "pdf", contentType: "application/pdf", fileName: "eStatement Apr 2026.pdf" });
  // A locked PDF stays locked: it is stored as it came.
  assert.deepEqual(checkWaitingFile(LOCKED_PDF, "locked.pdf"), { ok: true, kind: "pdf", contentType: "application/pdf", fileName: "locked.pdf" });
  assert.deepEqual(checkWaitingFile(XLS, "ACC_TXN_History_04052026210351.xls"), { ok: true, kind: "xls", contentType: "application/vnd.ms-excel", fileName: "ACC_TXN_History_04052026210351.xls" });
  assert.deepEqual(checkWaitingFile(OCBC_CSV, "TransactionHistory.csv"), { ok: true, kind: "csv", contentType: "text/csv", fileName: "TransactionHistory.csv" });
  assert.deepEqual(checkWaitingFile(HSBC_TSV, "hsbc.hsbc-ocr.tsv"), { ok: true, kind: "tsv", contentType: "text/tab-separated-values", fileName: "hsbc.hsbc-ocr.tsv" });
  // A PDF is a PDF whatever its name says.
  assert.deepEqual(checkWaitingFile(PDF, "statement.csv"), { ok: true, kind: "pdf", contentType: "application/pdf", fileName: "statement.csv.pdf" });
  // A UTF-8 byte order mark is fine.
  assert.equal(checkWaitingFile(joinChunks([new Uint8Array([0xef, 0xbb, 0xbf]), text("date,amount\n2026-05-01,1.00\n")]), "a.csv").ok, true);
});

test("anything else is refused before it is stored", () => {
  const refused = (bytes, name) => checkWaitingFile(bytes, name);
  assert.deepEqual(refused(new Uint8Array(0), "empty.pdf"), { ok: false, reason: "empty" });
  assert.deepEqual(refused(new Uint8Array(WAITING_FILE_MAX_BYTES + 1), "big.pdf"), { ok: false, reason: "too_large" });
  // A zip (and so an .xlsx, which the importer cannot read).
  const zip = joinChunks([new Uint8Array([0x50, 0x4b, 0x03, 0x04]), text("[Content_Types].xml xl/workbook.xml")]);
  assert.deepEqual(refused(zip, "statement.xlsx"), { ok: false, reason: "not_a_bank_file" });
  assert.deepEqual(refused(zip, "statements.zip"), { ok: false, reason: "not_a_bank_file" });
  // Images: the importer reads PDFs and exports, not photos.
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  assert.deepEqual(refused(png, "statement.png"), { ok: false, reason: "not_a_bank_file" });
  assert.deepEqual(refused(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16]), "statement.jpg"), { ok: false, reason: "not_a_bank_file" });
  // A web page or script named as a CSV.
  assert.deepEqual(refused(text("<!DOCTYPE html><html><body>Statement</body></html>"), "statement.csv"), { ok: false, reason: "not_a_bank_file" });
  assert.deepEqual(refused(text("  <html><script>alert(1)</script>"), "statement.csv"), { ok: false, reason: "not_a_bank_file" });
  assert.deepEqual(refused(text("date,description\n2026-05-01,<script>x</script>\n"), "statement.csv"), { ok: false, reason: "not_a_bank_file" });
  assert.deepEqual(refused(text("<svg onload=x>"), "statement.tsv"), { ok: false, reason: "not_a_bank_file" });
  // Plain text that is not named as a CSV or TSV.
  assert.deepEqual(refused(OCBC_CSV, "statement.html"), { ok: false, reason: "not_a_bank_file" });
  assert.deepEqual(refused(OCBC_CSV, "statement.txt"), { ok: false, reason: "not_a_bank_file" });
  // Binary bytes named as a CSV.
  assert.deepEqual(refused(new Uint8Array([0x64, 0x61, 0x00, 0x74, 0x61]), "statement.csv"), { ok: false, reason: "not_a_bank_file" });
  // The Office file signature also starts Word files and installers: only
  // an .xls name is taken.
  assert.deepEqual(refused(XLS, "letter.doc"), { ok: false, reason: "not_a_bank_file" });
  assert.deepEqual(refused(XLS, "setup.msi"), { ok: false, reason: "not_a_bank_file" });
  assert.equal(describeRefusal("not_a_bank_file"), "Monies Map only takes PDF statements and CSV, TSV or XLS bank exports.");
  assert.equal(describeRefusal("too_large"), "This file is larger than 10 MB.");
  assert.equal(describeRefusal("empty"), "This file is empty.");
});

test("file names are made safe to store and show", () => {
  assert.equal(sanitizeWaitingFileName("eStatement_UOB_Cards_12May2026.pdf"), "eStatement_UOB_Cards_12May2026.pdf");
  assert.equal(sanitizeWaitingFileName("../../etc/passwd"), "passwd");
  assert.equal(sanitizeWaitingFileName("C:\\Temp\\bank\\ACCT_349.csv"), "ACCT_349.csv");
  assert.equal(sanitizeWaitingFileName("<img src=x onerror=alert(1)>.csv"), "_img src_x onerror_alert(1)_.csv");
  assert.equal(sanitizeWaitingFileName("bad\u0000name\u202e.pdf"), "badname.pdf");
  assert.equal(sanitizeWaitingFileName("   ..."), "file");
  assert.equal(sanitizeWaitingFileName(""), "file");
  const long = sanitizeWaitingFileName(`${"a".repeat(300)}.pdf`);
  assert.equal(long.length, 120);
  assert.ok(long.endsWith(".pdf"));
});

test("bytes split into chunks and join back exactly; the hash is the file's SHA-256", async () => {
  const bytes = Uint8Array.from({ length: 1_300_000 }, (_, index) => index % 251);
  const chunks = splitIntoChunks(bytes);
  assert.deepEqual(chunks.map((chunk) => chunk.byteLength), [524288, 524288, 251424]);
  assert.deepEqual(joinChunks(chunks), bytes);
  assert.equal(await sha256Hex(text("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});
