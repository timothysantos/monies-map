// The requests Imports and Settings make for files sent to Monies Map
// (src/server/waiting-files-route.ts). Every one is behind Cloudflare
// Access; only the phone's Shortcut posts to the public send path.

const CONTENT_TYPES = {
  pdf: "application/pdf",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  xls: "application/vnd.ms-excel"
};

// One waiting file's bytes as a File, named and typed as it arrived, for
// the same browser reader a dropped file goes through. Fetched one at a
// time; the page API carries only names.
/** @param {{ id: string, fileName: string, fileKind: string }} waitingFile @param {{ signal?: AbortSignal }} [options] */
export async function fetchWaitingFile(waitingFile, { signal } = {}) {
  const response = await fetch(`/api/waiting-files/file?id=${encodeURIComponent(waitingFile.id)}`, { signal });
  if (!response.ok) {
    throw new Error(`Waiting file request failed (${response.status}).`);
  }
  const blob = await response.blob();
  return new File([blob], waitingFile.fileName, { type: CONTENT_TYPES[waitingFile.fileKind] ?? "" });
}

async function postJson(path, body) {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {})
    });
    const data = await response.json().catch(() => null);
    return response.ok ? { ok: true, ...(data ?? {}) } : { ok: false, status: response.status, error: data?.error ?? "" };
  } catch {
    return { ok: false, status: 0, error: "" };
  }
}

// "Remove": the stored file is deleted for good. A file already gone
// (imported elsewhere, or past its 30 days) counts as removed.
export async function removeWaitingFile(id) {
  const result = await postJson("/api/waiting-files/remove", { id });
  return result.ok || result.status === 404 ? { ok: true } : { ok: false };
}

/**
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<{ ok: boolean, endpoint?: string, key?: string, keySource?: string }>}
 */
export async function requestFileIntakeSettings({ signal } = {}) {
  try {
    const response = await fetch("/api/settings/file-intake", { signal });
    const data = await response.json().catch(() => null);
    return response.ok && data?.ok ? data : { ok: false };
  } catch {
    return { ok: false };
  }
}

export function makeNewFileIntakeKey() {
  return postJson("/api/settings/file-intake/new-key", {});
}
