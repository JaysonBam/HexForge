# Project Memory Transfer

This file is a portable handoff for keeping the important working memory intact in the HexForge project.

## Project Identity

- Working name: `HexForge 3D Printing Manager`
- Current package name: `supabase-googleo`
- Main app: React 19 + TypeScript + Vite
- Backend/data/auth: Supabase
- Secondary app: `MISC-Printing-View` is a separate student-facing public status viewer
- Domain: MISC 3D printing intake, review, quoting, payment gating, production, collection, Gmail drafting, and reporting

## What The Main App Does

The staff workstation app manages 3D print jobs from intake through collection.

Core areas:

- Dashboard for active workflow lanes
- Project workspace with tabs for overview, parts/review, quote, production, and collection
- Part parsing/import for slicer files
- Quote generation and issued quote snapshot comparison
- Payment gating before production and stricter receipt gating before collection
- Print-run tracking and audit history
- Gmail draft creation for quote and collection emails
- Settings for staff, printers, modules, filament pricing, brands, and email templates

Main routes in the staff app:

- `/login`
- `/auth-callback`
- `/about`
- `/privacy`
- `/terms`
- `/`
- `/projects`
- `/project/:id`
- `/settings`

## Important Architecture

- `src/App.tsx` wires routes and wraps everything in `AppProviders`.
- `src/context/ProjectContext.tsx` is the main data/workflow hub.
- `src/context/SettingsContext.tsx` owns Supabase-backed config, filament pricing, modules, and email template settings.
- `src/domain/operations.ts` contains workflow UI logic such as blockers, lane assignment, payment labels, and next actions.
- `src/domain/quoteState.ts` contains quote snapshot comparison and live quote line summary generation.
- `src/types/index.ts` defines the core workflow enums and object shapes.
- `src/pages/ProjectTimeline.tsx` is the main project workspace and includes audit event viewing.

The app is fairly stateful on the frontend, but the important workflow rules are enforced in Supabase RPC/database logic, not just React.

## Critical Workflow Model

Project states:

- `INTAKE`
- `REVIEW`
- `QUOTE`
- `AWAITING_PAYMENT`
- `READY_FOR_PRINTING`
- `IN_PRODUCTION`
- `READY_FOR_COLLECTION`
- `PARTIALLY_COLLECTED`
- `CLOSED`
- `CANCELLED`

Part print statuses:

- `DRAFT`
- `VERIFIED`
- `READY`
- `PRINTING`
- `PRINTED`
- `FAILED`
- `POST_PROCESSING`
- `COLLECTED`

Filament sources:

- `misc`
- `student_provided`
- `module_provided`

## Rules You Should Preserve

These are the biggest "memory" items to carry forward:

1. Project state transitions must go through `transition_project_state`.
2. Part status transitions must go through `transition_part_status`.
3. The frontend intentionally blocks direct `project.state` and `part.printStatus` updates.
4. Quote history is versioned in `project_cost_snapshots`; the active issued quote matters.
5. Payment gating and collection gating are not the same rule.
6. Collection can still be blocked even if a payment override allowed production to start.
7. Print history is tracked in `print_runs`.
8. Audit history is tracked in append-only `audit_events`.
9. Public student status uses a dedicated RPC: `get_public_project_status`.

### Payment vs Collection Gate

This distinction matters a lot:

- `isPaymentBlocked(project)` is about whether printing may proceed.
- `isCollectionBlocked(project)` is stricter and requires a recorded receipt when payment is required.

Meaning:

- A payment override note can unblock production.
- That same override does not automatically unblock collection.
- Tests explicitly protect this behavior.

## Current Data/Storage Shape

Main tables and buckets referenced by the app:

- `projects`
- `parts`
- `project_cost_snapshots`
- `print_runs`
- `audit_events`
- `config`
- `profiles`
- Storage bucket `Thumbnails`
- Storage bucket `email-assets`

Frontend config keys stored in `config`:

- `settings_next_priority`
- `settings_staff`
- `settings_printers`
- `settings_brands`
- `settings_modules`
- `settings_filaments`
- `settings_email_templates`
- `settings_email_signature`

## Supabase / Auth Notes

