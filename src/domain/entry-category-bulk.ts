// Limits on changing many entries' categories at once (POST
// /api/entries/update-category with `changes`; Ask's bulk recategorise).
// Pure constants, shared by the command and by Ask's turn validator.

// More rows than this need the person's explicit "Change all N" tap: the
// command refuses them unless `confirmedCount` equals the number of rows.
export const BULK_RECATEGORISE_CONFIRM_ABOVE = 10;
// More rows than this are not changed from Ask at all: Entries' own filter
// and editor are the place for that many.
export const BULK_RECATEGORISE_MAX = 200;
