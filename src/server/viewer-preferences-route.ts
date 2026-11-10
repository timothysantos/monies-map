// The signed-in person's display choices (DOMAIN.md "Lead View", "Plan view").
//
// - POST /api/viewer-preferences/lead-view { leadView: "plan" | "simple" }
// - POST /api/viewer-preferences/plan-mode { planMode: "studio" | "tables" }
//
// The read rides on the app shell (`leadView`, `planMode`), so a page load
// makes no extra request. The write needs a login: the verified Cloudflare
// Access identity (getAuthenticatedEmail). Without one it is refused (401) and
// the page keeps the choice on the device. A cross-site write never reaches
// here (cross-site-guard.ts, checked for every request in src/index.ts).

import {
  isLeadViewPreference,
  isPlanModePreference,
  isSummaryCardsPreference,
  saveLeadViewPreference,
  savePlanModePreference,
  saveSummaryCardsPreference
} from "../domain/app-repository-viewer-preferences";
import { getAuthenticatedEmail } from "./access-identity";
import { json } from "./json";
import { readJsonObject, RequestBodyTooLargeError } from "./limited-body";

export const LEAD_VIEW_PATH = "/api/viewer-preferences/lead-view";
export const PLAN_MODE_PATH = "/api/viewer-preferences/plan-mode";
// { summaryCards: "insights,mix,subs,plan,-accounts" | null } (design.md
// "Arrange Summary"; null is the usual order).
export const SUMMARY_CARDS_PATH = "/api/viewer-preferences/summary-cards";
// {"leadView":"simple"} is 20 bytes.
const MAX_BODY_BYTES = 1024;

export function isViewerPreferencesPath(pathname: string) {
  return pathname === LEAD_VIEW_PATH || pathname === PLAN_MODE_PATH || pathname === SUMMARY_CARDS_PATH;
}

export async function handleViewerPreferencesRoute(request: Request, url: URL, env: { DB: D1Database }): Promise<Response | null> {
  if (!isViewerPreferencesPath(url.pathname) || request.method !== "POST") {
    return null;
  }
  const email = getAuthenticatedEmail(request);
  if (!email) {
    return json({ ok: false, error: "No signed-in login to remember this for." }, 401);
  }
  let body: { leadView?: unknown; planMode?: unknown; summaryCards?: unknown };
  try {
    body = await readJsonObject<{ leadView?: unknown; planMode?: unknown; summaryCards?: unknown }>(request, MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return json({ ok: false, error: error.message }, 413);
    }
    throw error;
  }
  if (url.pathname === SUMMARY_CARDS_PATH) {
    if (body.summaryCards !== null && !isSummaryCardsPreference(body.summaryCards)) {
      return json({ ok: false, error: "That card order is not one Summary knows." }, 400);
    }
    return json({ ok: true, ...(await saveSummaryCardsPreference(env.DB, email, body.summaryCards ?? null)) });
  }
  if (url.pathname === PLAN_MODE_PATH) {
    if (!isPlanModePreference(body.planMode)) {
      return json({ ok: false, error: "Choose Sliders or List." }, 400);
    }
    return json({ ok: true, ...(await savePlanModePreference(env.DB, email, body.planMode)) });
  }
  if (!isLeadViewPreference(body.leadView)) {
    return json({ ok: false, error: "Choose Plan or Simple." }, 400);
  }
  return json({ ok: true, ...(await saveLeadViewPreference(env.DB, email, body.leadView)) });
}
