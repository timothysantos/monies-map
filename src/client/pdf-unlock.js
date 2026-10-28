// Opening a locked (password-protected) statement PDF. Loaded only when a
// file turns out to need a password (import-helpers.js `openPdfDocument`).
//
// The rules (docs/audits/locked-statements.md):
// - The password is asked for before any text reading, OCR or AI step, and
//   is typed on this device only.
// - It lives in this module's closures for as long as one file is read, so
//   the OCR passes that open the same file again do not ask twice. It is
//   never put in React state, a query key, a URL, a request, storage, a log
//   line or an error message; `release()` forgets it.
// - "Use this password for the other locked files" keeps it in memory for
//   the batch only; the Imports page clears it when the batch ends.
// - pdf.js's own errors never contain the password, and ours are built from
//   the file's name and fixed words.

import { holdSecret } from "./memory-secrets";

/** pdf.js `PasswordResponses`: the file needs a password / the one given is wrong. */
export const PASSWORD_NEEDED = 1;
export const PASSWORD_INCORRECT = 2;

/** A courtesy stop, not a security control: the question stops offering tries. */
export const MAX_WRONG_PASSWORDS = 5;

/** A locked statement nobody was there to unlock (a page with no password dialog). */
export class LockedStatementError extends Error {
  constructor(message = "This statement is locked with a password. Add it on the Imports page and you will be asked for the password.") {
    super(message);
    this.name = "LockedStatementError";
  }
}

/** The person chose to skip a locked statement (or ran out of tries). */
export class LockedStatementSkipped extends LockedStatementError {
  /** @param {string} fileName */
  constructor(fileName) {
    super(`${fileName} is locked with a password, so it was skipped.`);
    this.name = "LockedStatementSkipped";
    this.fileName = fileName;
  }
}

/** @param {any} error */
export function isPasswordException(error) {
  return Boolean(error) && error.name === "PasswordException";
}

/**
 * @typedef {{ fileName: string, wrong: boolean, wrongTries: number, maxTries: number, canTryAgain: boolean }} PasswordRequest
 * @typedef {{ password: string, useForBatch: boolean } | null} PasswordAnswer null skips the file
 */

/**
 * One locked file's password handling.
 *
 * @param {object} options
 * @param {string} options.fileName
 * @param {(request: PasswordRequest) => Promise<PasswordAnswer>} options.askPassword shows the question
 * @param {() => string | undefined} [options.getBatchPassword] a password kept for this batch
 * @param {(password: string) => void} [options.setBatchPassword] keeps one for this batch
 * @param {() => void} [options.dismiss] closes the question
 */
export function createPdfUnlocker({ fileName, askPassword, getBatchPassword = () => undefined, setBatchPassword = () => {}, dismiss = () => {} }) {
  /** @type {string | undefined} */
  let password;
  let wrongTries = 0;
  let batchTried = false;
  let useForBatch = false;
  let releaseHold = () => {};
  return {
    fileName,
    /** What to try before asking: this file's own password, then the batch's (once). */
    remembered() {
      if (password) {
        return { password, fromPerson: false };
      }
      const batch = batchTried ? undefined : getBatchPassword();
      if (batch) {
        batchTried = true;
        return { password: batch, fromPerson: false };
      }
      return undefined;
    },
    /**
     * Asks the person. Returns null when they skip, or once they are out of
     * tries (the question then offers skipping only).
     * @param {{ wrong: boolean }} reason
     */
    async ask({ wrong }) {
      if (wrong) {
        wrongTries += 1;
      }
      const canTryAgain = wrongTries < MAX_WRONG_PASSWORDS;
      const answer = await askPassword({ fileName, wrong, wrongTries, maxTries: MAX_WRONG_PASSWORDS, canTryAgain });
      if (!canTryAgain || !answer || !answer.password) {
        return null;
      }
      useForBatch = Boolean(answer.useForBatch);
      // Hidden from any report written while it is held (memory-secrets.js).
      releaseHold();
      releaseHold = holdSecret(answer.password);
      return answer.password;
    },
    /** The file opened: keep the password for this file's later reads. */
    accepted(/** @type {string} */ accepted) {
      password = accepted;
      if (useForBatch) {
        setBatchPassword(accepted);
      }
      dismiss();
    },
    dismiss,
    /** Forgets the password and closes the question. */
    release() {
      password = undefined;
      useForBatch = false;
      releaseHold();
      releaseHold = () => {};
      dismiss();
    }
  };
}

/**
 * The password kept for one batch of files ("Use this password for the other
 * locked files"): in this closure only, hidden from reports while it is kept,
 * and gone on `clear()` (the Imports page calls it when the batch ends or
 * the page is left).
 */
export function createBatchPasswordKeeper() {
  /** @type {string | undefined} */
  let kept;
  let releaseHold = () => {};
  return {
    get: () => kept,
    set(/** @type {string} */ password) {
      releaseHold();
      kept = password;
      releaseHold = holdSecret(password);
    },
    clear() {
      kept = undefined;
      releaseHold();
      releaseHold = () => {};
    }
  };
}

// File to its unlocker, for the length of that file's read. A WeakMap, so the
// import helpers (which only receive the File) can find it without any new
// parameter, and nothing outlives the file.
/** @type {WeakMap<object, ReturnType<typeof createPdfUnlocker>>} */
const unlockers = new WeakMap();

export function attachPdfUnlocker(/** @type {object} */ file, /** @type {ReturnType<typeof createPdfUnlocker>} */ unlocker) {
  unlockers.set(file, unlocker);
}

export function detachPdfUnlocker(/** @type {object} */ file) {
  unlockers.delete(file);
}

/**
 * Opens a PDF that pdf.js refused for want of a password, asking for it until
 * it opens, the person skips, or they run out of tries. Each try reads the
 * file's bytes afresh (pdf.js takes the buffer it is given).
 *
 * @param {object} input
 * @param {{ getDocument: (source: { data: Uint8Array, password?: string, verbosity?: number }) => { promise: Promise<any> } }} input.pdfjs
 * @param {{ name: string, arrayBuffer: () => Promise<ArrayBuffer> }} input.file
 * @param {number} [input.code] why pdf.js refused the first open
 */
export async function openLockedPdf({ pdfjs, file, code = PASSWORD_NEEDED }) {
  const unlocker = unlockers.get(file);
  if (!unlocker) {
    throw new LockedStatementError();
  }
  let refusal = code;
  let candidate = unlocker.remembered();
  for (;;) {
    if (!candidate) {
      const answer = await unlocker.ask({ wrong: refusal === PASSWORD_INCORRECT });
      if (answer === null) {
        unlocker.dismiss();
        throw new LockedStatementSkipped(file.name);
      }
      candidate = { password: answer, fromPerson: true };
    }
    try {
      const data = new Uint8Array(await file.arrayBuffer());
      const document = await pdfjs.getDocument({ data, password: candidate.password, verbosity: 0 }).promise;
      unlocker.accepted(candidate.password);
      return document;
    } catch (error) {
      if (!isPasswordException(error)) {
        unlocker.dismiss();
        throw error;
      }
      // A remembered password that fails is not the person's mistake.
      refusal = candidate.fromPerson ? /** @type {any} */ (error).code : PASSWORD_NEEDED;
      candidate = undefined;
    }
  }
}
