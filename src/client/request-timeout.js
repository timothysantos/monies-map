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

// Gateway and edge timeouts say the request never got a real answer from the
// app (unlike a 500, which is the app's own error and is shown as is).
const GATEWAY_STATUSES = new Set([502, 503, 504, 522, 523, 524, 530]);

// A request that hung (our timeout) or was cut off (the browser's network
// error). A caller's own abort is never one of these.
function isLostRequestError(error, upstreamSignal) {
  if (upstreamSignal?.aborted || error?.name === "AbortError") {
    return false;
  }
  return error instanceof TypeError || /timed out after/.test(String(error?.message ?? ""));
}

// Required requests retry a restarting local Worker up to three times, and
// also a request that timed out, was cut off or got a gateway error: a stalled
// database read is per request, so another try usually answers in under a
// second. Speculative requests pass maxAttempts: 1 so optional work never
// retries.
export async function fetchTextWithTransientWorkerRetry(url, options = {}) {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  let lastResult = null;
  // A hung request is retried once only, so the wait before the error screen
  // stays bounded.
  let retriedLostRequest = false;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const canRetry = attempt < maxAttempts - 1;
    let response;
    let responseText;
    try {
      response = await fetchWithTimeout(url, options, options.requestLabel ?? "App request");
      responseText = await response.text();
    } catch (error) {
      if (canRetry && !retriedLostRequest && isLostRequestError(error, options.signal)) {
        retriedLostRequest = true;
        await waitForTransientWorkerRetry(attempt);
        continue;
      }
      throw error;
    }
    lastResult = { response, responseText };

    if (canRetry && (isTransientWorkerResponse(responseText) || GATEWAY_STATUSES.has(response.status))) {
      await waitForTransientWorkerRetry(attempt);
      continue;
    }

    return lastResult;
  }

  return lastResult;
}
