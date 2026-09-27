const DEFAULT_BOOTSTRAP_REQUEST_TIMEOUT_MS = 45_000;
const TEST_TIMEOUT_OVERRIDE_KEY = "__MONIES_MAP_REQUEST_TIMEOUT_MS__";

function getRequestTimeoutMs() {
  if (typeof window !== "undefined") {
    const override = Number(window[TEST_TIMEOUT_OVERRIDE_KEY]);
    if (Number.isFinite(override) && override > 0) {
      return override;
    }
  }

  return DEFAULT_BOOTSTRAP_REQUEST_TIMEOUT_MS;
}

function createAbortError(message) {
  return new DOMException(message, "AbortError");
}

function formatTimeout(timeoutMs) {
  if (timeoutMs < 1000) {
    return `${timeoutMs} ms`;
  }

  return `${Math.round(timeoutMs / 1000)} seconds`;
}

export async function fetchWithTimeout(url, options = {}, label = "Request") {
  const timeoutMs = getRequestTimeoutMs();
  const { signal: upstreamSignal, requestLabel: _requestLabel, maxAttempts: _maxAttempts, ...fetchOptions } = options;

  if (upstreamSignal?.aborted) {
    throw createAbortError(`${label} aborted.`);
  }

  const controller = new AbortController();
  let didTimeout = false;
  const timeout = globalThis.setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);
  const handleUpstreamAbort = () => controller.abort();

  try {
    upstreamSignal?.addEventListener("abort", handleUpstreamAbort, { once: true });
    // The listener below is removed once headers arrive, so hand fetch a
    // combined signal too: an upstream abort then also stops body reading.
    const fetchSignal = upstreamSignal && typeof AbortSignal.any === "function"
      ? AbortSignal.any([controller.signal, upstreamSignal])
      : controller.signal;
    return await fetch(url, {
      ...fetchOptions,
      signal: fetchSignal
    });
  } catch (error) {
    if (didTimeout) {
      throw new Error(`${label} timed out after ${formatTimeout(timeoutMs)}.`);
    }

    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
    upstreamSignal?.removeEventListener("abort", handleUpstreamAbort);
  }
}

const TRANSIENT_WORKER_RESPONSE_SNIPPETS = [
  "worker restarted mid-request",
  "socket hang up",
  "Your worker"
];

function isTransientWorkerResponse(responseText) {
  return TRANSIENT_WORKER_RESPONSE_SNIPPETS.some((snippet) => responseText.includes(snippet));
}

async function waitForTransientWorkerRetry(attempt) {
  await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
}

// Required requests retry a restarting local Worker up to three times.
// Speculative requests pass maxAttempts: 1 so optional work never retries.
export async function fetchTextWithTransientWorkerRetry(url, options = {}) {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  let lastResult = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const response = await fetchWithTimeout(url, options, options.requestLabel ?? "App request");
    const responseText = await response.text();
    lastResult = { response, responseText };

    if (attempt < maxAttempts - 1 && isTransientWorkerResponse(responseText)) {
      await waitForTransientWorkerRetry(attempt);
      continue;
    }

    return lastResult;
  }

  return lastResult;
}
