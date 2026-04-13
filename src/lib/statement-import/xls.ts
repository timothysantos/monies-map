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
  const accountName = /One Account/i.test(accountType) ? "UOB One" : accountType ? `UOB ${accountType}` : "UOB Account";
  const period = cellString(flattenedRows.find((row) => /^Statement Period:$/i.test(cellString(row.values.get(0))))?.values.get(1));
  const headerRow = flattenedRows.find((row) => (
    /^Transaction Date$/i.test(cellString(row.values.get(0)))
    && /^Transaction Description$/i.test(cellString(row.values.get(1)))
    && /^Withdrawal$/i.test(cellString(row.values.get(2)))
    && /^Deposit$/i.test(cellString(row.values.get(3)))
  ));

  if (!headerRow) {
    throw new Error("Unsupported XLS transaction history. Could not find the UOB transaction history header row.");
  }

  const rows: Record<string, string>[] = [];
  for (const row of flattenedRows.filter((candidate) => candidate.rowIndex > headerRow.rowIndex)) {
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
      sharedStrings.splice(0, sharedStrings.length, ...readSharedStringTable(workbook.slice(recordStart, recordEnd)));
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

function readSharedStringTable(data: Uint8Array) {
  const strings: string[] = [];
  const uniqueCount = readUInt32(data, 4);
  let offset = 8;
  for (let index = 0; index < uniqueCount && offset < data.length; index += 1) {
    const result = readBiffString(data, offset);
    strings.push(result.value);
    offset = result.offset;
  }
  return strings;
}

function readBiffString(data: Uint8Array, offset: number) {
  const characterCount = readUInt16(data, offset);
  let cursor = offset + 2;
  const flags = data[cursor];
  cursor += 1;
  const hasAsianPhonetics = Boolean(flags & 0x04);
  const hasRichText = Boolean(flags & 0x08);
  const isUtf16 = Boolean(flags & 0x01);
  let richTextRunCount = 0;
  let asianPhoneticByteCount = 0;
  if (hasRichText) {
    richTextRunCount = readUInt16(data, cursor);
    cursor += 2;
  }
  if (hasAsianPhonetics) {
    asianPhoneticByteCount = readUInt32(data, cursor);
    cursor += 4;
  }

  const byteLength = isUtf16 ? characterCount * 2 : characterCount;
  const value = isUtf16
    ? decodeUtf16Le(data.slice(cursor, cursor + byteLength))
    : decodeSingleByteString(data.slice(cursor, cursor + byteLength));
  cursor += byteLength + richTextRunCount * 4 + asianPhoneticByteCount;

  return { value, offset: cursor };
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
