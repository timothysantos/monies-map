// Builds the locked (password-protected) statement PDFs the locked-statement
// tests open (tests/fixtures/locked-pdf/). Dev-only and dependency-free: the
// image statements are encrypted with Ghostscript (`gs` on the PATH, which
// writes RC4 only), and the text statements are written and encrypted here
// with node:crypto, so one of them is AES-128 (PDF 1.6, security handler
// revision 4). The generated files are committed, so running the tests never
// needs gs.
//
//   node scripts/make-locked-pdf-fixture.mjs
//
// Every password here is an obviously fake test value, never a real card
// number or ID: "TESTCARD12345678" opens the user-password files and
// "OWNERONLYSECRET99" is the owner password (the one that limits printing
// and copying, which pdf.js ignores). The content is the sanitized fixtures
// the repo already holds: the sanitized HSBC Visa Revolution image statements
// (tests/fixtures/hsbc-ocr/image-pdf) and the sanitized UOB One savings text
// (tests/fixtures/pdf-statement-text), so no real statement is involved.
import { execFileSync } from "node:child_process";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const FAKE_USER_PASSWORD = "TESTCARD12345678";
export const FAKE_OWNER_PASSWORD = "OWNERONLYSECRET99";

const OUT_DIR = "tests/fixtures/locked-pdf";
const IMAGE_SOURCES = "tests/fixtures/hsbc-ocr/image-pdf";
const TEXT_SOURCE = "tests/fixtures/pdf-statement-text/uob-one-savings-apr-2026-sanitized.pdf-text.txt";

// The image statements: Ghostscript re-writes them losslessly and encrypts.
function ghostscriptEncrypt(input, output, { revision, keyLength }) {
  execFileSync("gs", [
    "-q", "-dNOPAUSE", "-dBATCH", "-sDEVICE=pdfwrite", "-dCompatibilityLevel=1.4",
    `-dEncryptionR=${revision}`, `-dKeyLength=${keyLength}`,
    `-sOwnerPassword=${FAKE_OWNER_PASSWORD}`, `-sUserPassword=${FAKE_USER_PASSWORD}`,
    // The sanitized image statements are lossless grayscale: keep them so.
    "-dAutoFilterGrayImages=false", "-dAutoFilterColorImages=false",
    "-dGrayImageFilter=/FlateEncode", "-dColorImageFilter=/FlateEncode",
    "-dDownsampleGrayImages=false", "-dDownsampleColorImages=false", "-dDownsampleMonoImages=false",
    `-sOutputFile=${output}`,
    input
  ], { stdio: "inherit" });
}

const PASSWORD_PADDING = Buffer.from("28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A", "hex");
const md5 = (...parts) => createHash("md5").update(Buffer.concat(parts)).digest();
const padPassword = (password) => Buffer.concat([Buffer.from(password, "latin1"), PASSWORD_PADDING]).subarray(0, 32);

function rc4(key, data) {
  const state = Uint8Array.from({ length: 256 }, (_, index) => index);
  for (let i = 0, j = 0; i < 256; i += 1) {
    j = (j + state[i] + key[i % key.length]) & 255;
    [state[i], state[j]] = [state[j], state[i]];
  }
  const out = Buffer.alloc(data.length);
  for (let n = 0, i = 0, j = 0; n < data.length; n += 1) {
    i = (i + 1) & 255;
    j = (j + state[i]) & 255;
    [state[i], state[j]] = [state[j], state[i]];
    out[n] = data[n] ^ state[(state[i] + state[j]) & 255];
  }
  return out;
}

// ISO 32000-1, 7.6.3: the O and U entries and the file key, revision 3 or 4
// (128-bit key). Revision 4 encrypts streams with AES-128-CBC (AESV2).
function standardSecurity({ userPassword, ownerPassword, revision, id }) {
  const permissions = Buffer.alloc(4);
  permissions.writeInt32LE(-4);
  let ownerKey = md5(padPassword(ownerPassword));
  for (let round = 0; round < 50; round += 1) ownerKey = md5(ownerKey);
  ownerKey = ownerKey.subarray(0, 16);
  let owner = rc4(ownerKey, padPassword(userPassword));
  for (let round = 1; round <= 19; round += 1) owner = rc4(ownerKey.map((byte) => byte ^ round), owner);

  let fileKey = md5(padPassword(userPassword), owner, permissions, id);
  for (let round = 0; round < 50; round += 1) fileKey = md5(fileKey.subarray(0, 16));
  fileKey = fileKey.subarray(0, 16);
  let user = rc4(fileKey, md5(PASSWORD_PADDING, id));
  for (let round = 1; round <= 19; round += 1) user = rc4(fileKey.map((byte) => byte ^ round), user);
  user = Buffer.concat([user, randomBytes(16)]);

  const encryptStream = (objectNumber, data) => {
    const objectKey = md5(
      fileKey,
      Buffer.from([objectNumber & 255, (objectNumber >> 8) & 255, (objectNumber >> 16) & 255, 0, 0]),
      ...(revision === 4 ? [Buffer.from("sAlT")] : [])
    ).subarray(0, 16);
    if (revision !== 4) return rc4(objectKey, data);
    const iv = randomBytes(16);
    const cipher = createCipheriv("aes-128-cbc", objectKey, iv);
    return Buffer.concat([iv, cipher.update(data), cipher.final()]);
  };
  return { owner, user, permissions: permissions.readInt32LE(), encryptStream };
}

