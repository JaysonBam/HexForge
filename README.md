# HexForge

React/Vite workstation app for managing MISC 3D printing intake, quote approval, production, collection, Gmail drafts, and Supabase-backed project data.

## Main Gmail Thread setup

HexForge can link one Main Gmail Thread to a project, cache its messages in Supabase, send replies through the existing Google OAuth connection, and pass downloaded STL/3MF attachment bytes to helper version 1.2.0. Gmail tokens stay in the browser and are never sent to the helper.

Apply the Gmail project migration before using the feature:

```powershell
supabase link --project-ref <PROJECT_REF>
supabase db push
```

The migration is `supabase/migrations/20260718120000_main_gmail_thread.sql`. Existing projects remain valid with no linked thread. Rebuild or repackage the helper so the workstation has the attachment-save endpoint:

```powershell
npm.cmd run build:helper
npm.cmd run package:helper
```

## Main Commands

```powershell
npm run dev
npm run lint
npm run build
npm.cmd test
```

## Local File Helper

The optional Windows helper connects the authenticated HexForge workspace to project files stored on the same workstation. HexForge remains fully functional when the helper is absent or stopped.

```powershell
npm run dev:helper
npm run build:helper
npm run package:helper
```

The portable production artifact is written to `release/HexForgeFileHelper.exe`. Copy that single executable to a workstation, run it, choose the four HexForge workflow folders, and add the exact deployed HexForge origin in its settings. The workstation does not need Node.js or development tools.

See `helper/README.md` for configuration, security, update, and smoke-test instructions.

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
