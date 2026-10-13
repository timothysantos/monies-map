// Refuses a browser write that another site triggered (cross-site request
// forgery). The Worker trusts Cloudflare Access for who is calling, and a
// signed-in browser sends its Access cookie with any request to this host,
// including a form or fetch another page makes. The routes also read their
// JSON body whatever its content type, so a plain HTML form could reach
// them. Every browser since 2023 labels each request with Sec-Fetch-Site;
// this refuses a write labelled as coming from anywhere but this app. A
// client that sends no label (curl, the Apple Shortcut, tests, a tool that
// replays a request) is not a browser tricked by a page and is unaffected.
//
// Origin is deliberately not compared: behind the dev proxy and some
// request replayers its host is not the Worker's, and Sec-Fetch-Site is
// already sent by every browser that sends Origin on a write.
//
// Reads are not guarded: another site cannot read the answer (no CORS
// headers are sent).

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function isCrossSiteWrite(request: Request) {
  if (SAFE_METHODS.has(request.method.toUpperCase())) {
    return false;
  }
  const site = request.headers.get("Sec-Fetch-Site")?.trim().toLowerCase();
  // "none" is a request the person typed or bookmarked, never a page's.
  return Boolean(site) && site !== "same-origin" && site !== "none";
}
