// Turns the reading events of an image statement into what the person is
// shown: which reading this is, the page, and how far along it is.
//
// A statement is read once; when amounts are unclear it is read a second
// time and then the unclear amounts are read one by one (import-helpers.js,
// parseImageStatement). The events come from two places that do not know
// about each other: our page loop ("rendering page" / "recognizing text",
// with the page) and the reading engine (a status with a 0..1 progress and
// no page), so the tracker remembers the page between events.
export const OCR_STEPS = { first: 1, second: 2, amounts: 3 };

export function createOcrProgressTracker() {
  let step = OCR_STEPS.first;
  let pageNumber;
  let pageCount;
  let pageProgress = 0;
  let fraction = 0;

  return function track(event = {}) {
    if (event.step && event.step !== step) {
      step = event.step;
      pageNumber = undefined;
      pageProgress = 0;
      fraction = 0;
    }
    if (event.pageNumber && event.pageCount) {
      if (event.pageNumber !== pageNumber) {
        pageProgress = 0;
      }
      pageNumber = event.pageNumber;
      pageCount = event.pageCount;
    }
    // Only the engine's own reading progress moves a page forward; loading
    // the engine also reports a 0..1 progress that is not about the page.
    if (event.status === "recognizing text" && typeof event.progress === "number" && Number.isFinite(event.progress)) {
      pageProgress = Math.max(pageProgress, Math.min(1, Math.max(0, event.progress)));
    }
    if (pageNumber && pageCount) {
      // Never runs backwards inside one reading.
      fraction = Math.max(fraction, Math.min(1, (pageNumber - 1 + pageProgress) / pageCount));
    }
    return {
      step,
      ...(pageNumber && pageCount ? { pageNumber, pageCount } : {}),
      fraction
    };
  };
}

// Adds the reading's step to every event a pass reports.
export function withOcrStep(onProgress, step) {
  return onProgress ? (event = {}) => onProgress({ ...event, step }) : undefined;
}
