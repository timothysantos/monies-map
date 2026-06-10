# Route, Data, and Rendering Flow

This document explains the current Monies Map app-shell and route-page design
as three related flows:

1. `Route flow`
   Where does the browser say the user is?
2. `Data flow`
   What JSON data does that route need?
3. `Code/rendering flow`
   Has the React code for that route been downloaded and rendered?

The important rule is that these are not the same thing.

When a user clicks `Settings`:

```text
Route flow:
  Browser URL becomes /settings

Data flow:
  App fetches /api/settings-page and receives SettingsPageDto JSON

Code/rendering flow:
  Browser loads settings-panel.jsx, then React renders <SettingsPanel />
```

These three flows meet inside [`src/client/App.jsx`](../src/client/App.jsx).

## Why this doc exists

The refactor introduced many small rules:

- `app shell` is not the old all-in-one bootstrap payload
- `route pages` fetch screen-specific JSON separately
- `App.jsx` is the orchestrator, not a hidden page service
- `route-context.ts` is only for route interpretation and context resolution
- `page-labels.ts` is label-only
- cross-route business rules belong in dedicated domain modules

Those rules are easy to lose track of if you only read the code one file at a
time. This doc explains the current shape in one place.

## Big Picture

Monies Map is one repo with several layers:

```text
Browser client
  -> react-router-dom decides route state
  -> TanStack Query manages server-state cache
  -> React.lazy downloads panel code

Cloudflare Worker server
  -> src/index.ts matches API path
  -> domain DTO builder creates response shape
  -> repository functions read/write D1

Shared design rules
  -> docs define ownership and boundaries
  -> tests enforce query and module boundaries
```

The browser never talks directly to D1. The browser always talks to the Worker
API, and the Worker talks to the database through repository/domain code.

## Core Design Concepts

### App shell

The `app shell` is the lightweight global payload that many screens need.

It includes things like:

- household
- people
- accounts
- categories
- tracked months
- viewer identity and environment

It should not include full route-page payloads.

Old mental model:

```text
/api/bootstrap
  = shell + page data + too much responsibility
```

Current mental model:

```text
/api/app-shell
  = shared shell metadata only

/api/summary-page
/api/summary-account-pills
/api/month-page
/api/entries-page
/api/splits-page
/api/imports-page
/api/settings-page
  = route-specific DTOs and summary-owned slice queries
```

### Route page

A `route page` is the JSON payload for one screen.

Examples:

- `/summary` -> `SummaryPageDto` plus `SummaryAccountPillDto[]`
- `/month` -> `MonthPageDto`
- `/entries` -> `EntriesPageDto`
- `/splits` -> `SplitsPageDto`
- `/imports` -> `ImportsPageDto`
- `/settings` -> `SettingsPageDto`

### DTO

`DTO` means `Data Transfer Object`.

In this repo, a DTO is the intentional JSON contract sent from the Worker to
the browser. DTO builders should shape data, not become hidden workflow
engines.

### Domain-driven design in practical terms

This repo uses domain-driven ideas in a pragmatic way:

- business concepts should have stable names in [`DOMAIN.md`](../DOMAIN.md)
- important behavior should live in named domain modules, not random helpers
- orchestration, repository access, and DTO shaping should stay separate

This is not meant to be academic. It is meant to stop finance rules from
spreading into UI components and generic helper files.

### Vertical slices

The main product areas are slices:

- `summary`
- `month`
- `entries`
- `splits`
- `imports`
- `settings`

Each route-page module should mainly orchestrate one of those workflows.

### Deep modules

A deep module exposes a small public API while hiding internal details.

Good example in this refactor:

- route modules call a small shared route-context API
- they do not need to duplicate month fallback and view resolution logic

Bad example:

- a giant helper file that every slice imports for unrelated reasons

## The Three Flows Together

### One combined diagram

