# Implementation Phases + Self-Prompts (Context-Free)

This file is a **context-free** set of implementation prompts you can paste into a new Codex/ChatGPT thread to kickstart work **without prior conversation context**.

Source of truth for scope/requirements: `Review.md`.

Constraints (must be repeated in every phase prompt)
- Deployment: **Vercel + Supabase only** (Supabase DB/RLS/RPC/Edge Functions allowed; no always-on server).
- Users: **one internal user type: technician**; shared workstation login is acceptable; capture typed technician name per action.
- Student portal: **no login**, shareable **5-character project code**, but **public reads must be project-code-scoped** (RPC/DTO), not table-wide.
- Materials: **primary + optional secondary only**; collapse PLA variants into one PLA bucket; ignore rare third material by policy.
- Priority: **simple integer**, lowest number handled first; can reset; not globally unique.
- Inventory: **out of scope**.
- Billing: **external university process**; app only tracks quote snapshots + paid/module-paid/override + receipt number.
- Suggestions: staff/lecturers/modules/materials/machines are **suggestion lists**; inputs remain **text-overridable**; deleting a suggestion must not erase historical text.

How to use
1. Start Phase 1. Paste the Phase prompt into a new thread.
2. After the agent finishes, perform the manual verification steps.
3. Update the Ã¢â‚¬Å“Running ToÃ¢â‚¬â€˜DoÃ¢â‚¬Â checklist in this file (commit it if you want the repo to track progress).
4. Proceed to the next phase.

---

## Running ToÃ¢â‚¬â€˜Do (edit as you go)

- [x] Phase 1 complete Ã¢â‚¬â€ Public tracking hardened (RLS + scoped RPC DTO)
- [x] Phase 2 complete Ã¢â‚¬â€ Deterministic workflow transitions (enums + transition RPC)
- [x] Phase 3 complete â€” Quote snapshots + payment state (simple, robust)
- [x] Phase 4 complete — Print runs + global queue (priority-only)
- [x] Phase 5 complete Ã¢â‚¬â€ UX refactor + reliability + tests

---

## Phase 1 Ã¢â‚¬â€ Public Tracking Hardening (RLS + Scoped RPC DTO)

### Copy/paste prompt (context-free)

You are a principal engineer working in a repo that contains `Review.md` (spec). Start by opening and reading `Review.md` to confirm scope.

Goal: Keep the current Ã¢â‚¬Å“parcel trackingÃ¢â‚¬Â UX (no login, shareable 5-character project code) while removing the major security/logical break: **anonymous table-wide reads**.

Constraints:
- Vercel + Supabase only; no always-on server.
- Public tracking must remain no-login and shareable.
- Keep 5-character project codes; do NOT introduce long tokens unless absolutely necessary.
- Public should only receive a **student-safe DTO** for a single project code (and optionally its group context if explicitly defined).
- Internals: one technician user type; shared login OK; capture typed technician name per action.

Tasks:
1. Locate current Supabase migrations/policies and identify any `anon` policies that allow selecting from `projects`, `parts`, or storage buckets broadly.
2. Implement RLS so that `anon` cannot directly read `projects`/`parts` table-wide.
3. Implement a Postgres `SECURITY DEFINER` RPC like `get_public_project_status(project_code text)` that:
   - Validates the code shape (5 chars, base36/uppercase policy as per codebase).
   - Returns only a student-safe DTO: project reference/code, lifecycle/status labels, part summaries, costs/quote snapshot, payment state label (receipt/module-paid/override), and collection code if applicable.
   - Returns thumbnail URLs only for parts in that project.
4. Update the public tracking frontend to call this RPC (no direct selects).
5. Add minimal rate-limit guidance (optional): if not implementing, document why; prefer Supabase Edge Function only if necessary.

Deliverables:
- Supabase migration(s) updating RLS policies and creating the RPC.
- Public app changes to use the RPC DTO.
- A short note in `Review.md` is NOT required; just implement faithfully.

Do not do:
- Do not add inventory.
- Do not add complex role matrices.
- Do not add student accounts.

Output a short summary of what you changed and where.

### Manual verification
- In Supabase SQL editor: verify `anon` cannot `select * from projects` or `parts` directly (should be denied).
- Verify `select * from get_public_project_status('ABCDE')` returns only one scoped payload (and fails cleanly for invalid codes).
- Run the public tracking page locally; confirm a valid project code loads and an invalid code shows a friendly not-found/error.
- Try to enumerate projects from the browser console with direct table reads; ensure it fails.

---

## Phase 2 Ã¢â‚¬â€ Deterministic Workflow Transitions (Enums + Transition RPC)

### What has been done (locked for Phase 2)

- Added deterministic workflow migration:
  - `supabase/migrations/20260601023000_phase2_deterministic_workflow.sql`
