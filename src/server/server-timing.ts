// Server-Timing for page APIs. `app` is the page handler alone (unchanged
// meaning), `init` is the schema initialization this request waited for, and
// `total` runs from the top of fetch until the body is serialized.
//
// Inside a Worker the clock only advances across I/O, so CPU-only work can
// measure 0 ms. That is expected and not corrected here.

export type ServerTimingInput = {
  appMs?: number;
  initMs: number;
  initCold: boolean;
  totalMs: number;
};

export type InitializationTiming =
  | { ok: true; initMs: number; cold: boolean }
  | { ok: false; initMs: number; cold: true; error: unknown };

export function buildServerTimingHeader({ appMs, initMs, initCold, totalMs }: ServerTimingInput) {
  const metrics = [
    `init;dur=${initMs};desc="${initCold ? "cold" : "warm"}"`,
    `total;dur=${totalMs}`
  ];
  // The app metric stays first: existing budget checks read the first dur.
  return (appMs === undefined ? metrics : [`app;dur=${appMs}`, ...metrics]).join(", ");
}

// A failed initialization is reported as cold: the next request starts a
// fresh attempt.
export async function timeInitialization(
  ensure: () => Promise<{ cold: boolean }>,
  now: () => number
): Promise<InitializationTiming> {
  const startedAt = now();
  try {
    const { cold } = await ensure();
    return { ok: true, initMs: now() - startedAt, cold };
  } catch (error) {
    return { ok: false, initMs: now() - startedAt, cold: true, error };
  }
}
