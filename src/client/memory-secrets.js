// Secrets held in memory only, so a report can hide them. A statement's
// password is typed on this device, kept in a closure while its file is read
// (pdf-unlock.js) and never sent, saved or logged. This is the last line of
// defence: every report the app writes about a failure (the crash report,
// the import diagnostic) passes its text through `redactSecrets` first, so
// even a surprising error message could not carry a password into the
// error diagnostics table.

const held = new Set();

/** Remembers `value` for redaction until the returned function is called. */
export function holdSecret(value) {
  if (!value) {
    return () => {};
  }
  held.add(value);
  return () => {
    held.delete(value);
  };
}

/** `text` with every held secret replaced. */
export function redactSecrets(text) {
  let result = String(text ?? "");
  for (const secret of held) {
    // Also as it reads inside a JSON string (quotes and backslashes escaped).
    for (const form of new Set([secret, JSON.stringify(secret).slice(1, -1)])) {
      result = result.split(form).join("[hidden]");
    }
  }
  return result;
}
