// The three calls behind "Usually shared": the list, Add, and Undo. Kept in
// one place so the section does not know the payload shapes
// (src/server/usually-shared-route.ts).

export const USUALLY_SHARED_QUERY_KEY = ["splits-usually-shared"];

async function readJson(response, fallback) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw Object.assign(new Error(data.error || fallback), { code: data.code });
  }
  return data;
}

export async function getUsuallyShared(signal, fallback = "The usual list could not be loaded.") {
  return readJson(await fetch("/api/splits/usually-shared", { signal }), fallback);
}

export async function addUsualToSplits(body, fallback) {
  return readJson(await fetch("/api/splits/expenses/add-usual", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }), fallback);
}

export async function removeAddedFromSplits(body, fallback) {
  return readJson(await fetch("/api/splits/expenses/remove-added", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }), fallback);
}
