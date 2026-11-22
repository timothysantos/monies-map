# Many receipts at once: privacy, cost and write boundaries

Owner-approved 2026-11-22. Flow: `docs/flows/ask-flow.md` "Many receipts at
once". Terms: DOMAIN.md "Receipt Batch", "Receipt Match". This note is the
AI-slice audit AGENTS.md asks for ("Optional AI Assistance").

## Privacy

- Each photo goes through the existing receipt path, one at a time: made
  small in the browser (at most 1,600 px), re-encoded as JPEG so no EXIF or
  location leaves the phone, at most 1.5 MiB (a photo still over that is
  read on the device and never sent), JPEG, PNG or WebP only on the Worker,
  read once and discarded. Nothing new reaches the AI provider.
- The original photos live only in the page's memory
  (`ask-receipt-batch.js`, a `Map` by receipt id) until each is read; a
  read photo is dropped at once, an unreadable one is kept for Try again
  until the tab goes. The thumbnails are object URLs of the chosen files,
  shown on this device only and revoked when the page goes.
- The Ask conversation store (`sessionStorage`, this tab only) keeps the
  queue as each receipt's validated read (shop, day, total, currency, card
  ending, items), its match and its outcome. `readStoredReceipts` and the
  store's media filter drop any photo, `blob:` or `data:` value; a test
  proves the stored text has none. A same-photo check keeps a 16-byte
  SHA-256 prefix of the photo's bytes, never the photo.
- `POST /api/ask/receipt-match` takes only the validated fields (shop up to
  80 characters, ISO day, total in minor units, an allow-listed currency,
  at most 40 note lines of 120 characters) through `readJsonObject`
  (64 KiB). No image ever reaches it, and it logs nothing.

## Cost

- One model call per receipt the reader reads, which costs
  `AI_ASSIST_VISION_UNITS` allowance units (2 by default): a go of 10 is
  20 of the day's 100 units in production. Read on the device: nothing.
- When the reader is off, over its allowance, failing or offline, the rest
  of the go are read on the device and the page says so once; the app
  does not keep asking a reader that has said no. A photo the reader could
  not use is read on the device on its own, without switching the rest.
- The match is deterministic SQL and string rules: no AI call, no
  allowance. It reads at most 200 household expense rows within 5 days of
  the receipt (bounded by date and amount in SQL), waiting taps in the same
  window, the saved rates and the habits table: four small reads, three
  sent together.

## Writes

- Nothing is saved without the person's tap on that receipt: Save on its
  entry card (the usual create command, all or nothing), or Update this
  entry / Add the amount on its change card.
- A change card posts only to `ASK_CHANGE_PATHS`: `/api/entries/update-note`
  (the receipt's lines appended to the note, bounded to 600 characters),
  `/api/entries/update-category` (only from a catch-all category to the
  shop's sure habit), each with Undo, and `/api/waiting-taps/complete` (a
  tap waiting for its amount, finished with the receipt's total; added to
  the list for this). No new command and no command change, so no new
  `failingStatement` test: each command's own atomic test still holds.
- Bank facts (amount, date, description, wallet) are never in a receipt
  change, so a statement-certified entry keeps them. The paid foreign
  amount goes into the note, not `original_amount_minor`, because that
  column would turn the entry into an open foreign-currency estimate that
  the next statement import pairs differently.
- The same photo twice, or a receipt whose entry this conversation already
  saved or updated from a receipt, is left out with a line saying why.

## Items and whose they are (second release)

- No new AI call or input: the reader's prompt now also asks for tax,
  service, discount and rounding lines as line items (still at most 30, no
  new field). The app classifies the lines itself and shows them only when
  they add up to the total, so a misread line hides the items rather than
  showing a wrong figure. No Ask turn action names an item or its amount.
- Shares are pure arithmetic in `receipt-items.ts`, saved as the existing
  create command's exact split share (`splitAmountMinor`): no new command,
  no command change, so the create command's atomic test still covers it.
- Items are kept as note lines (at most 900 characters within the
  2,000-character note); no table, so no migration and nothing new to
  delete with an entry. The note can name the two people (whose item);
  it carries no card or account number beyond what the read already
  scrubbed (`cleanText` turns long digit runs into "[number]").

## Unverified

- A real model reading a real batch (the browser tests stub the reader).
- The iPhone photo picker's multi-select and the share sheet on a real
  phone.