```text
USER ACTION
  click "Month"

ROUTE FLOW
  BrowserRouter
    -> current URL becomes /month?view=person-tim&month=2026-04
    -> App.jsx reads location/search params
    -> getSelectedTabId("/month") returns "month"

DATA FLOW
  App.jsx
    -> buildAppShellParams(...) for shell cache identity
    -> buildRoutePageRequest(...) returns /api/month-page?view=...&month=...&scope=...
    -> TanStack Query checks cache
    -> browser fetches /api/month-page
    -> src/index.ts matches /api/month-page
    -> src/domain/pages/month-page.ts builds MonthPageDto
    -> repository loads D1 data
    -> Worker returns JSON
    -> App.jsx calls buildPageViewFromRouteData(...)

CODE / RENDERING FLOW
  App.jsx
    -> routeModuleLoaders.month() imports ./month-panel.jsx
    -> React.lazy resolves MonthPanel
    -> Suspense renders route fallback while code is loading
    -> previous settled screen may remain visible during route hydration
    -> MonthPanel renders with MonthPageDto-backed props
```

### Why they are separate

The route can change before the data arrives.

The data can arrive before the code chunk finishes downloading.

The code chunk can be ready while the route data is still loading.

That is why the app explicitly manages all three instead of pretending they are
one event.

## Route Flow

### Browser entry point

[`src/client/main.jsx`](../src/client/main.jsx) wraps the app in:

- `BrowserRouter`
- `QueryClientProvider`

Conceptually:

- `BrowserRouter` tells React Router to treat the browser URL as the route
  source of truth
- `QueryClientProvider` gives the app access to the TanStack Query cache

Usage in code:

- `BrowserRouter` provides hooks such as `useLocation`, `useNavigate`,
  `useParams`, and `useSearchParams`
- `QueryClientProvider` provides `useQueryClient`

### React Router imports in App.jsx

The route-related imports in [`src/client/App.jsx`](../src/client/App.jsx) are
conceptually more important than the icon imports.

`NavLink`

- Concept:
  a link component that knows which route it points to
- Usage here:
  top navigation tabs use `NavLink` so the browser URL changes through React
  Router instead of manual DOM navigation

`useLocation`

- Concept:
  read the current browser location object from React Router
- Usage here:
  `App.jsx` uses it to inspect `location.pathname` and decide which top-level
  tab is active

`useSearchParams`

- Concept:
  read and update query-string state
- Usage here:
  `App.jsx` derives `view`, `month`, `scope`, and summary-range parameters from
  the current URL

`useNavigate`

- Concept:
  imperatively change routes from code
- Usage here:
  the deep-link route for opening an entry by `entryId` resolves the correct
  month and then redirects the user to the canonical `/entries?...` route

`useParams`

- Concept:
  read dynamic path parameters from the route
- Usage here:
  the deep-link route reads `entryId`

`Navigate`, `Route`, `Routes`

- Concept:
  React Router components for declarative redirects and route trees
- Usage in the current route model:
  they remain part of the routing library vocabulary, but the current top-level
  shell flow is more hook-driven than route-tree-driven inside `App.jsx`

### Route helpers in app-routing.js

[`src/client/app-routing.js`](../src/client/app-routing.js) is the small client
module that translates browser route state into app concepts.

`sanitizeTabParams(params, tabId)`

- Concept:
  strip query-string keys that do not belong to the current tab
- Why:
  canonical URLs and canonical query keys matter for stable cache behavior

`getSelectedTabId(pathname)`

- Concept:
  map browser pathname to the app's tab identity
- Why:
  the app needs a stable internal tab id like `summary`, `month`, or `settings`
  even though the browser only stores strings in the URL

`buildRoutePageRequest(...)`

- Concept:
  convert route state into the exact API request the server expects
- Why:
  this is the bridge between route flow and data flow

`buildPageViewFromRouteData(...)`

- Concept:
  shape raw route-page JSON into the minimal object the UI panels need
- Why:
  the UI should not need to understand every server response variant directly

## Data Flow

### Shell cache identity

