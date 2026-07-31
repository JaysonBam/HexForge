create table if not exists public.gmail_oauth_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  account_email text not null,
  refresh_token_ciphertext text not null,
  refresh_token_iv text not null,
  refresh_token_key_version integer not null default 1 check (refresh_token_key_version > 0),
  access_token_ciphertext text,
  access_token_iv text,
  access_token_key_version integer check (access_token_key_version > 0),
  access_token_expires_at timestamptz,
  granted_scopes text[] not null default '{}',
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (access_token_ciphertext is null)
    = (access_token_iv is null)
    and (access_token_ciphertext is null) = (access_token_key_version is null)
  )
);

create table if not exists public.gmail_oauth_states (
  state_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  user_email text not null,
  verifier_ciphertext text not null,
  verifier_iv text not null,
  verifier_key_version integer not null default 1 check (verifier_key_version > 0),
  return_path text not null default '/',
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (return_path = '/' or return_path ~ '^/[^/]')
);

create index if not exists gmail_oauth_states_expiry_idx
  on public.gmail_oauth_states (expires_at);

create table if not exists public.gmail_security_events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists gmail_security_events_user_created_idx
  on public.gmail_security_events (user_id, created_at desc);

alter table public.gmail_oauth_credentials enable row level security;
alter table public.gmail_oauth_states enable row level security;
alter table public.gmail_security_events enable row level security;

revoke all on table public.gmail_oauth_credentials from anon, authenticated;
revoke all on table public.gmail_oauth_states from anon, authenticated;
revoke all on table public.gmail_security_events from anon, authenticated;
grant all on table public.gmail_oauth_credentials to service_role;
grant all on table public.gmail_oauth_states to service_role;
grant select, insert on table public.gmail_security_events to service_role;
grant usage, select on sequence public.gmail_security_events_id_seq to service_role;

create or replace function public.consume_gmail_operation(
  p_user_id uuid,
  p_operation text,
  p_limit integer
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  recent_count integer;
  effective_limit integer := greatest(1, least(coalesce(p_limit, 1), 500));
begin
  if p_user_id is null or p_operation not in ('gmail_read', 'gmail_write', 'gmail_attachment') then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_operation, 0));

  select count(*)
    into recent_count
    from public.gmail_security_events
   where user_id = p_user_id
     and event_type = 'gmail_operation'
     and details ->> 'operation' = p_operation
     and created_at >= now() - interval '1 minute';

  if recent_count >= effective_limit then
    insert into public.gmail_security_events (user_id, event_type, details)
    values (p_user_id, 'gmail_rate_limited', jsonb_build_object('operation', p_operation));
    return false;
  end if;

  insert into public.gmail_security_events (user_id, event_type, details)
  values (p_user_id, 'gmail_operation', jsonb_build_object('operation', p_operation));
  return true;
end;
$$;

revoke all on function public.consume_gmail_operation(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.consume_gmail_operation(uuid, text, integer) to service_role;

create or replace function public.remove_gmail_credential_when_access_ends()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    if old.id is not null then
      delete from public.gmail_oauth_credentials where user_id = old.id;
      delete from public.gmail_oauth_states where user_id = old.id;
    end if;
    return old;
  end if;

  if old.id is not null and new.status <> 'active' then
    delete from public.gmail_oauth_credentials where user_id = old.id;
    delete from public.gmail_oauth_states where user_id = old.id;
  end if;
  return new;
end;
$$;

revoke all on function public.remove_gmail_credential_when_access_ends() from public, anon, authenticated;

create trigger trg_remove_gmail_credential_when_access_ends
after delete or update of status on public.profiles
for each row execute function public.remove_gmail_credential_when_access_ends();

comment on table public.gmail_oauth_credentials is
  'Server-owned, application-encrypted Google OAuth credentials. Never expose through authenticated or anon APIs.';
comment on table public.gmail_oauth_states is
  'Short-lived, one-time OAuth state and encrypted PKCE verifier records.';
