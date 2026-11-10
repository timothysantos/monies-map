// Subscriptions and bills' choices (DOMAIN.md "Repeating Charge", owner
// decision D3: household-wide, with an audit event):
//
// - POST /api/repeating-charges/choice  { seriesKey, action, displayName?, choice? }
//   action: keep | take_off | show_again | rename | restore (Undo, with the
//   `previous` choice and name a command answered). Answers
//   { ok, seriesKey, previous, current }.
//
// No AI. A cross-site write never reaches here (cross-site-guard.ts).

import { DEFAULT_HOUSEHOLD_ID } from "../domain/app-repository-constants";
import { chooseRepeatingCharge, RepeatingChoiceRefused } from "../domain/app-repository-repeating-charges";
import { getAuthenticatedEmail } from "./access-identity";
import { json } from "./json";
import { readJsonObject, RequestBodyTooLargeError, SMALL_JSON_MAX_BYTES } from "./limited-body";

export const REPEATING_CHOICE_PATH = "/api/repeating-charges/choice";

// The person signed in, for "who chose": null without a login.
async function loginPersonId(db: D1Database, request: Request) {
  const email = getAuthenticatedEmail(request);
  if (!email) {
    return null;
  }
  try {
    const row = await db.prepare("SELECT person_id FROM login_identities WHERE household_id = ? AND provider = ? AND email = ? LIMIT 1")
      .bind(DEFAULT_HOUSEHOLD_ID, "cloudflare_access", email)
      .first<{ person_id: string }>();
    return row?.person_id ?? null;
  } catch {
    return null;
  }
}

export async function handleRepeatingChoiceRoute(request: Request, env: { DB: D1Database }): Promise<Response> {
  if (request.method !== "POST") {
    return json({ ok: false, error: "Choices only answer POST." }, 405, { Allow: "POST" });
  }
  let body: Record<string, unknown>;
  try {
    body = await readJsonObject<Record<string, unknown>>(request, SMALL_JSON_MAX_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return json({ ok: false, error: error.message }, 413);
    }
    return json({ ok: false, error: "That request could not be read." }, 400);
  }
  try {
    const personId = await loginPersonId(env.DB, request);
    const result = await chooseRepeatingCharge(env.DB, {
      seriesKey: body.seriesKey,
      action: body.action,
      displayName: body.displayName,
      choice: body.choice,
      personId
    });
    return json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof RepeatingChoiceRefused) {
      return json({ ok: false, error: error.message }, 400);
    }
    throw error;
  }
}