[`src/client/app-shell-query.js`](../src/client/app-shell-query.js) owns the
app-shell cache identity and persistence helpers.

`buildAppShellParams(...)`

- Concept:
  construct the normalized parameters that define the shell request identity
- Why:
  shell cache identity must be stable or the browser will treat equivalent
  requests as different cache entries

`readPersistedAppShell(...)` / `writePersistedAppShell(...)`

- Concept:
  keep a local persisted copy of the last valid shell payload
- Why:
  a reload can show stable reference data sooner without waiting for a full
  fresh shell fetch

`clearPersistedAppShell()`

- Concept:
  delete stale persisted shell data after mutations that change shell-level
  reference data

### Query keys and invalidation

[`src/client/query-keys.js`](../src/client/query-keys.js) normalizes the cache
keys used by TanStack Query.

Important idea:

```text
same logical request
  -> same normalized query key
different logical request
  -> different query key
```

[`src/client/query-mutations.js`](../src/client/query-mutations.js) owns narrow
invalidation rules.

Examples:

- entry mutations invalidate exact `entries-page`, `month-page`, and
  `summary-page` keys
- shell refresh only invalidates the `app-shell` key

This is one of the main design shifts away from the old broad refresh model.

### Query concepts from TanStack Query

`useQueryClient`

- Concept:
  get the shared client-side query cache/controller
- Usage here:
  `App.jsx` uses `queryClient` to:
  - read cached data
  - fetch route-page data
  - remove stale route-page state
  - prefetch route pages
  - invalidate data after writes

Important query-client methods used in `App.jsx`:

- `getQueryData`
  read already-cached data
- `getQueryState`
  inspect whether a query is idle, fetching, or settled
- `ensureQueryData`
  load data if missing, otherwise reuse cache
- `fetchQuery`
  explicitly fetch fresh data
- `cancelQueries`
  stop stale work from continuing
- `removeQueries`
  clear stale cached data when the shell/request identity changes
- `setQueryData`
  seed cache from persisted shell data

### Server route handling

[`src/index.ts`](../src/index.ts) is the Cloudflare Worker entry point.

It matches incoming URLs such as:

- `/api/app-shell`
- `/api/summary-page`
- `/api/summary-account-pills`
- `/api/month-page`
- `/api/entries-page`
- `/api/splits-page`
- `/api/imports-page`
- `/api/settings-page`

Conceptually:

```text
HTTP request path
  -> route match in src/index.ts
  -> call the correct DTO builder
  -> return JSON response
```

This file is not the place for business rules. It is the HTTP dispatcher.

### Shell DTO layer

[`src/domain/app-shell-dto.ts`](../src/domain/app-shell-dto.ts) builds the DTO
for shell-oriented endpoints.

Important exports:

- `buildAppShellDto`
- `buildEntriesShellDto`

Conceptually:

- DTO layer decides the JSON response shape
- it should not become a hidden repository layer

### Shell orchestration layer

[`src/domain/app-shell.ts`](../src/domain/app-shell.ts) owns shell orchestration
and shell-shared DTO builders.

Examples of what belongs here:

- `loadAppShellContext`
- `ensureAppData`
- `loadPageShell`
- shared shell-oriented DTO shaping

Examples of what does not belong here:

- route-specific route interpretation
- route-specific business logic
- cross-route mega-helper behavior

### Shared route interpretation

[`src/domain/route-context.ts`](../src/domain/route-context.ts) is the narrow
shared route-interpretation layer.

Allowed exports:

- `loadRoutePageContext`
- `resolveEffectiveMonth`
- `resolvePageViewId`

Conceptually this file answers:

- given a requested route, what is the valid view?
- given a requested month, what is the effective tracked month?
- how should route context be resolved before route-specific business logic runs?

It should not grow into:

- authorization
- permissions
- feature flags
- budgeting logic
- reconciliation rules
- split calculations
- account visibility policy

### Shared route labels

