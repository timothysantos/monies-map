import {
  cellMoneyToMinor,
  cellString,
  cleanUobSavingsDescription,
  compactDescription,
  compareImportRowsByDate,
  inferCategory,
  isTransferDescription,
  labelFromFile,
  minorToDecimal,
  parseLongDateCell,
  type ParsedStatementImport,
  type SpreadsheetCell
} from "./shared";

export function parseCurrentTransactionSpreadsheet(data: ArrayBuffer, fileName?: string): ParsedStatementImport {
  const cells = parseBiff8XlsCells(data);
  const rowsByIndex = new Map<number, Map<number, string | number>>();
  for (const cell of cells) {
    if (!rowsByIndex.has(cell.row)) {
      rowsByIndex.set(cell.row, new Map());
    }
    rowsByIndex.get(cell.row)?.set(cell.column, cell.value);
  }

  const flattenedRows = Array.from(rowsByIndex.entries())
    .sort(([left], [right]) => left - right)
    .map(([rowIndex, values]) => ({
      rowIndex,
      values
    }));

  const accountType = cellString(flattenedRows.find((row) => /^Account Type:$/i.test(cellString(row.values.get(0))))?.values.get(1));
  const accountName = normalizeUobSpreadsheetAccountName(accountType);
  const period = cellString(flattenedRows.find((row) => /^Statement Period:$/i.test(cellString(row.values.get(0))))?.values.get(1));
  const bankHeaderRow = flattenedRows.find((row) => (
    /^Transaction Date$/i.test(cellString(row.values.get(0)))
    && /^Transaction Description$/i.test(cellString(row.values.get(1)))
    && /^Withdrawal$/i.test(cellString(row.values.get(2)))
    && /^Deposit$/i.test(cellString(row.values.get(3)))
  ));
  const cardHeaderRow = flattenedRows.find((row) => (
    /^Transaction Date$/i.test(cellString(row.values.get(0)))
    && /^Posting Date$/i.test(cellString(row.values.get(1)))
    && /^Description$/i.test(cellString(row.values.get(2)))
    && /^Transaction Amount\(Local\)$/i.test(cellString(row.values.get(6)))
  ));

  if (bankHeaderRow) {
    return parseUobBankTransactionRows(flattenedRows, bankHeaderRow.rowIndex, accountName, period, fileName);
  }

  if (cardHeaderRow) {
    return parseUobCreditCardTransactionRows(flattenedRows, cardHeaderRow.rowIndex, accountName, period, fileName);
  }

  if (!bankHeaderRow && !cardHeaderRow) {
    throw new Error("Unsupported XLS transaction history. Could not find the UOB transaction history header row.");
  }
}

function parseUobBankTransactionRows(
  flattenedRows: Array<{ rowIndex: number; values: Map<number, string | number> }>,
  headerRowIndex: number,
  accountName: string,
  period: string,
  fileName?: string
) {
  const rows: Record<string, string>[] = [];
  for (const row of flattenedRows.filter((candidate) => candidate.rowIndex > headerRowIndex)) {
    const date = parseLongDateCell(cellString(row.values.get(0)));
    const rawDescription = cellString(row.values.get(1));
    if (!date || !rawDescription) {
      continue;
    }

    const withdrawalMinor = cellMoneyToMinor(row.values.get(2));
    const depositMinor = cellMoneyToMinor(row.values.get(3));
    if (!withdrawalMinor && !depositMinor) {
      continue;
    }

    const isIncome = Boolean(depositMinor);
    const amountMinor = depositMinor || withdrawalMinor || 0;
    const description = cleanUobSavingsDescription(compactDescription(rawDescription));
    const type = isTransferDescription(description) ? "transfer" : isIncome ? "income" : "expense";
    rows.push({
      date,
      description,
      expense: isIncome ? "" : minorToDecimal(amountMinor),
      income: isIncome ? minorToDecimal(amountMinor) : "",
      account: accountName,
      category: type === "transfer" ? "Transfer" : inferCategory(description, isIncome),
      note: "",
      type
    });
  }

  if (!rows.length) {
    throw new Error("No UOB current transaction rows were found in this XLS file.");
  }

  return {
    parserKey: "uob_current_transactions_xls",
    sourceLabel: labelFromFile(fileName, period ? `UOB current transactions ${period}` : "UOB current transactions"),
    rows: rows.sort(compareImportRowsByDate),
    checkpoints: [],
    warnings: []
  };
}

