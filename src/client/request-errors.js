function isHtmlResponseText(detail) {
  const normalizedDetail = String(detail ?? "").trim();
  return /^<!doctype html\b/i.test(normalizedDetail) || /^<html\b/i.test(normalizedDetail);
}

function isCloudflareWorkerLimit(detail) {
  return /worker exceeded (cpu time limit|resource limits)/i.test(String(detail ?? ""));
}

// The technical line of a failed JSON request, labelled with the request
// that failed ("App shell request", "Page request", ...) so a page's own
// failure is never reported as the app shell.
export function buildRequestFailureMessage(requestLabel, status, detail) {
  const normalizedDetail = String(detail ?? "").replace(/\s+/g, " ").trim();
  const failed = `${requestLabel} failed with status ${status}.`;
  if (!normalizedDetail) {
    return failed;
  }
  if (isHtmlResponseText(normalizedDetail) && isCloudflareWorkerLimit(normalizedDetail)) {
    return `${failed} Cloudflare stopped the Worker because it exceeded CPU or resource limits before returning app JSON.`;
  }
  if (isHtmlResponseText(normalizedDetail)) {
    return `${failed} The server returned an HTML error page instead of JSON.`;
  }

  return `${failed} ${normalizedDetail.slice(0, 240)}`;
}

export function buildAppShellErrorMessage(status, detail) {
  return buildRequestFailureMessage("App shell request", status, detail);
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
  if (isHtmlResponseText(normalizedDetail) && isCloudflareWorkerLimit(normalizedDetail)) {
    return `${fallbackMessage} Status ${response.status}. Cloudflare stopped the Worker because it exceeded CPU or resource limits before returning app JSON.`;
  }
  if (isHtmlResponseText(normalizedDetail)) {
    return `${fallbackMessage} Status ${response.status}. The server returned an HTML error page instead of JSON.`;
  }

  return `${fallbackMessage} ${normalizedDetail.slice(0, 240)}`;
}

export function describeAppShellError(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "The dashboard could not load app shell data.";
}

export function isAppShellResourceLimitError(message) {
  return /cloudflare stopped the worker because it exceeded cpu or resource limits/i.test(String(message ?? ""));
}
