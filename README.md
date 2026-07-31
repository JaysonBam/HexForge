# HexForge

HexForge is a workspace for the MISC 3D-printing intake, quote, production, collection, Gmail, reporting, and optional local-file workflows.

```text
HexForge/
├─ web/             React/Vite application
├─ supabase/        Database configuration, migrations, schemas, and Edge Functions
└─ windows-helper/  Optional Electron Windows helper
```

The three domains are independently owned. The root package coordinates the two JavaScript workspaces; Supabase remains the backend source of truth.

## Prerequisites

- Node.js 22 or newer and npm
- Docker Desktop for local Supabase
- Supabase CLI access (provided by the root development dependency)
- Windows when building or smoke-testing the portable helper

Install all workspace dependencies from the repository root:

```powershell
npm install
```

The root `package-lock.json` is the workspace lockfile. The legacy `windows-helper/package-lock.json` is temporarily retained because a fresh Electron Builder packaging run could not complete in the restricted environment; remove it only after `npm run package:helper` succeeds from a clean workspace.

Frontend environment files belong in `web/`. Copy `web/.env.example` to `web/.env` for local development and keep secret-bearing environment files untracked.

## Workspace commands

```powershell
npm run dev:web
npm run build:web
npm run lint:web
npm run typecheck:web
npm run test:web

npm run dev:helper
npm run build:helper
npm run typecheck:helper
npm run test:helper
npm run package:helper
npm run smoke:helper

npm run lint
npm run typecheck
npm test
npm run build
```

The web production output is written to `web/dist/`. `npm run dev:web` starts the Vite development server.

## Windows Helper

The optional Windows Helper connects the authenticated web application to project files stored on the same workstation. HexForge continues to support authentication, project editing, uploads, quotations, production, collection, Gmail, and reporting when the helper is absent or stopped.

The portable artifact is written to:

```text
windows-helper/release/HexForgeFileHelper.exe
```

The helper owns the platform-neutral browser/helper contract at:

```text
windows-helper/src/contracts/localHelperProtocol.ts
```

The helper package exports it as `@hexforge/windows-helper/contracts`. The web application imports that public contract and never imports privileged Electron, filesystem, process-launching, or helper server implementation.

See `windows-helper/README.md` for workstation setup, security controls, packaging, and smoke-test details.

## Gmail and Google sign-in

HexForge sign-in requests only Google identity scopes. Gmail authorization is a separate, incremental OAuth flow. Google refresh and access tokens are encrypted by Edge Functions, stored in service-role-only tables, and never returned to browser JavaScript. Gmail API traffic passes through an authenticated, rate-limited route allowlist.

The related migrations are:

```text
supabase/migrations/20260718120000_main_gmail_thread.sql
supabase/migrations/20260731120000_server_owned_gmail_credentials.sql
```

The server-owned Gmail boundary requires these Edge Function secrets:

```text
GOOGLE_OAUTH_CLIENT_ID
GOOGLE_OAUTH_CLIENT_SECRET
GMAIL_OAUTH_REDIRECT_URI
GMAIL_TOKEN_ENCRYPTION_KEY
GMAIL_TOKEN_ENCRYPTION_KEY_VERSION
HEXFORGE_WEB_ORIGINS
```

`GMAIL_TOKEN_ENCRYPTION_KEY` must be a base64-encoded 32-byte random key. Keep old keys as `GMAIL_TOKEN_ENCRYPTION_KEY_V<version>` during key rotation until every credential has been re-encrypted. `HEXFORGE_WEB_ORIGINS` is a comma-separated exact-origin allowlist.

Configure the Google OAuth client with this authorized redirect URI:

```text
https://<project-ref>.supabase.co/functions/v1/gmail-oauth-callback
```

For local development, copy `supabase/.env.example` to `supabase/.env`, provide a unique development encryption key, and use the local callback URI already shown in the example.

Deploy the migration and the three functions together:

```powershell
npx supabase db push
npx supabase functions deploy gmail-connection
npx supabase functions deploy gmail-oauth-callback
npx supabase functions deploy gmail-proxy
```

After the new web build is live, remove the retired `refresh-google-token` function from the remote project. Existing staff must reconnect Gmail once; the web client deletes the legacy browser token keys on startup, sign-in, and callback.

## Supabase local development

Supabase commands run from the repository root so the CLI discovers `supabase/config.toml`:

```powershell
npx supabase login
npx supabase start
npx supabase status
npx supabase stop
```

For an explicitly linked remote project:

```powershell
npx supabase link --project-ref <PROJECT_REF>
npx supabase db diff
npx supabase db push
```

Schema snapshots are under `supabase/schemas/`, migrations are under `supabase/migrations/`, and Edge Functions are under `supabase/functions/`.

## Deployment

The repository contains local Vite, Vercel, Electron Builder, and Supabase configuration, but no command above deploys the web application, database, migrations, or Edge Functions automatically. Deployment remains an explicit separate operation.
