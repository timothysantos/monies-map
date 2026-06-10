# Stage 4 Parent Flow

This document is the parent flow for the Stage 4 closure audit docs.

It explains the common flow shape that all page-specific docs inherit before
they narrow to one route.

## Scope

This is a navigation and alignment doc, not a full architecture encyclopedia.
Its job is to show how the page flow docs relate to the stabilized Stage 4
implementation.

## Route Flow

The browser route is the source of truth for which page is active.

Common route state:

- `/summary`
- `/month`
- `/entries`
- `/imports`
- `/splits`
- `/settings`

`App.jsx` reads the current location and search params, then chooses the active
route view.

## State Flow

The common state layers are:

- browser route state
- query-backed server state
- workflow state inside the page slice
- transient UI state such as open sheets, dialogs, and pending drafts

The parent rule is that these layers stay distinct. Route state should not
become workflow state, and workflow state should not become hidden shell state.

## Data Flow

The shared server data is split into:

- `GET /api/app-shell`
- `GET /api/summary-page`
- `GET /api/summary-account-pills`
- `GET /api/month-page`
- `GET /api/entries-page`
- `GET /api/imports-page`
- `GET /api/splits-page`
- `GET /api/settings-page`

The browser uses TanStack Query to cache these requests, and each page doc
describes the narrow route data it owns.

## Audit Notes

Before Stage 4 can close, the parent flow doc must stay aligned with:

- the route-data flow docs
- the slice prompts and audits
- the current query ownership tests

Current status: aligned, but must remain under watch if `App.jsx` regains new
coordination duties.

## Known Exceptions / Watch Areas

- `App.jsx` still coordinates the shell and active route hydration.
- explicit shell refresh remains a named exception in settings and some
  reference-data flows.
- shared invalidation helpers still exist and must stay regression-tested.