- Added Phase 2 quote-state correction patch:
  - `supabase/migrations/20260601103000_fix_issue_quote_state_progression.sql`
- Project state + part status are enum-backed and transition-guarded.
- Direct updates to `projects.state` and `parts.printStatus` are blocked unless done via transition RPCs.
- `transition_project_state` and `transition_part_status` are the enforced mutation path for high-risk workflow changes.
- `audit_events` is append-only and captures technician name, actor identity, reasons, and from/to transitions.
- `print_runs` table exists and is updated through `START_PRINT`, `FINISH_PRINT`, and `FAIL_PRINT`.
- Production labeling rules are finalized:
  - In production, part labels are normalized to `Queued`, `Printing`, `Printed`.
  - Failed prints return to queued semantics (`READY`), not `DRAFT`.
  - On `MOVE_TO_PRINTING`, `VERIFIED` parts are promoted to `READY`.
- Payment gate behavior is enforced in transitions:
  - Collection is blocked when payment is required and receipt is missing.
- Quote-state behavior is finalized and must not be overridden by later phases:
  - `ISSUE_QUOTE` does not move a project into production.
  - If payment is outstanding, state becomes `AWAITING_PAYMENT`.
  - If payment is not required/already handled, state remains in `QUOTE` until explicit `MOVE_TO_PRINTING`.
- Student/public view behavior finalized for Phase 2:
  - Part labels are phase-aware:
    - `INTAKE/REVIEW` -> `Reviewing`
    - `QUOTE/AWAITING_PAYMENT/READY_FOR_PRINTING` -> `Verified`
    - `IN_PRODUCTION+` -> `Queued/Printing/Printed`
  - Payment messaging is state-aware:
    - If payment is required and outstanding, show warning: `Please settle payment to be able to continue.`
    - If payment is not required, show neutral informational messaging.
  - Avoid confusing "ready" wording in student-facing project overview labels/messages.

### Copy/paste prompt (context-free)

Read `Review.md` first. Implement the deterministic workflow core as specified, scaled to the projectÃ¢â‚¬â„¢s simplified constraints:
- one technician role
- primary/secondary materials only
- simple priority integer
- no inventory
- payment is a simple gate (receipt/module-paid/override)

Goal: eliminate Ã¢â‚¬Å“UI-only state machineÃ¢â‚¬Â. All state changes must be server-enforced and auditable.

Tasks:
1. Define DB enums (or check constraints) for:
   - `project_state` (intake Ã¢â€ â€™ review Ã¢â€ â€™ quote Ã¢â€ â€™ awaiting payment/module confirmation Ã¢â€ â€™ ready for printing Ã¢â€ â€™ in production Ã¢â€ â€™ ready for collection Ã¢â€ â€™ partially collected Ã¢â€ â€™ closed/cancelled)
   - `part_status` (draft/verified/ready/printing/printed/failed/post-processing/collected as per `Review.md`)
2. Add transition RPC(s) that are the only allowed mutation path for:
   - project state transitions
   - part status transitions tied to print runs/collection
   Each RPC must validate preconditions and return a checklist-style error response.
3. Add an `audit_events` table (append-only) capturing:
   - workstation auth user id/email (where available)
   - typed technician name
   - action type, from/to state, reason/override note, and affected ids
4. Update the internal technician UI to call transition RPCs instead of generic updates where feasible (focus on the high-risk transitions first: complete review, issue quote, move to printing, start print, finish/fail print, collect).
5. Ensure backwards transitions do not delete history: supersede quote snapshots, preserve audit events, preserve print run facts.

Deliverables:
- Supabase migrations: enums/constraints, RPCs, audit_events table, minimal indexes.
- Internal UI wiring for the highest-risk transitions to use RPCs.

Do not do:
- No part version tables.
- No inventory.
- No per-user technician accounts required; typed technician name must still be captured.

### Manual verification
- Attempt illegal transitions (e.g., go to printing with an unverified part): RPC must reject with a clear reason.
- Confirm every successful transition writes an audit event.
- Open two browser tabs as technician; attempt conflicting edits; confirm at least Ã¢â‚¬Å“last write wins with audit visibilityÃ¢â‚¬Â or basic version checks if implemented.

---

## Phase 3 — Quote Snapshots + Payment Gate (Simple, Robust)

### What has been done (locked for Phase 3)
- Added Phase 3 migration:
  - `supabase/migrations/20260601121500_phase3_quote_snapshots_payment_gate.sql`
  - `supabase/migrations/20260601143000_phase3_fluid_workflow_overrides.sql`
- Added immutable quote snapshots:
  - `project_cost_snapshots` with versioning and `ISSUED/SUPERSEDED` lifecycle.
  - Snapshot line-summary JSON stores per-part material bucket, grams, and cost.
  - Old issued snapshots are superseded (never overwritten/deleted) when re-quoting or reopening review.
