// The viewer's Cloudflare Access login email, lower-cased, or undefined.
// Production sits behind Access, which sets this header on every request.
// Local `wrangler dev` and the test Workers have no Access in front, so there
// is no viewer identity unless a request sends the header itself (the
// browser tests do, with Playwright's extraHTTPHeaders).
export function getAuthenticatedEmail(request: Request) {
  return request.headers.get("CF-Access-Authenticated-User-Email")?.trim().toLowerCase()
    || request.headers.get("Cf-Access-Authenticated-User-Email")?.trim().toLowerCase()
    || undefined;
}
