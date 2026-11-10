// Cards and rewards (DOMAIN.md "Card reward rule"). No AI anywhere.
//
// - GET  /api/card-rewards?view=…   Summary's "Miles and cashback" card.
// - GET  /api/card-rewards/rules    Settings' card list and "Suggest cards from".
// - POST /api/card-rewards/rules    { action: save | reset | restore, accountId, rules? }
//   Answers { ok, accountId, previous, current } (previous is what Undo
//   restores; null: not set up).
// - POST /api/card-rewards/suggest-from  { from: household | own }
//   Answers { ok, previous, current }.
//
// A cross-site write never reaches here (cross-site-guard.ts).

import { DEFAULT_HOUSEHOLD_ID } from "../domain/app-repository-constants";
import { CardRewardChangeRefused, changeCardRewardRules, saveCardRewardSuggestFrom } from "../domain/app-repository-card-rewards";
import { buildCardRewardRulesDto, buildCardRewardsDto } from "../domain/pages/card-rewards";
import { getAuthenticatedEmail } from "./access-identity";
import { json } from "./json";
import { readJsonObject, RequestBodyTooLargeError, SMALL_JSON_MAX_BYTES } from "./limited-body";

export const CARD_REWARDS_PATH = "/api/card-rewards";
export const CARD_REWARD_RULES_PATH = "/api/card-rewards/rules";
export const CARD_REWARD_SUGGEST_FROM_PATH = "/api/card-rewards/suggest-from";
export const CARD_REWARD_PATHS = new Set([CARD_REWARDS_PATH, CARD_REWARD_RULES_PATH, CARD_REWARD_SUGGEST_FROM_PATH]);

async function loginPersonId(db: D1Database, request: Request) {
  const email = getAuthenticatedEmail(request);
  if (!email) return null;
  try {
    const row = await db.prepare("SELECT person_id FROM login_identities WHERE household_id = ? AND provider = ? AND email = ? LIMIT 1")
      .bind(DEFAULT_HOUSEHOLD_ID, "cloudflare_access", email)
      .first<{ person_id: string }>();
    return row?.person_id ?? null;
  } catch {
    return null;
  }
}

async function readBody(request: Request): Promise<Record<string, unknown> | Response> {
  try {
    return await readJsonObject<Record<string, unknown>>(request, SMALL_JSON_MAX_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return json({ ok: false, error: error.message }, 413);
    return json({ ok: false, error: "That request could not be read." }, 400);
  }
}

/**
 * The writes. Reads go through the Worker's page response (timing and
 * errors) via `read`, which the caller supplies.
 */
export async function handleCardRewardsRoute(
  request: Request,
  env: { DB: D1Database },
  url: URL,
  read: (name: string, build: () => Promise<unknown>) => Promise<Response>
): Promise<Response> {
  if (url.pathname === CARD_REWARDS_PATH) {
    if (request.method !== "GET") return json({ ok: false, error: "Miles and cashback only answers GET." }, 405, { Allow: "GET" });
    return read("Card rewards", () => buildCardRewardsDto(env.DB, url.searchParams.get("view") ?? "household"));
  }
  if (url.pathname === CARD_REWARD_RULES_PATH && request.method === "GET") {
    return read("Card reward rules", () => buildCardRewardRulesDto(env.DB));
  }
  if (request.method !== "POST") {
    return json({ ok: false, error: "Cards and rewards changes only answer POST." }, 405, { Allow: url.pathname === CARD_REWARD_RULES_PATH ? "GET, POST" : "POST" });
  }
  const body = await readBody(request);
  if (body instanceof Response) return body;
  try {
    if (url.pathname === CARD_REWARD_SUGGEST_FROM_PATH) {
      return json({ ok: true, ...(await saveCardRewardSuggestFrom(env.DB, { from: body.from })) });
    }
    const personId = await loginPersonId(env.DB, request);
    const result = await changeCardRewardRules(env.DB, { accountId: body.accountId, action: body.action, rules: body.rules, personId });
    return json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof CardRewardChangeRefused) return json({ ok: false, error: error.message }, 400);
    throw error;
  }
}