- Extended project payment fields:
  - `needsPayment`
  - `moduleOrLecturerPays`
  - `receiptNumber`
  - `paymentNote`
  - `paymentOverrideNote`
- Payment gate is server-enforced in transition RPCs:
  - Allowed when one condition is true:
    - `needsPayment=false`, or
    - `receiptNumber` exists, or
    - `moduleOrLecturerPays=true`, or
    - `paymentOverrideNote` exists.
  - Applied to both move-to-printing and collection.
- `ISSUE_QUOTE` behavior is locked:
  - Issuing quote creates a new snapshot and does not auto-start production.
  - State remains in quote/payment states until explicit production transition.
- Public tracking DTO (`get_public_project_status`) is snapshot-aware:
  - Uses issued snapshot totals/breakdown when available.
  - Exposes payment labels:
    - `PAYMENT_REQUIRED`
    - `RECEIPT_RECORDED`
    - `MODULE_OR_LECTURER_PAID`
    - `OVERRIDE_APPROVED`
    - `NOT_REQUIRED`
  - Internal payment notes are not exposed in public responses.
- Internal quote screen guardrails:
  - Shows issued snapshot version/date and snapshot-locked quote amounts when available.
  - Shows live working total separately, clarifying that a new quote must be issued to change quoted price.
- Additional flow hardening:
  - In Review screen, if project is already beyond review, `Move to Quote` prompts a reopen reason, reopens review, and then completes review in one guided flow.

### Phase 3 guard notes for future phases
- Direction decision override (intentional):
  - We are choosing a fluid, technician-driven workflow over strict stage lockouts.
  - Non-standard stage transitions are allowed with warnings and full audit capture.
  - This intentionally diverges from the stricter gating originally proposed in `Review.md`.
- Do not reintroduce live-only quote totals as the source of truth for issued quotes.
- Do not bypass transition RPCs for payment-gated production/collection transitions.
- Do not remove snapshot supersede history on reopen/re-quote flows.
- Do not expose internal `paymentNote`/`paymentOverrideNote` text in public DTOs.

### Copy/paste prompt (context-free)

Read `Review.md`. Implement quote/payment hardening while keeping billing simple and external.
Goal: quotes must not Ã¢â‚¬Å“change over timeÃ¢â‚¬Â when settings change; payment gate must be clear and enforceable.

Tasks:
1. Add `project_cost_snapshots` (or equivalent) to store:
   - snapshot number/version
   - computed totals and a compact line-summary JSON (by part/plate, material bucket, grams, cost)
   - generated_at, generated_by (workstation auth + typed tech name)
   - status: ISSUED / SUPERSEDED
2. Update Ã¢â‚¬Å“Issue QuoteÃ¢â‚¬Â action to generate and store a new snapshot.
3. Implement simple payment state fields on `projects`:
   - `needs_payment` boolean
   - `module_or_lecturer_pays` boolean (or enum payment_route)
   - `receipt_number` text (optional)
   - `payment_note` / `override_note` text (optional)
4. Enforce printing/collection gate rules in transition RPC:
   - allowed if `needs_payment=false` OR receipt_number exists OR module/lecturer-paid flag OR override note exists
5. Update public tracking DTO to show:
   - cost breakdown
   - Ã¢â‚¬Å“Payment requiredÃ¢â‚¬Â vs Ã¢â‚¬Å“Covered by module/lecturerÃ¢â‚¬Â vs Ã¢â‚¬Å“OverrideÃ¢â‚¬Â
   but never leak internal notes if you consider them non-student-safe.

Deliverables:
- Migrations + RPC updates + internal UI updates for quote issuing and payment recording.

### Manual verification
- Change material pricing after issuing a quote; confirm the issued snapshot displayed to student/tech does not change.
- Try to move to printing with `needs_payment=true` and no receipt/module-paid/override: must be blocked.
- Confirm student view shows cost breakdown even when module/lecturer pays.

---

## Phase 4 Ã¢â‚¬â€ Print Runs + Global Queue (Priority-Only)

### What has been done (locked for Phase 4)
- Added Phase 4 migration:
  - `supabase/migrations/20260601170000_phase4_global_queue_and_print_run_reads.sql`
- Migration is additive and self-healing:
  - Creates `print_runs` if missing on remote environments with migration drift.
  - Reapplies `print_runs` RLS policies safely (`DROP POLICY IF EXISTS` + recreate).
  - Adds optional `machine_id` to `print_runs` and supporting index.
- Added queue projection objects:
  - `global_queue_parts` view (server-side queue bucketing and sorting inputs).
  - `get_global_queue()` RPC (authenticated, server-sorted queue payload).
