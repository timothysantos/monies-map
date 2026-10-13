// The viewer's Cloudflare Access login email, lower-cased, or undefined.
//
// When the Worker verifies the Access token (ACCESS_JWT_MODE report or
// enforce, src/server/access-jwt.ts), checkAccess records the token's email
// for the request and that is the identity: the plain header is ignored, so
// a request cannot name someone else by sending it. With verification off
// (local `wrangler dev`, the test and demo Workers) the
// CF-Access-Authenticated-User-Email header names the viewer, which the
// browser tests send with Playwright's extraHTTPHeaders. In report mode a
// request whose token failed is served as before, from the header.
const verifiedIdentities = new WeakMap<Request, { email: string | undefined }>();

export function rememberVerifiedIdentity(request: Request, email: string | undefined) {
  verifiedIdentities.set(request, { email });
}

export function getAuthenticatedEmail(request: Request) {
  const verified = verifiedIdentities.get(request);
  if (verified) {
    return verified.email;
  }
  return request.headers.get("CF-Access-Authenticated-User-Email")?.trim().toLowerCase()
    || undefined;
}
