# Deferred Refactor Work

These items were intentionally excluded from the repository restructure so this pass could preserve existing behaviour and backend/authentication contracts.

## Security

### Map user-visible provider errors and sanitise diagnostics

- **Current behaviour:** Some Supabase, Google, and helper failures expose raw provider messages or detailed diagnostics to staff.
- **Why improve it:** Stable user-facing messages and sanitised logs would be clearer and reduce accidental disclosure of provider detail.
- **Why deferred:** Error-policy changes affect many workflows and need a dedicated compatibility and support review.
- **Future domains:** Primarily `web`, with possible `supabase` and `windows-helper` logging changes.
- **Compatibility risk:** Medium. Over-sanitising errors could remove information currently needed for support.

## Frontend architecture candidates

### Evaluate TanStack Query for server state

- **Current behaviour:** Existing React contexts coordinate server reads, optimistic state, debounced writes, and mutations.
- **Why improve it:** A server-state library could standardise caching, invalidation, retries, and mutation status.
- **Why deferred:** Replacing the state architecture was outside this controlled structural refactor.
- **Future domains:** `web`.
- **Compatibility risk:** High. Workflow timing and optimistic behaviour could change.

### Evaluate React Hook Form and Zod for larger forms

- **Current behaviour:** Forms use local React state and existing domain validators.
- **Why improve it:** Shared form-state and schema validation could reduce repetitive validation code in larger screens.
- **Why deferred:** Introducing a new form/validation architecture was prohibited in this pass.
- **Future domains:** `web`.
- **Compatibility risk:** Medium. Validation timing, defaults, and submission behaviour must remain compatible.

### Revisit oversized workflow decomposition

- **Current behaviour:** Checkpoint and project context files remain substantial but now have clear feature and API boundaries.
- **Why improve it:** Some cohesive UI sections or stateful workflows may become safe extraction candidates after the new structure settles.
- **Why deferred:** Splitting further now would increase diff size and regression risk without improving the primary package/API boundaries.
- **Future domains:** `web`.
- **Compatibility risk:** Medium, especially around queued saves and workflow transitions.

### Tighten OAuth callback typing

- **Current behaviour:** The callback retains broad compatibility handling and `any` escape hatches for multiple Supabase auth-client methods and response shapes.
- **Why improve it:** Dedicated types would make supported callback paths explicit and easier to test.
- **Why deferred:** The OAuth flow and fallback behaviour were intentionally preserved exactly.
- **Future domains:** `web`, with validation against the installed Supabase client.
- **Compatibility risk:** High. Removing a fallback prematurely could strand existing login flows.

## Styling and dependencies

### Review Tailwind usage

- **Current behaviour:** Tailwind is materially used throughout the application alongside existing semantic CSS variables and focused CSS.
- **Why improve it:** A later review could confirm the long-term boundary between utilities and component-level CSS.
- **Why deferred:** Tailwind is actively used, so removal or broad conversion would be a separate styling project.
- **Future domains:** `web`.
- **Compatibility risk:** Medium due to responsive and print styles.

### Review stale or extraneous dependency artifacts

- **Current behaviour:** Package ownership is split between workspaces and MUI/Emotion are removed. The July 2026 dependency audit upgraded Electron to 43.2.0, pinned React Router DOM to 7.18.1, and applied all compatible transitive security updates.
- **Why improve it:** A focused audit may identify transitive assumptions, version drift, or unused packages.
- **Why deferred:** `electron-builder` 26.15.3 still transitively installs deprecated `inflight`, `glob` 7, `rimraf` 2, and `boolean`; replacing those below the owning package would create an unsupported dependency tree. npm also reports the React Router RSC-mode CSRF advisory against 7.18.1, but HexForge is a client-only Vite SPA and does not use RSC mode, server actions, SSR, hydration, loaders, or React Router server APIs. Downgrading to npm's suggested 7.11.0 reintroduces multiple older XSS, redirect, deserialisation, and denial-of-service advisories.
- **Future domains:** Root workspace, `web`, and `windows-helper`.
- **Compatibility risk:** Medium. Recheck both upstream dependency trees on each release and remove this exception when React Router publishes a patched client-compatible release and electron-builder modernises its transitive packages.

### Review native prompts and alerts

- **Current behaviour:** Focused local feedback components coexist with a small number of native browser prompts/alerts.
- **Why improve it:** Consistent application feedback could improve accessibility and presentation.
- **Why deferred:** Replacing every prompt or alert would be an unrelated UI cleanup.
- **Future domains:** `web`.
- **Compatibility risk:** Low to medium depending on synchronous workflow assumptions.

## Backend and API opportunities

### Review repeated project-loading requests

- **Current behaviour:** Project loading preserves separate project, part, quote-snapshot, and print-run reads and maps them in the web Supabase API layer.
- **Why improve it:** A future view or RPC might reduce round trips and centralise row-to-domain composition.
- **Why deferred:** It would change the backend contract, which was prohibited in this pass.
- **Future domains:** `supabase` and `web`.
- **Compatibility risk:** High because ordering, optional data, and RLS behaviour must remain unchanged.

### Review Gmail cache contract and provider error handling

- **Current behaviour:** Gmail message and attachment cache rows follow the existing schema and provider failures retain current handling.
- **Why improve it:** A dedicated backend boundary could validate payloads, combine writes, and map provider errors more consistently.
- **Why deferred:** Schema, RPC, Edge Function, and token-operation changes were outside scope.
- **Future domains:** `supabase` and `web`.
- **Compatibility risk:** High for linked threads, cached correspondence, replies, and attachment status.

### Review backend validation opportunities

- **Current behaviour:** Existing database constraints, policies, functions, RPCs, and frontend validation remain unchanged.
- **Why improve it:** Some awkward frontend/backend contracts may benefit from stronger server-side validation.
- **Why deferred:** No Supabase implementation changes were permitted.
- **Future domains:** `supabase`, followed by compatible `web` changes.
- **Compatibility risk:** High because stricter validation may reject previously accepted records.