[`src/domain/page-labels.ts`](../src/domain/page-labels.ts) is even narrower.

Allowed export:

- `resolvePageLabel`

This file exists so route label shaping does not get mixed back into
route-context resolution or finance logic.

### Route-page DTO builders

[`src/domain/pages/`](../src/domain/pages) contains one route-page module per
screen:

- `summary-page.ts`
- `month-page.ts`
- `entries-page.ts`
- `splits-page.ts`
- `imports-page.ts`
- `settings-page.ts`

Their job is to orchestrate route-specific data loading and DTO shaping.

They should not become:

- giant feature god objects
- repository replacements
- generic helper libraries

### Repository/database layer

[`src/domain/app-repository.ts`](../src/domain/app-repository.ts) and related
repository files own database access.

Conceptually:

```text
DTO builder
  asks repository for data

repository
  talks to D1
```

This boundary matters because route modules should not contain raw database
query logic if it can stay in repository modules.

## Code and Rendering Flow

### React imports that matter for this flow

`lazy`

- Concept:
  code-split a component so it loads only when needed
- Usage here:
  each top-level panel is loaded through `routeModuleLoaders` and `React.lazy`

`Suspense`

- Concept:
  show a fallback while lazy-loaded code is still downloading
- Usage here:
  route panels can show an in-panel fallback while the chunk loads

`useState`

- Concept:
  local component state
- Usage here:
  shell payload, loading status, and mobile-sheet state all live in `App.jsx`

`useMemo`

- Concept:
  memoize derived values from current inputs
- Usage here:
  route-derived request objects and shaped page views are memoized instead of
  re-derived noisily on every render

`useEffect`

- Concept:
  run side effects after render
- Usage here:
  fetch coordination, polling, cross-tab sync listeners, deep-link resolution,
  and document-title updates use effects

`useRef`

- Concept:
  hold mutable values across renders without causing rerenders
- Usage here:
  refs help keep route hydration continuity without creating a second route
  state store

`useCallback`

- Concept:
  keep callback identity stable when the callback is reused as a dependency
- Usage here:
  fetch and refresh helpers in `App.jsx` rely on stable callback references

`createPortal`

- Concept:
  render React UI into a different DOM location than the normal component tree
- Usage here:
  some overlays and popovers are portaled so they can escape local layout
  constraints

### UI infrastructure imports that matter

`@radix-ui/react-dialog`

- Concept:
  accessible modal dialog primitives
- Usage here:
  mobile context and login registration overlays

`@radix-ui/react-popover`

- Concept:
  accessible anchored popover primitives
- Usage here:
  period pickers and overflow navigation

These are UI infrastructure, not route-state infrastructure, but they matter to
rendering flow because some route controls are rendered through them.

### Code splitting in App.jsx

`routeModuleLoaders`

- Concept:
  a registry from route id to dynamic `import(...)`
- Usage here:
  `summary`, `month`, `entries`, `splits`, `imports`, `settings`, and `faq`
  each have a lazy-loaded panel module

`preloadRouteModule(routeId)`

- Concept:
  speculative chunk warmup
- Usage here:
  the app can prefetch code bundles without changing the active route or
  current data

### The route affordance

The `route affordance` is the visible hint that a new route is hydrating.

It is:

- a slim loading marker inside the route area
- a continuity signal

It is not:

- a full-screen startup wall
- a global shell reset
- permission to blank the old screen immediately

Analogy:

```text
Seatbelt light in a car
  not
dashboard power-off
```

### Hydration continuity

One of the important refactor rules is:

```text
The last settled screen may stay visible
while the next route page hydrates.
```

That is why a route transition can look like:

```text
URL says "Entries"
but the old Summary screen remains visible briefly
until EntriesPageDto and EntriesPanel are ready
```

That is intentional. It avoids a blank shell while still keeping the browser
route as the source of truth.

## File and Module Rules Created During the Refactor

These are the rules that got progressively tightened during the refactor.

### App-level rules

