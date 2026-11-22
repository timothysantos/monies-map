import assert from "node:assert/strict";
import test from "node:test";

import { createOcrProgressTracker, withOcrStep, OCR_STEPS } from "../src/client/import-ocr-progress.js";
import { importMessages } from "../src/client/copy/en-SG-imports.js";
import { describeUploadStatus } from "../src/client/import-upload-status.js";

test("the page and the engine's progress are combined into how far the reading is", () => {
  const track = createOcrProgressTracker();
  assert.deepEqual(track({ status: "rendering page", pageNumber: 1, pageCount: 2 }), { step: 1, pageNumber: 1, pageCount: 2, fraction: 0 });
  // The engine reports progress with no page: the tracker keeps the page.
  assert.deepEqual(track({ status: "recognizing text", progress: 0.5 }), { step: 1, pageNumber: 1, pageCount: 2, fraction: 0.25 });
  assert.equal(track({ status: "recognizing text", progress: 1 }).fraction, 0.5);
  assert.equal(track({ status: "rendering page", pageNumber: 2, pageCount: 2 }).fraction, 0.5);
  assert.equal(track({ status: "recognizing text", progress: 0.5 }).fraction, 0.75);
});

test("negative: engine loading progress and a lower figure never move the bar", () => {
  const track = createOcrProgressTracker();
  track({ status: "rendering page", pageNumber: 1, pageCount: 2 });
  // Loading the engine also reports 0..1; it is not about the page.
  assert.equal(track({ status: "loading language traineddata", progress: 0.9 }).fraction, 0);
  track({ status: "recognizing text", progress: 0.8 });
  assert.equal(track({ status: "recognizing text", progress: 0.2 }).fraction, 0.4);
  assert.equal(track({ status: "recognizing text", progress: Number.NaN }).fraction, 0.4);
  assert.equal(track({}).fraction, 0.4);
});

test("a second reading starts its own count and says which reading it is", () => {
  const track = createOcrProgressTracker();
  track({ status: "rendering page", pageNumber: 2, pageCount: 2 });
  track({ status: "recognizing text", progress: 1 });
  const second = withOcrStep(track, OCR_STEPS.second);
  assert.deepEqual(second({ status: "rendering page", pageNumber: 1, pageCount: 2 }), { step: 2, pageNumber: 1, pageCount: 2, fraction: 0 });
  assert.equal(second({ status: "recognizing text", progress: 0.5 }).fraction, 0.25);
  const amounts = withOcrStep(track, OCR_STEPS.amounts);
  assert.deepEqual(amounts({ status: "rendering page", pageNumber: 2, pageCount: 2 }), { step: 3, pageNumber: 2, pageCount: 2, fraction: 0.5 });
  assert.equal(withOcrStep(undefined, 2), undefined);
});

test("the reading line says the reading, the page and the share read, in plain words", () => {
  assert.equal(
    importMessages.uploadOcrProgress({ fileName: "hsbc.pdf", step: 1, pageNumber: 1, pageCount: 2, fraction: 0.25 }),
    "Reading hsbc.pdf in this browser. Page 1 of 2, 25% done. Nothing leaves this device."
  );
  assert.equal(
    importMessages.uploadOcrProgress({ fileName: "hsbc.pdf", step: 2, pageNumber: 2, pageCount: 2, fraction: 0.75 }),
    "Some amounts in hsbc.pdf were unclear, so it is being read a second time. Page 2 of 2, 75% done."
  );
  assert.equal(
    importMessages.uploadOcrProgress({ fileName: "hsbc.pdf", step: 3, pageNumber: 1, pageCount: 2, fraction: 0 }),
    "Checking the unclear amounts in hsbc.pdf one by one. Page 1 of 2, 0% done."
  );
  // Before the first page is known there is no page or share to show.
  assert.equal(
    importMessages.uploadOcrProgress({ fileName: "hsbc.pdf", step: 1, fraction: 0 }),
    "Reading hsbc.pdf in this browser. Getting ready. Nothing leaves this device."
  );
  for (const step of [1, 2, 3]) {
    assert.doesNotMatch(importMessages.uploadOcrProgress({ fileName: "a.pdf", step, pageNumber: 1, pageCount: 1, fraction: 0.5 }), /OCR|recogniz|render|pass\b/i);
  }
});

test("the status box carries the share read only while a reading reports one", () => {
  assert.equal(describeUploadStatus({ tone: "active", message: "Reading", progress: 0.4 }).progress, 0.4);
  assert.equal(describeUploadStatus({ tone: "active", message: "Reading" }).progress, undefined);
  assert.equal(describeUploadStatus({ tone: "error", message: "Failed", progress: 0.4 }).progress, undefined);
});
