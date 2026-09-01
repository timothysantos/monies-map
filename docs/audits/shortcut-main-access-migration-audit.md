# Main Worker Shortcut Access Migration Audit

Date: 2026-09-01

## Objective

Move the Apple Shortcut public ingress to the exact direct-create path on the
main `monies-map` Worker, while keeping `monies-map-shortcuts` deployed until
the new path has been proved in production.

## Current State

- The live Settings connection URL still targets `monies-map-shortcuts`.
- The legacy Worker is API-only, binds the production D1 database, and exposes
  no static assets.
- The main Worker already implements the same authenticated direct-create
  route, but Cloudflare Access currently protects its hostname.
- Every request still requires the app-managed Shortcut token. Access Bypass
  only makes the exact route reachable; it is not the request authorization.

## Migration Tasks

- [x] Keep the legacy Worker and its Settings endpoint unchanged.
- [x] Reject every non-POST direct-create request before schema/page work.
- [ ] Create a Cloudflare Access self-hosted application for exactly
  `monies-map.timsantos-accts.workers.dev/api/shortcuts/entries/create`.
- [ ] Give only that application a `Bypass` policy matching Everyone.
- [ ] Verify, while signed out of Access:
  - `/` redirects to Cloudflare Access;
  - `POST /api/shortcuts/entries/create` without a token returns JSON `401`;
  - `GET /api/shortcuts/entries/create` returns `405` with `Allow: POST`.
- [ ] Switch `SHORTCUT_PUBLIC_ENDPOINT` to the main Worker hostname.
- [ ] Install and test the newly copied connection URL on iPhone.
- [ ] Retain the legacy Worker until every installed Shortcut has moved; retire
  it only in a separately approved change.

## Boundaries

- Do not bypass Access for `/api/*`, a wildcard path, or the whole Worker.
- Do not remove token, payload, idempotency, timestamp, or nonce validation.
- Do not send the connection URL, token, or ledger data to AI services.
- Cloudflare Access Bypass removes Access enforcement and Access logs only for
  this exact path. Worker validation and application audit events remain the
  authorization evidence.

## Test Evidence

- `tests/shortcut-gateway.test.mjs` proves the direct-create path accepts only
  `POST` and the legacy Worker remains configured while migration is staged.
- Production verification remains blocked until an Access administrator grants
  `Access: Apps and Policies` write permission or configures the exact-path
  Bypass in the Cloudflare dashboard.
