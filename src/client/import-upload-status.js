import { messages } from "./copy/en-SG";

const TITLES = {
  active: messages.imports.uploadStatusWorking,
  success: messages.imports.uploadStatusReady,
  error: messages.imports.uploadStatusError,
  waiting: messages.imports.uploadStatusWaiting
};

/**
 * What the Bring files status box shows. Files added to the queue are not
 * done: they wait for review in the pending tone, and the box opens the
 * queue. Reading (active), a file ready to map or preview (success) and an
 * error keep their own tones.
 *
 * @param {{ tone: string, message: string } | null} status the panel's upload status
 * @param {{ hasWaitingFiles?: boolean }} [context] whether a queued file still waits
 * @returns {{ tone: string, title: string, message: string, role: string, opensQueue: boolean } | null}
 *   null when there is nothing to show (no status, or a waiting status with
 *   nothing left waiting)
 */
export function describeUploadStatus(status, { hasWaitingFiles = false } = {}) {
  if (!status) {
    return null;
  }
  const isWaiting = status.tone === "waiting";
  if (isWaiting && !hasWaitingFiles) {
    return null;
  }
  return {
    tone: status.tone,
    title: TITLES[status.tone] ?? messages.imports.uploadStatusWorking,
    message: status.message,
    role: status.tone === "error" ? "alert" : "status",
    opensQueue: isWaiting
  };
}