- [`src/client/App.jsx`](../src/client/App.jsx) is the orchestrator
- it is allowed to coordinate route flow, data flow, and rendering flow
- it is not allowed to become a hidden feature service for every slice

### Shell rules

- [`src/domain/app-shell.ts`](../src/domain/app-shell.ts) owns shell
  orchestration and shell-shared DTO builders
- it must not absorb route-specific fragments again

### Shared route-context rules

- [`src/domain/route-context.ts`](../src/domain/route-context.ts) is only for
  route interpretation and context resolution
- if logic belongs mainly to one route, it stays in that route module
- if logic is cross-route financial business logic, it goes in a dedicated
  domain module instead

### Shared label rules

- [`src/domain/page-labels.ts`](../src/domain/page-labels.ts) is label-only

### Route-page rules

- [`src/domain/pages/*.ts`](../src/domain/pages) own route-specific DTO
  builders
- they orchestrate data loading for one screen
- they should not turn into `settings-everything.ts` or another giant feature
  dump

### Repository rules

- repository modules own storage access
- route-page DTO builders should call repository/domain functions, not embed raw
  persistence behavior everywhere

### Query rules

- query keys must be deterministic
- invalidation must be narrow
- visible route work should prefer exact keys over global refresh

## Tests That Enforce the Architecture

### Boundary test

[`tests/domain-boundaries.test.mjs`](../tests/domain-boundaries.test.mjs)
enforces the split between route interpretation and labels.

It checks that:

- `route-context.ts` only imports `./app-shell`
- `route-context.ts` only exports:
  - `loadRoutePageContext`
  - `resolveEffectiveMonth`
  - `resolvePageViewId`
- `page-labels.ts` only exports `resolvePageLabel`
- `page-labels.ts` has no imports

This is stronger than comments because it fails if the shared route-context
layer silently grows into a broader service.

### App-shell and route-transition E2E tests

[`tests/e2e/app-shell.spec.js`](../tests/e2e/app-shell.spec.js) protects the
user-visible contract.

It checks things like:

- app shell request stays shell-only
- previous screen stays visible until the next page settles
- month-to-summary and summary round-trip hydration do not crash
- every top-level tab renders in one browser session without console errors

### Query-contract test

[`tests/query-foundation.test.mjs`](../tests/query-foundation.test.mjs)
protects query-key normalization and exact invalidation behavior.

It checks things like:

- app-shell query key normalization
- exact app-shell invalidation
- exact month/entries/summary invalidation after relevant mutations

## Reading Order

If you want to understand this architecture without getting lost:

1. [`docs/architecture.md`](./architecture.md)
2. [`docs/code-spec.md`](./code-spec.md)
3. [`docs/app-shell-flow.md`](./app-shell-flow.md)
4. this document
5. [`src/client/App.jsx`](../src/client/App.jsx)
6. [`src/client/app-routing.js`](../src/client/app-routing.js)
7. [`src/client/app-shell-query.js`](../src/client/app-shell-query.js)
8. [`src/index.ts`](../src/index.ts)
9. [`src/domain/app-shell-dto.ts`](../src/domain/app-shell-dto.ts)
10. [`src/domain/app-shell.ts`](../src/domain/app-shell.ts)
11. [`src/domain/route-context.ts`](../src/domain/route-context.ts)
12. [`src/domain/page-labels.ts`](../src/domain/page-labels.ts)
13. [`src/domain/pages/`](../src/domain/pages)
14. [`tests/domain-boundaries.test.mjs`](../tests/domain-boundaries.test.mjs)
15. [`tests/e2e/app-shell.spec.js`](../tests/e2e/app-shell.spec.js)

## Short Summary

The current design is:

```text
Browser route says where the user is
App.jsx turns that into shell + route-page requests
Worker returns intentional DTOs
React loads the matching panel code
Previous screen can stay visible while the next route hydrates
Boundaries are kept narrow by both docs and tests
```

That is the practical heart of the refactor.
