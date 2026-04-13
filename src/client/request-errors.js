export function buildBootstrapErrorMessage(status, detail) {
  const normalizedDetail = String(detail ?? "").replace(/\s+/g, " ").trim();
  if (!normalizedDetail) {
    return `Bootstrap request failed with status ${status}.`;
  }

  return `Bootstrap request failed with status ${status}. ${normalizedDetail.slice(0, 240)}`;
}

export async function buildRequestErrorMessage(response, fallbackMessage) {
  const responseText = await response.text();
  let detail = responseText;

  if (responseText) {
    try {
      const payload = JSON.parse(responseText);
      detail = payload?.error ?? payload?.message ?? responseText;
    } catch {}
  }

  const normalizedDetail = String(detail ?? "").replace(/\s+/g, " ").trim();
  if (!normalizedDetail) {
    return `${fallbackMessage} Status ${response.status}.`;
  }

  return `${fallbackMessage} ${normalizedDetail.slice(0, 240)}`;
}

export function describeBootstrapError(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "The dashboard could not load bootstrap data.";
}