function parseUobCreditCardTransactionRows(
  flattenedRows: Array<{ rowIndex: number; values: Map<number, string | number> }>,
  headerRowIndex: number,
  accountName: string,
  period: string,
  fileName?: string
) {
  const rows: Record<string, string>[] = [];
  for (const row of flattenedRows.filter((candidate) => candidate.rowIndex > headerRowIndex)) {
    const transactionDate = parseLongDateCell(cellString(row.values.get(0)));
    const postingDate = parseLongDateCell(cellString(row.values.get(1)));
    const rawDescription = cellString(row.values.get(2));
    const signedAmountMinor = cellMoneyToMinor(row.values.get(6));
    if (!postingDate || !rawDescription || !signedAmountMinor) {
      continue;
    }

    const amountMinor = Math.abs(signedAmountMinor);
    const isCredit = signedAmountMinor < 0;
    const descriptionParts = parseUobCardHistoryDescription(rawDescription);
    const description = descriptionParts.description;
    const type = isCredit && isTransferDescription(description) ? "transfer" : isCredit ? "income" : isTransferDescription(description) ? "transfer" : "expense";
    rows.push({
      date: postingDate,
      description,
      expense: isCredit ? "" : minorToDecimal(amountMinor),
      income: isCredit ? minorToDecimal(amountMinor) : "",
      account: accountName,
      category: type === "transfer" ? "Transfer" : inferCategory(description, isCredit),
      note: transactionDate ? `txn date: ${transactionDate}` : "",
      type,
      reference: descriptionParts.reference
    });
  }

  if (!rows.length) {
    throw new Error("No UOB credit card current transaction rows were found in this XLS file.");
  }

  return {
    parserKey: "uob_credit_card_current_transactions_xls",
    sourceLabel: labelFromFile(fileName, period ? `UOB card current transactions ${period}` : "UOB card current transactions"),
    rows: rows.sort(compareImportRowsByDate),
    checkpoints: [],
    warnings: []
  };
}

function normalizeUobSpreadsheetAccountName(accountType: string) {
  if (/One Account/i.test(accountType)) {
    return "UOB One";
  }
  if (/^UOB ONE CARD$/i.test(accountType)) {
    return "UOB One Card";
  }
  if (/^LADY'S CARD$/i.test(accountType)) {
    return "UOB Lady's Card";
  }
  if (/^UOB PRVI MILES MASTERCARD$/i.test(accountType)) {
    return "UOB Privi Miles";
  }
  return accountType ? `UOB ${titleCaseUobAccountType(accountType)}` : "UOB Account";
}

function titleCaseUobAccountType(value: string) {
  return value
    .toLowerCase()
    .replace(/\buob\b/g, "UOB")
    .replace(/\bprvi\b/g, "Privi")
    .replace(/\bvisa\b/g, "Visa")
    .replace(/\bmastercard\b/g, "Mastercard")
    .replace(/\bamex\b/g, "Amex")
    .replace(/\b[a-z]/g, (match) => match.toUpperCase());
}

function parseUobCardHistoryDescription(value: string) {
  const reference = value.match(/\bRef No:\s*([A-Z0-9]+)/i)?.[1] ?? "";
  return {
    description: cleanUobSavingsDescription(compactDescription(value.replace(/\bRef No:\s*[A-Z0-9]+/gi, ""))),
    reference
  };
}

