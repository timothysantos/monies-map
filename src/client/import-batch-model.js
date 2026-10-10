import { messages } from "./copy/en-SG";
import { describeIntakeSource, orderIntakeQueue } from "./import-intake-model";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LABEL_LIMIT = 23;

/**
 * The files of this session's import batch, one chip each: the files
 * committed this session (done), the one in review, then the queue in
 * review order. Copies of a file already queued are left out; they cannot
 * be reviewed.
 *
 * @param {object} input
 * @param {{ id: string, label: string, title?: string, importId?: string }[]} input.committedFiles in commit order
 * @param {{ id: string, label: string, title?: string } | null} input.currentFile the file in review
 * @param {object[]} input.queue the intake queue items
 * @param {string | null} input.activeItemId the queue item in review, if any
 * @returns {{ files: { id: string, label: string, title: string, state: string, item?: object, importId?: string }[], index: number, total: number }}
 *   state is "done", "reviewing" or "waiting"; index is the 1-based
 *   position the count shows ("File 2 of 4"), 0 with no files
 */
export function buildImportBatchFiles({ committedFiles, currentFile, queue, activeItemId }) {
  const committedIds = new Set(committedFiles.map((file) => file.id));
  const files = [
    ...committedFiles.map((file) => ({ id: file.id, label: file.label, title: file.title ?? file.label, state: "done", importId: file.importId })),
    ...(currentFile && !committedIds.has(currentFile.id)
      ? [{ id: currentFile.id, label: currentFile.label, title: currentFile.title ?? currentFile.label, state: "reviewing" }]
      : []),
    ...orderIntakeQueue(queue)
      .filter((item) => !item.duplicate && item.id !== activeItemId && item.id !== currentFile?.id && !committedIds.has(item.id))
      .map((item) => ({ id: item.id, label: describeIntakeItemLabel(item), title: item.fileName, state: "waiting", item }))
  ];
  if (!files.length) {
    return { files, index: 0, total: 0 };
  }
  const reviewingIndex = files.findIndex((file) => file.state === "reviewing");
  // With no file in review the count stays on the last one done, or on the
  // first one waiting.
  const index = reviewingIndex >= 0 ? reviewingIndex + 1 : Math.max(1, committedFiles.length);
  return { files, index, total: files.length };
}

/**
 * The file that opens after the one in review is committed or skipped: the
 * first one waiting in review order. Copies of a file already queued are
 * never opened.
 *
 * @param {object[]} queue the intake queue items
 * @param {string | null} activeItemId the queue item in review, if any
 */
export function findNextIntakeItem(queue, activeItemId) {
  return orderIntakeQueue(queue).find((item) => !item.duplicate && item.id !== activeItemId);
}

/**
 * "Skip for now": the queue with `itemId` sent after every other file
 * waiting. The item keeps its parsed rows, so it reopens without the file.
 * Nothing is saved; the queue only lives for this visit to the page.
 *
 * @param {object[]} queue
 * @param {string} itemId
 * @returns {object[]} a new queue, or `queue` itself when the item is not in it
 */
export function skipIntakeItem(queue, itemId) {
  if (!queue.some((item) => item.id === itemId)) {
    return queue;
  }
  const skipOrder = Math.max(0, ...queue.map((item) => item.skipOrder ?? 0)) + 1;
  return queue.map((item) => (item.id === itemId ? { ...item, skipOrder } : item));
}

// The words a commit that also opens the next file uses, by what it saves.
// Saving an empty statement, or one saved before, has none and keeps its
// own words.
const OPEN_NEXT_LABELS = {
  rows: messages.imports.commitAndOpenNext,
  certify_rows: messages.imports.certifyAndOpenNext,
  covered_checkpoint: messages.imports.saveStatementBalanceAndOpenNext
};

/**
 * The commit button's words: "Commit and open next" (or "Save statement
 * balance and open next") while another file waits; the last file, and
 * a commit with no such words, keep their own.
 *
 * @param {{ commitKind?: string, commitLabel: string, nextItem?: object | null }} input
 *   commitKind from buildImportPreviewModel: rows, certify_rows,
 *   covered_checkpoint, saved_again or empty_checkpoint
 */
export function describeCommitLabel({ commitKind = "rows", commitLabel, nextItem }) {
  return nextItem ? OPEN_NEXT_LABELS[commitKind] ?? commitLabel : commitLabel;
}

/** A queued file's short label. */
export function describeIntakeItemLabel(item) {
  return describeImportFileLabel({
    fileName: item.fileName,
    sourceType: item.sourceType,
    parserKey: item.parserKey ?? item.parsed?.parserKey,
    checkpoints: item.parsed?.checkpoints ?? []
  });
}

/**
 * A file's short label: the card or account and month of a statement
 * ("OCBC 360 Account Aug"; a statement of several cards by its bank, "UOB
 * cards May"), the bank of an activity export ("UOB activity"), or the
 * file's name cut to fit.
 */
export function describeImportFileLabel({ fileName = "", sourceType, parserKey = "generic_csv", checkpoints = [] }) {
  const source = describeIntakeSource({ parserKey });
  const month = shortMonth(checkpoints.find((checkpoint) => checkpoint.checkpointMonth)?.checkpointMonth);
  if (sourceType === "pdf" && checkpoints.length && month) {
    if (checkpoints.length === 1) {
      const name = checkpoints[0].accountName ?? checkpoints[0].detectedAccountName;
      if (name) {
        return messages.imports.batchStatementLabel(name, month);
      }
    }
    if (source.bank) {
      return source.kind === "account_statement"
        ? messages.imports.batchManyAccountsLabel(source.bank, month)
        : messages.imports.batchManyCardsLabel(source.bank, month);
    }
  }
  if (source.bank && (source.kind === "card_activity" || source.kind === "account_activity")) {
    return messages.imports.batchActivityLabel(source.bank);
  }
  const name = fileName.trim();
  if (!name) {
    return messages.imports.batchFileFallback;
  }
  return name.length > LABEL_LIMIT + 1 ? `${name.slice(0, LABEL_LIMIT)}…` : name;
}

function shortMonth(value) {
  const month = Number(String(value ?? "").slice(5, 7));
  return month >= 1 && month <= 12 ? MONTHS[month - 1] : "";
}
