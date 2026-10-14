// A lazy chunk's stylesheet that fails to download must not crash the app.
//
// Vite loads the CSS of a lazy chunk (the phone's View and scope sheet, the
// Pick a month sheet) with a <link> and rejects the whole import with
// "Unable to preload CSS for <url>" when that link errors. React.lazy then
// throws into the nearest boundary, and for a sheet opened from App that is
// the app boundary: "The app hit a problem and could not be shown", on every
// open, even after a reload. A missing stylesheet only costs some styling, so
// it is reported and ridden out: preventDefault() tells Vite to carry on with
// the import. A script that failed to load (a deploy replaced the files) still
// throws and gets the boundary's "fresh copy of the app" reload.

const STYLESHEET_PRELOAD_FAILURE = /Unable to preload CSS/i;

/** @param {unknown} error */
export function isStylesheetPreloadError(error) {
  const message = typeof error === "string" ? error : /** @type {any} */ (error)?.message;
  return typeof message === "string" && STYLESHEET_PRELOAD_FAILURE.test(message);
}

/**
 * Listens for Vite's preload failures on `win`. Returns the function that
 * removes the listener.
 * @param {{ addEventListener: Function, removeEventListener: Function }} win
 * @param {(report: { kind: "stylesheet-preload", level: "page", error: Error, componentStack: string }) => void} report
 */
export function installPreloadRecovery(win, report) {
  const onPreloadError = (/** @type {any} */ event) => {
    if (!isStylesheetPreloadError(event?.payload)) {
      return;
    }
    event.preventDefault();
    const error = event.payload instanceof Error ? event.payload : new Error(String(event.payload));
    report({ kind: "stylesheet-preload", level: "page", error, componentStack: "" });
  };
  win.addEventListener("vite:preloadError", onPreloadError);
  return () => win.removeEventListener("vite:preloadError", onPreloadError);
}

// React.lazy keeps a failed code download failed, so for those only a reload
// helps (usually a deploy replaced the old files). Safari reports a chunk that
// the single-page fallback answered with the app's HTML as "'text/html' is not
// a valid JavaScript MIME type".
const CODE_LOAD_FAILURE = /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk|ChunkLoadError|Unable to preload CSS|not a valid JavaScript MIME type/i;

/** @param {unknown} error */
export function isCodeLoadError(error) {
  return CODE_LOAD_FAILURE.test(String(/** @type {any} */ (error)?.message ?? error ?? ""));
}