function parseBiff8XlsCells(data: ArrayBuffer): SpreadsheetCell[] {
  const bytes = new Uint8Array(data);
  const workbook = readCompoundDocumentWorkbook(bytes);
  const sharedStrings: string[] = [];
  const cells: SpreadsheetCell[] = [];
  let offset = 0;

  while (offset + 4 <= workbook.length) {
    const recordType = readUInt16(workbook, offset);
    const recordLength = readUInt16(workbook, offset + 2);
    const recordStart = offset + 4;
    const recordEnd = recordStart + recordLength;
    if (recordEnd > workbook.length) {
      break;
    }

    if (recordType === 0x00fc) {
      const sharedStringParts = [workbook.slice(recordStart, recordEnd)];
      let continuationOffset = recordEnd;
      while (continuationOffset + 4 <= workbook.length && readUInt16(workbook, continuationOffset) === 0x003c) {
        const continuationLength = readUInt16(workbook, continuationOffset + 2);
        const continuationStart = continuationOffset + 4;
        const continuationEnd = continuationStart + continuationLength;
        if (continuationEnd > workbook.length) {
          break;
        }
        sharedStringParts.push(workbook.slice(continuationStart, continuationEnd));
        continuationOffset = continuationEnd;
      }
      sharedStrings.splice(0, sharedStrings.length, ...readSharedStringTable(sharedStringParts));
      offset = continuationOffset;
      continue;
    } else if (recordType === 0x00fd && recordLength >= 10) {
      const sharedStringIndex = readUInt32(workbook, recordStart + 6);
      cells.push({
        row: readUInt16(workbook, recordStart),
        column: readUInt16(workbook, recordStart + 2),
        value: sharedStrings[sharedStringIndex] ?? ""
      });
    } else if (recordType === 0x0203 && recordLength >= 14) {
      cells.push({
        row: readUInt16(workbook, recordStart),
        column: readUInt16(workbook, recordStart + 2),
        value: readFloat64(workbook, recordStart + 6)
      });
    }

    offset = recordEnd;
  }

  return cells;
}

function readCompoundDocumentWorkbook(bytes: Uint8Array) {
  if (bytes.length < 512 || bytes[0] !== 0xd0 || bytes[1] !== 0xcf || bytes[2] !== 0x11 || bytes[3] !== 0xe0) {
    throw new Error("Unsupported XLS file. Expected an old Excel binary workbook.");
  }

  const sectorSize = 2 ** readUInt16(bytes, 30);
  const fatSectorCount = readUInt32(bytes, 44);
  const firstDirectorySector = readInt32(bytes, 48);
  const difatSectors: number[] = [];
  for (let offset = 76; offset < 512; offset += 4) {
    const sector = readInt32(bytes, offset);
    if (sector >= 0) {
      difatSectors.push(sector);
    }
  }

  const fat: number[] = [];
  for (const sector of difatSectors.slice(0, fatSectorCount)) {
    const sectorOffset = compoundSectorOffset(sector, sectorSize);
    for (let offset = sectorOffset; offset < sectorOffset + sectorSize && offset + 4 <= bytes.length; offset += 4) {
      fat.push(readInt32(bytes, offset));
    }
  }

  const directory = readCompoundSectorChain(bytes, fat, firstDirectorySector, sectorSize);
  let workbookStartSector = -1;
  let workbookSize = 0;
  for (let offset = 0; offset + 128 <= directory.length; offset += 128) {
    const nameLength = readUInt16(directory, offset + 64);
    if (!nameLength) {
      continue;
    }
    const name = decodeUtf16Le(directory.slice(offset, offset + nameLength - 2));
    if (name !== "Workbook" && name !== "Book") {
      continue;
    }
    workbookStartSector = readInt32(directory, offset + 116);
    workbookSize = readUInt32(directory, offset + 120);
    break;
  }

  if (workbookStartSector < 0 || workbookSize <= 0) {
    throw new Error("Unsupported XLS file. Could not find the workbook stream.");
  }

  return readCompoundSectorChain(bytes, fat, workbookStartSector, sectorSize).slice(0, workbookSize);
}

function readCompoundSectorChain(bytes: Uint8Array, fat: number[], firstSector: number, sectorSize: number) {
  const chunks: Uint8Array[] = [];
  const seen = new Set<number>();
  let sector = firstSector;
  while (sector >= 0 && sector < fat.length && !seen.has(sector)) {
    seen.add(sector);
    const offset = compoundSectorOffset(sector, sectorSize);
    chunks.push(bytes.slice(offset, offset + sectorSize));
    sector = fat[sector];
    if (sector === -2) {
      break;
    }
  }

  return concatBytes(chunks);
}

