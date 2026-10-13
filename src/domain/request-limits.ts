// The size caps the Worker enforces on what a person types or sends, in one
// place so the routes that refuse an oversized request and the page that
// warns about it before sending agree (src/client/input-limits.js,
// docs/audits/ai-security-review.md F4 and F5).

// An Ask message, after spaces are collapsed: the turn, answer and plan
// routes all refuse a longer one.
export const ASK_MESSAGE_MAX_LENGTH = 300;

// A receipt photo as sent to the receipt reader (1.5 MiB).
export const RECEIPT_IMAGE_MAX_BYTES = 1_572_864;

// Import help: the optional statement-text fallback, the duplicate ranking
// and the mismatch explanation each read a JSON body up to these sizes.
export const STATEMENT_TEXT_MAX_BYTES = 64 * 1024;
export const MATCH_PAIRS_MAX_BYTES = 256 * 1024;
export const IMPORT_PREVIEW_MAX_BYTES = 4 * 1024 * 1024;