// A plain Courier text PDF, one text item per line (the raw view the UOB
// parser reads), optionally encrypted. Objects: 1 catalog, 2 pages, 3 font,
// then a content stream and a page per 70 lines, then the Encrypt dictionary.
function writeTextPdf(lines, { userPassword, ownerPassword = FAKE_OWNER_PASSWORD, revision } = {}) {
  // The standard Helvetica font has no CJK glyphs: the Chinese notice line
  // becomes question marks, which the UOB parser treats as the same noise.
  const escape = (value) => value.replace(/[^\x20-\x7e]/g, "?").replace(/[\\()]/g, (char) => `\\${char}`);
  const pages = [];
  for (let start = 0; start < lines.length; start += 70) pages.push(lines.slice(start, start + 70));
  const id = md5(Buffer.from(lines.join("\n")));
  const security = revision ? standardSecurity({ userPassword: userPassword ?? "", ownerPassword, revision, id }) : null;
  const objects = [];
  const pageNumbers = pages.map((_, index) => 4 + index * 2 + 1);
  objects[1] = Buffer.from("<< /Type /Catalog /Pages 2 0 R >>");
  objects[2] = Buffer.from(`<< /Type /Pages /Count ${pages.length} /Kids [${pageNumbers.map((n) => `${n} 0 R`).join(" ")}] >>`);
  objects[3] = Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  pages.forEach((pageLines, index) => {
    const contentNumber = 4 + index * 2;
    const content = Buffer.from(pageLines.map((line, row) => `BT /F1 8 Tf 40 ${800 - row * 11} Td (${escape(line)}) Tj ET`).join("\n"), "latin1");
    const body = security ? security.encryptStream(contentNumber, content) : content;
    objects[contentNumber] = Buffer.concat([Buffer.from(`<< /Length ${body.length} >>\nstream\n`), body, Buffer.from("\nendstream")]);
    objects[contentNumber + 1] = Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1600 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentNumber} 0 R >>`);
  });
  const hex = (buffer) => `<${buffer.toString("hex").toUpperCase()}>`;
  const encryptNumber = objects.length;
  if (security) {
    objects[encryptNumber] = Buffer.from(
      `<< /Filter /Standard /V ${revision === 4 ? 4 : 2} /R ${revision} /Length 128 /P ${security.permissions} /O ${hex(security.owner)} /U ${hex(security.user)}${
        revision === 4 ? " /CF << /StdCF << /CFM /AESV2 /AuthEvent /DocOpen /Length 16 >> >> /StmF /StdCF /StrF /StdCF" : ""
      } >>`
    );
  }

  const chunks = [Buffer.from("%PDF-1.6\n")];
  const offsets = [];
  let size = chunks[0].length;
  objects.forEach((object, number) => {
    if (!object) return;
    offsets[number] = size;
    const chunk = Buffer.concat([Buffer.from(`${number} 0 obj\n`), object, Buffer.from("\nendobj\n")]);
    chunks.push(chunk);
    size += chunk.length;
  });
  let xref = `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let number = 1; number < objects.length; number += 1) xref += `${String(offsets[number]).padStart(10, "0")} 00000 n \n`;
  chunks.push(Buffer.from(
    `${xref}trailer\n<< /Size ${objects.length} /Root 1 0 R${security ? ` /Encrypt ${encryptNumber} 0 R` : ""} /ID [${hex(id)} ${hex(id)}] >>\nstartxref\n${size}\n%%EOF\n`
  ));
  return Buffer.concat(chunks);
}

function report(file) {
  console.log(`${file} ${statSync(file).size} bytes`);
}

export function buildLockedPdfFixtures() {
  mkdirSync(OUT_DIR, { recursive: true });
  // Image statements (OCR path): RC4 128-bit and RC4 40-bit.
  const sep = `${OUT_DIR}/hsbc-visa-revolution-sep-2026.locked-rc4-128.pdf`;
  ghostscriptEncrypt(`${IMAGE_SOURCES}/hsbc-visa-revolution-sep-2026.sanitized.pdf`, sep, { revision: 3, keyLength: 128 });
  report(sep);
  const aug = `${OUT_DIR}/hsbc-visa-revolution-aug-2026.locked-rc4-40.pdf`;
  ghostscriptEncrypt(`${IMAGE_SOURCES}/hsbc-visa-revolution-aug-2026.sanitized.pdf`, aug, { revision: 2, keyLength: 40 });
  report(aug);

  // Text statement (text-extraction path): plain, AES-128, RC4-128 and
  // owner-password-only (opens without a password).
  const raw = readFileSync(TEXT_SOURCE, "utf8").split("__PDF_LAYOUT_TEXT__")[0];
  const lines = raw.split("\n").map((line) => line.trim()).filter(Boolean);
  const variants = {
    plain: {},
    "locked-aes-128": { userPassword: FAKE_USER_PASSWORD, revision: 4 },
    "locked-rc4-128": { userPassword: FAKE_USER_PASSWORD, revision: 3 },
    "owner-only": { revision: 4 }
  };
  for (const [name, options] of Object.entries(variants)) {
    const file = `${OUT_DIR}/uob-one-savings-apr-2026.${name}.pdf`;
    writeFileSync(file, writeTextPdf(lines, options));
    report(file);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  buildLockedPdfFixtures();
}