- Implemented internal Global Queue UI route:
  - New page: `src/pages copy/GlobalQueue.tsx`
  - Route: `/queue` in `src/App.tsx`
  - Sidebar entry: `Global Queue` in `src/components copy/Sidebar.tsx`
- Queue behavior is finalized:
  - Buckets shown: `PENDING_VERIFICATION`, `READY_TO_PRINT`, `ACTIVE_PRINTS`, `FAILED_OR_POST_PROCESSING`
  - Order is server-driven: `priority_number ASC`, then `project_created_at ASC`, then `part_number ASC`
  - Queue page now uses `supabase.rpc('get_global_queue')` as source of truth (not client-recomputed sorting).
- Print-run traceability remains immutable:
  - Start/fail/finish writes are still performed by transition RPCs from Phase 2/3.
  - UI now surfaces run-attempt history in printing cards so re-runs are visible to technicians.
- Machine selection behavior finalized:
  - Start-print modal uses suggestion list + free text entry (datalist-backed), preserving text-overridable policy.
  - Historical machine names on old runs remain intact even if suggestion lists change.

### Phase 4 guard notes for future phases
- Do not bypass `get_global_queue()` with client-side queue recomputation for the Global Queue page.
- Do not change queue ordering away from priority-first sorting unless requirements are explicitly updated.
- Do not delete or overwrite historical print runs to "clean up" data; history is required for auditability.
- Do not remove machine free-text entry from start-print flow; suggestions are intentionally non-blocking.
- Do not weaken the transition RPC path for `START_PRINT`, `FINISH_PRINT`, or `FAIL_PRINT`.

### Copy/paste prompt (context-free)

Read `Review.md`. Implement production tracking and global queue using the simplified rules:
- global queue ordering is priority number ascending, then created_at
- no deadlines, no material/inventory optimization

Goal: immutable print-run traceability and a single cross-project operations view.

Tasks:
1. Add `print_runs` table capturing:
   - part_id, machine_id/name, typed technician name, started_at, finished_at, failed_at, failure reason
   - do not overwrite start/finish facts; close runs with new rows/fields
2. Update transitions:
   - Ã¢â‚¬Å“Start printÃ¢â‚¬Â creates a print_run and moves part to PRINTING
   - Ã¢â‚¬Å“Finish printÃ¢â‚¬Â closes run and moves to PRINTED (or POST_PROCESSING if you use that)
   - Ã¢â‚¬Å“Fail printÃ¢â‚¬Â closes run and moves to FAILED / REWORK_REQUIRED
3. Implement global queue view that shows:
   - Pending verification
   - Ready to print
   - Active prints
   - Failed / re-run / post-processing
   Sorted primarily by priority number.
4. Ensure machine list is suggestion-backed but editable; no locations/supported material lists.

Deliverables:
- Migrations + internal UI global queue + print run controls.

### Manual verification
- Start a print, then fail it, then re-run: confirm all attempts are visible as separate run history.
- Confirm global queue ordering matches priority number only.
- Confirm machine selection works via suggestion list and keeps historical text on old runs even if a machine suggestion is deleted.

---

## Phase 5 Ã¢â‚¬â€ UX Refactor + Reliability + Tests (No New Scope)

### Copy/paste prompt (context-free)

Read `Review.md`. Refactor UX/layout without adding new domain scope.

Goal: a calm, professional operations workspace with strong scannability, progressive disclosure, and fewer accidental edits.

Tasks:
1. Restructure the internal technician UI into:
   - Operations Dashboard
   - Global Print Queue
   - Project Workspace (tabs: Overview, Parts & Verification, Quote & Payment, Production, Collection, Audit)
2. Add guardrail UX:
   - checklists before irreversible actions
   - confirmation dialogs for destructive edits
   - clear Ã¢â‚¬Å“blocked because Ã¢â‚¬Â¦Ã¢â‚¬Â messages from RPC checklists
3. Reliability pass:
   - await Supabase calls; show saving/saved/error states
   - on error, refetch/rollback UI state
4. Add minimal automated tests where feasible:
   - parser fixture tests (golden outputs)
   - workflow transition tests against RPC (or lightweight unit tests in TS if DB tests arenÃ¢â‚¬â„¢t practical)

Deliverables:
- UI refactor changes only (no scope creep).
- Test additions (only where practical).

### Manual verification
- New technician can complete intake Ã¢â€ â€™ verify parts Ã¢â€ â€™ issue quote Ã¢â€ â€™ record payment/module-paid Ã¢â€ â€™ start/finish print Ã¢â€ â€™ collect, without confusion.
- Try to do the Ã¢â‚¬Å“wrong thingÃ¢â‚¬Â on every screen; confirm UI clearly shows whatÃ¢â‚¬â„¢s missing.
- Confirm performance is acceptable for typical workloads (no table-wide pulls).




