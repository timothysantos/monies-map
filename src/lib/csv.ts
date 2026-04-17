export function parseCsv(input: string): Record<string, string>[] {
  const lines = parseCsvLines(input);

  if (lines.length < 2) {
    return [];
  }

  const headers = splitCsvLine(lines[0]);

  return lines.slice(1).map((line) => {
    const values = alignCsvValues(headers, splitCsvLine(line));
    return headers.reduce<Record<string, string>>((record, header, index) => {
      record[header] = values[index] ?? "";
      return record;
    }, {});
  });
}

export function inspectCsv(input: string) {
  const lines = parseCsvLines(input);

  if (!lines.length) {
    return { headers: [], rows: [] as Record<string, string>[] };
  }

  const headers = splitCsvLine(lines[0]);
  if (lines.length < 2) {
    return { headers, rows: [] as Record<string, string>[] };
  }

  return {
    headers,
    rows: parseCsv(input)
  };
}

export function parseCsvMatrix(input: string): string[][] {
  return parseCsvLines(input).map((line) => splitCsvLine(line));
}

function parseCsvLines(input: string): string[] {
  const lines: string[] = [];
  let current = "";
  let inQuotes = false;

  for (const rawLine of input.split(/\r?\n/)) {
    current = current ? `${current}\n${rawLine}` : rawLine;
    inQuotes = updateCsvQuoteState(rawLine, inQuotes);
    if (!inQuotes) {
      const line = current.trim();
      if (line) {
        lines.push(line);
      }
      current = "";
    }
  }

  const finalLine = current.trim();
  if (finalLine) {
    lines.push(finalLine);
  }
  return lines;
}

function splitCsvLine(line: string): string[] {
  const output: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (character === '"') {
      const nextCharacter = line[index + 1];
      if (inQuotes && nextCharacter === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (character === "," && !inQuotes) {
      output.push(current);
      current = "";
      continue;
    }

    current += character;
  }

  output.push(current);
  return output;
}

function alignCsvValues(headers: string[], values: string[]): string[] {
  if (values.length <= headers.length) {
    return values;
  }

  const normalizedHeaders = headers.map((header) => header.trim().toLowerCase());
  const descriptionIndex = normalizedHeaders.findIndex((header) => (
    header === "description"
    || header === "details"
    || header === "narrative"
    || header === "merchant"
    || header === "memo"
  ));

  if (descriptionIndex === -1) {
    return values.slice(0, headers.length);
  }

  const repaired = [...values];
  while (repaired.length > headers.length && descriptionIndex + 1 < repaired.length) {
    repaired[descriptionIndex] = `${repaired[descriptionIndex]},${repaired[descriptionIndex + 1]}`;
    repaired.splice(descriptionIndex + 1, 1);
  }

  return repaired.slice(0, headers.length);
}

function updateCsvQuoteState(line: string, initialState: boolean) {
  let inQuotes = initialState;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] !== '"') {
      continue;
    }
    if (inQuotes && line[index + 1] === '"') {
      index += 1;
      continue;
    }
    inQuotes = !inQuotes;
  }
  return inQuotes;
}
