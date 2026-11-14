// Waiting files (DOMAIN.md "Waiting File"): statement and activity files the
// household sends to Monies Map from a phone or Mac share sheet. They wait,
// unread, until Imports opens them for the normal review. Every figure here
// is a judgement call, not a platform limit; change it here only.

// How long a file waits before it is deleted for good, unopened.
export const WAITING_FILE_RETENTION_DAYS = 30;

// One file: bank statements are well under 2 MiB; 10 MiB leaves room for an
// image-only (scanned) PDF.
export const WAITING_FILE_MAX_BYTES = 10 * 1024 * 1024;

// One request (several files plus the form's own bytes).
export const WAITING_FILES_REQUEST_MAX_BYTES = 25 * 1024 * 1024;

// Files in one request; a share of a whole folder is refused, not trimmed.
export const WAITING_FILES_PER_REQUEST_MAX = 10;

// Files received in one day (Singapore day), whichever way they came. A
// month's statements and exports for the household are about 15.
export const WAITING_FILES_DAILY_LIMIT = 40;

// Files waiting at once. Past this a new file is refused until some are
// imported or removed, so the store cannot grow without anyone looking.
export const WAITING_FILES_MAX_WAITING = 40;

// The stored bytes are split into rows of at most this size. D1 allows
// 2,000,000 bytes per value; half a MiB keeps every row far below it.
export const WAITING_FILE_CHUNK_BYTES = 512 * 1024;

// The one public path (POST only) the share-sheet Shortcut sends files to.
// It is exempt from Cloudflare Access and carries its own key instead.
export const WAITING_FILES_INTAKE_PATH = "/api/shortcuts/files/send";

// How a file arrived. Stored as plain text (no CHECK constraint) so another
// way in, for example a mailbox reader, can be added without a migration.
export const WAITING_FILE_ARRIVALS = ["shortcut"] as const;
export type WaitingFileArrival = (typeof WAITING_FILE_ARRIVALS)[number];