- Staff app requires `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- Student/public links use `VITE_STUDENT_VIEW_URL` for email links.
- Google auth is handled through Supabase OAuth.
- Access control depends on the `profiles` table; login/callback flow checks for profile access.
- Gmail token refresh goes through the Supabase Edge Function `refresh-google-token`.

## Gmail / Email Memory

Email features are not just cosmetic:

- Email templates are editable and stored in `config`.
- Templates support token replacement for student name, project number, and project link.
- Quote emails may attach a generated quote PDF.
- Gmail drafts are created through the Gmail API, not sent directly by the app.
- OAuth scopes include compose and readonly so the app can also inspect unread print-related Gmail messages.
- Rich email editor uploads image assets to the `email-assets` bucket.

Default template keys:

- `quote_payment_required`
- `quote_no_payment_required`
- `collection_payment_reminder`
- `collection_ready`

## Public Status Viewer

`MISC-Printing-View` is a separate Vite app meant for student-facing project links.

Important points:

- It calls `get_public_project_status(project_code text)`.
- It is intended to be deployable separately from the staff workstation app.
- It shows project state, payment state, part list, part costs, and a barcode/collection code.
- It uses the same Supabase env vars as the main app.

When moving the project, do not forget this second app if student tracking links still matter.

## Reporting / Documents

Known generated outputs:

- Quote PDFs via `src/utils/quotePdfUtils.ts`
- Gmail quote attachments via `src/utils/projectQuoteAttachment.ts`
- Collection report XLSX via `src/utils/collectionReportXlsx.ts`

The collection report logic is tested and expects stable column order and formatting.

## Tests That Encode Business Rules

The test suite is small but important:

- `tests/operations.test.ts`
- `tests/emailTemplates.test.ts`
- `tests/collectionReportXlsx.test.ts`

What the tests protect:

- Payment and collection gate behavior
- Dashboard lane assignment
- Review blocking for unverified parts
- Quote snapshot freshness detection
- Filament source change detection in quote comparisons
- Safe email token rendering
- Project link rendering in emails
- XLSX export structure and formatting

If behavior changes, update tests deliberately rather than treating them as disposable.

## Slicer / Part Import Memory

There is existing slicer parsing logic under `src/lib/slicer-parsers/` including:

- `BambuParser.ts`
- `UltimakerParser.ts`

The review/import flow already expects parsed part metadata such as weights, materials, lengths, printing time, and thumbnails.

## UI Memory Worth Carrying

There is an existing memory note at `.agent-memory/ui-contrast-rules.md`.

Main UI guidance from that note:

- Prefer stronger borders and shadows over very soft gray separation.
- Avoid pale low-contrast form surfaces.
- Keep helper text readable on weak displays.
- Treat low-contrast OLED-only polish as a failure mode.

If the new repo has its own memory system, copy that note too.

## Operational Commands

Main app:

```powershell
npm run dev
npm run lint
npm run build
npm.cmd test
```

Public viewer app:

```powershell
cd MISC-Printing-View
npm run dev
npm run lint
npm run build
```

## Migration History Themes

The migration names show the recent development direction:

- Public tracking hardening
- Deterministic workflow enforcement
- Quote snapshots and payment gate enforcement
- Global queue and print-run reads
- Manual collection release handling
- Email assets bucket
- Filament source support

That means the workflow rules are relatively recent and intentional, not accidental leftovers.

## Recommended Carry-Over Checklist

- Move both apps, not just the staff app, if public links are still required.
- Keep Supabase migrations, functions, and schema snapshots together with the frontend.
- Preserve the RPC-driven transition model.
- Preserve `config` keys and email template storage shape.
- Preserve storage buckets and their policies: `Thumbnails` and `email-assets`.
- Preserve the test suite because it captures real workflow decisions.
- Preserve the UI contrast note from `.agent-memory/ui-contrast-rules.md`.

## Short Summary For A Fresh Agent

This is a Supabase-backed React/Vite 3D print workflow app with a separate student-facing public viewer. The most important memory is that workflow transitions are enforced through Supabase RPCs, quote snapshots are versioned, payment and collection are gated differently, Gmail draft creation is integrated through Google OAuth + a refresh edge function, and the small test suite encodes several non-obvious business rules that should not be casually broken.
