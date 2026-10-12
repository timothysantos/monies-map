// Refuses a browser write that another site triggered (cross-site request
// forgery). The Worker trusts Cloudflare Access for who is calling, and a
// signed-in browser sends its Access cookie with any request to this host,
// including a form or fetch another page makes. The routes also read their
// JSON body whatever its content type, so a plain HTML form could reach
// them. A modern browser labels every request with Sec-Fetch-Site (and
// Origin on a write); this refuses a write labelled as coming from anywhere
// but this app. A client that sends neither header (curl, the Apple
// Shortcut, tests) is not a browser tricked by a page and is unaffected.
//
// Reads are not guarded: another site cannot read the answer (no CORS
// headers are sent).

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function isCrossSiteWrite(request: Request, url: URL) {
  if (SAFE_METHODS.has(request.method.toUpperCase())) {
    return false;
  }
  const site = request.headers.get("Sec-Fetch-Site")?.trim().toLowerCase();
  if (site) {
    // "none" is a request the person typed or bookmarked, never a page's.
    return site !== "same-origin" && site !== "none";
  }
  const origin = request.headers.get("Origin")?.trim();
  if (!origin) {
    return false;
  }
  try {
    return new URL(origin).host !== url.host;
  } catch {
    return true;
  }
}
