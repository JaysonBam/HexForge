# HexForge 3D Printing Manager

React/Vite workstation app for managing MISC 3D printing intake, quote approval, production, collection, Gmail drafts, and Supabase-backed project data.

## Main Commands

```powershell
npm run dev
npm run lint
npm run build
npm.cmd test
```

Use `npm.cmd test` on Windows if PowerShell blocks `npm.ps1`.

## Supabase Local Setup

Prerequisites:

- Docker Desktop running
- Supabase CLI installed and logged in

```powershell
supabase login
supabase start
supabase status
supabase stop
```

When linked to a remote project:

```powershell
supabase link --project-ref <PROJECT_REF>
supabase db diff
supabase db push
```

The main Supabase assets live under `supabase/`; schema snapshots are in `supabase/schemas/` and migrations are in `supabase/migrations/`.