function compoundSectorOffset(sector: number, sectorSize: number) {
  return (sector + 1) * sectorSize;
}

function readSharedStringTable(parts: Uint8Array[]) {
  const strings: string[] = [];
  const cursor = new BiffContinuationCursor(parts);
  cursor.readUInt32();
  const uniqueCount = cursor.readUInt32();
  for (let index = 0; index < uniqueCount && !cursor.isDone(); index += 1) {
    strings.push(readBiffString(cursor));
  }
  return strings;
}

function readBiffString(cursor: BiffContinuationCursor) {
  const characterCount = cursor.readUInt16();
  let flags = cursor.readByte();
  const hasAsianPhonetics = Boolean(flags & 0x04);
  const hasRichText = Boolean(flags & 0x08);
  let isUtf16 = Boolean(flags & 0x01);
  let richTextRunCount = 0;
  let asianPhoneticByteCount = 0;
  if (hasRichText) {
    richTextRunCount = cursor.readUInt16();
  }
  if (hasAsianPhonetics) {
    asianPhoneticByteCount = cursor.readUInt32();
  }

  let value = "";
  let remainingCharacters = characterCount;
  while (remainingCharacters > 0 && !cursor.isDone()) {
    const bytesPerCharacter = isUtf16 ? 2 : 1;
    const availableCharacters = Math.floor(cursor.currentPartRemaining() / bytesPerCharacter);
    const takeCharacters = Math.min(remainingCharacters, availableCharacters);
    if (takeCharacters > 0) {
      const bytes = cursor.readBytes(takeCharacters * bytesPerCharacter);
      value += isUtf16 ? decodeUtf16Le(bytes) : decodeSingleByteString(bytes);
      remainingCharacters -= takeCharacters;
    }
    if (remainingCharacters > 0) {
      flags = cursor.moveToContinuationStringPart();
      isUtf16 = Boolean(flags & 0x01);
    }
  }

  cursor.skipBytes(richTextRunCount * 4 + asianPhoneticByteCount);
  return value;
}

class BiffContinuationCursor {
  private partIndex = 0;
  private offset = 0;

  constructor(private readonly parts: Uint8Array[]) {}

  isDone() {
    return this.partIndex >= this.parts.length;
  }

  currentPartRemaining() {
    const part = this.parts[this.partIndex];
    return part ? part.length - this.offset : 0;
  }

  readByte() {
    this.ensureAvailable();
    return this.parts[this.partIndex][this.offset++];
  }

  readUInt16() {
    const bytes = this.readBytes(2);
    return new DataView(bytes.buffer, bytes.byteOffset, 2).getUint16(0, true);
  }

  readUInt32() {
    const bytes = this.readBytes(4);
    return new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true);
  }

  readBytes(length: number) {
    const output = new Uint8Array(length);
    let written = 0;
    while (written < length && !this.isDone()) {
      this.ensureAvailable();
      const available = this.currentPartRemaining();
      const take = Math.min(length - written, available);
      output.set(this.parts[this.partIndex].slice(this.offset, this.offset + take), written);
      this.offset += take;
      written += take;
    }
    return output;
  }

  skipBytes(length: number) {
    let remaining = length;
    while (remaining > 0 && !this.isDone()) {
      this.ensureAvailable();
      const take = Math.min(remaining, this.currentPartRemaining());
      this.offset += take;
      remaining -= take;
    }
  }

  moveToContinuationStringPart() {
    this.partIndex += 1;
    this.offset = 0;
    return this.readByte();
  }

  private ensureAvailable() {
    while (!this.isDone() && this.offset >= this.parts[this.partIndex].length) {
      this.partIndex += 1;
      this.offset = 0;
    }
  }
}

function concatBytes(chunks: Uint8Array[]) {
  const output = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function decodeUtf16Le(bytes: Uint8Array) {
  return new TextDecoder("utf-16le").decode(bytes);
}

function decodeSingleByteString(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
}

function readUInt16(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(0, true);
}

function readUInt32(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
}

function readInt32(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getInt32(0, true);
}

function readFloat64(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 8).getFloat64(0, true);
}
