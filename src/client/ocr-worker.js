// One English Tesseract worker from the app's own vendored copy
// (public/vendor/tesseract). Image statements (import-helpers.js) and the
// Ask page's receipt fallback (ask-receipt-image.js) both read through it,
// and both load this module on demand, so it is never part of a page's
// first download. The caller terminates the worker.
export async function createOcrWorker(onProgress, loadError = "Local OCR engine did not load. Try refreshing the app.") {
  const tesseractModule = await importRuntimeModule("/vendor/tesseract/tesseract.esm.min.js");
  const createWorker = resolveTesseractCreateWorker(tesseractModule);
  if (typeof createWorker !== "function") {
    throw new Error(loadError);
  }
  return createWorker("eng", 1, {
    workerPath: "/vendor/tesseract/worker.min.js",
    corePath: "/vendor/tesseract",
    langPath: "/vendor/tesseract",
    gzip: false,
    logger: (message) => {
      if (message?.status) {
        onProgress?.({
          status: message.status,
          progress: typeof message.progress === "number" ? message.progress : undefined
        });
      }
    }
  });
}

function importRuntimeModule(path) {
  return new Function("path", "return import(path)")(path);
}

function resolveTesseractCreateWorker(tesseractModule) {
  return (
    tesseractModule?.createWorker ??
    tesseractModule?.default?.createWorker ??
    globalThis.Tesseract?.createWorker
  );
}
