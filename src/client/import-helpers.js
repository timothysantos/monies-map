import { formatMinorInput } from "./formatters";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";

export function getImportDirectOwnerForAccount(accounts, people, accountName, fallbackOwnerName, accountId) {
  const account = accounts.find((item) => (
    accountId
      ? item.id === accountId || item.accountId === accountId
      : item.name === accountName || item.accountName === accountName
  ));
  if (account && !account.isJoint && account.ownerLabel && account.ownerLabel !== "Shared") {
    return people.some((person) => person.name === account.ownerLabel)
      ? account.ownerLabel
      : fallbackOwnerName;
  }

  return fallbackOwnerName;
}

export function inferImportMapping(header) {
  const normalized = header.toLowerCase().trim();

  if (
    [
      "date",
      "transaction date",
      "posting date",
      "posted date",
      "value date"
    ].includes(normalized)
  ) {
    return "date";
  }

  if (
    [
      "description",
      "details",
      "narrative",
      "merchant",
      "memo"
    ].includes(normalized)
  ) {
    return "description";
  }

  if (["amount", "transaction amount", "amt", "value"].includes(normalized)) {
    return "amount";
  }

  if ([
    "expense",
    "expenses",
    "expense amount",
    "debit",
    "debit amount",
    "withdrawal",
    "outflow"
  ].includes(normalized)) {
    return "expense";
  }

  if ([
    "income",
    "incomes",
    "income amount",
    "credit",
    "credit amount",
    "deposit",
    "inflow"
  ].includes(normalized)) {
    return "income";
  }

  if (["account", "wallet", "account name", "source account"].includes(normalized)) {
    return "account";
  }

  if (["category", "category name"].includes(normalized)) {
    return "category";
  }

  if (["note", "notes", "remarks"].includes(normalized)) {
    return "note";
  }

  if (["type", "transaction type", "entry type"].includes(normalized)) {
    return "type";
  }

  return "ignore";
}

export function buildMappedImportRows(rows, columnMappings) {
  return rows
    .map((row) => {
      const mappedRow = {};

      for (const [header, target] of Object.entries(columnMappings)) {
        if (!target || target === "ignore") {
          continue;
        }

        const rawValue = row[header];
        if (rawValue == null || rawValue === "") {
          continue;
        }

        if (target === "amount" || target === "expense" || target === "income") {
          mappedRow[target] = rawValue;
          continue;
        }

        mappedRow[target] = rawValue;
      }

      return mappedRow;
    })
    .filter((row) => Object.keys(row).length > 0);
}

export function buildRawImportRowFromPreviewRow(row) {
  const isMoneyIn = row.entryType === "income" || (row.entryType === "transfer" && row.transferDirection === "in");
  return {
    date: row.date,
    description: row.description,
    expense: isMoneyIn ? "" : formatMinorInput(row.amountMinor),
    income: isMoneyIn ? formatMinorInput(row.amountMinor) : "",
    accountId: row.accountId ?? "",
    account: row.accountName ?? "",
    category: row.categoryName ?? "",
    note: row.note ?? "",
    type: row.entryType
  };
}

export async function extractPdfText(file) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const data = new Uint8Array(await file.arrayBuffer());
  const document = await pdfjs.getDocument({ data }).promise;
  const pages = [];
  const layoutPages = [];
  const spacedLayoutPages = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => item.str ?? "").join("\n"));
    layoutPages.push(extractPdfLayoutLines(content.items).join("\n"));
    spacedLayoutPages.push(extractPdfLayoutLines(content.items, " ").join("\n"));
  }

  return `${pages.join("\n")}\n__PDF_LAYOUT_TEXT__\n${layoutPages.join("\n")}\n__PDF_SPACED_LAYOUT_TEXT__\n${spacedLayoutPages.join("\n")}`;
}

function extractPdfLayoutLines(items, chunkSeparator = "") {
  const lines = [];
  for (const item of items) {
    const text = item.str ?? "";
    if (!text.trim()) {
      continue;
    }

    const x = item.transform?.[4] ?? 0;
    const y = item.transform?.[5] ?? 0;
    let line = lines.find((candidate) => Math.abs(candidate.y - y) < 2.5);
    if (!line) {
      line = { y, chunks: [] };
      lines.push(line);
    }
    line.chunks.push({ x, text });
  }

  return lines
    .sort((left, right) => right.y - left.y)
    .map((line) => line.chunks
      .sort((left, right) => left.x - right.x)
      .map((chunk) => chunk.text)
      .join(chunkSeparator)
      .replace(/\s+/g, " ")
      .trim())
    .filter(Boolean);
}

export function selectParsedStatementForCompare(parsed, target) {
  const checkpoint = parsed.checkpoints.find((item) => item.accountName === target.accountName) ?? parsed.checkpoints[0];
  const accountNames = new Set(parsed.rows.map((row) => row.account).filter(Boolean));
  if (accountNames.size > 1 && target.accountName && !accountNames.has(target.accountName)) {
    throw new Error(`This statement does not contain rows for ${target.accountName}.`);
  }

  const rows = accountNames.size > 1
    ? parsed.rows.filter((row) => row.account === target.accountName)
    : parsed.rows;

  return { checkpoint, rows };
}
