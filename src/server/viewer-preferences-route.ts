// The signed-in person's lead view, Plan or Simple (DOMAIN.md "Lead View").
//
// - POST /api/viewer-preferences/lead-view { leadView: "plan" | "simple" }
//
// The read rides on the app shell (`leadView`), so a page load makes no extra
// request. The write needs a login: the verified Cloudflare Access identity
// (getAuthenticatedEmail). Without one it is refused (401) and the page keeps
// the choice on the device. A cross-site write never reaches here
// (cross-site-guard.ts, checked for every request in src/index.ts).

import { isLeadViewPreference, saveLeadViewPreference } from "../domain/app-repository-viewer-preferences";
import { getAuthenticatedEmail } from "./access-identity";
import { json } from "./json";
import { readJsonObject, RequestBodyTooLargeError } from "./limited-body";

export const LEAD_VIEW_PATH = "/api/viewer-preferences/lead-view";
// {"leadView":"simple"} is 20 bytes.
const MAX_BODY_BYTES = 1024;

export async function handleViewerPreferencesRoute(request: Request, url: URL, env: { DB: D1Database }): Promise<Response | null> {
  if (url.pathname !== LEAD_VIEW_PATH || request.method !== "POST") {
    return null;
  }
  const email = getAuthenticatedEmail(request);
  if (!email) {
    return json({ ok: false, error: "No signed-in login to remember this for." }, 401);
  }
  let body: { leadView?: unknown };
  try {
    body = await readJsonObject<{ leadView?: unknown }>(request, MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return json({ ok: false, error: error.message }, 413);
    }
    throw error;
  }
  if (!isLeadViewPreference(body.leadView)) {
    return json({ ok: false, error: "Choose Plan or Simple." }, 400);
  }
  return json({ ok: true, ...(await saveLeadViewPreference(env.DB, email, body.leadView)) });
}
