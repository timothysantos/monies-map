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
  const { signal: upstreamSignal, requestLabel: _requestLabel, ...fetchOptions } = options;

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
    return await fetch(url, {
      ...fetchOptions,
      signal: controller.signal
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
