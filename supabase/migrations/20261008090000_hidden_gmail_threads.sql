create table if not exists public.gmail_hidden_threads (
  gmail_account_email text not null,
  gmail_thread_id text not null check (length(btrim(gmail_thread_id)) > 0),
  hidden_by_email text not null,
  hidden_at timestamptz not null default now(),
  primary key (gmail_account_email, gmail_thread_id)
);

alter table public.gmail_hidden_threads enable row level security;
revoke all on public.gmail_hidden_threads from public, anon, authenticated;
grant select, insert, delete on public.gmail_hidden_threads to authenticated;
grant all on public.gmail_hidden_threads to service_role;

create policy read_own_hidden_gmail_threads on public.gmail_hidden_threads
  for select to authenticated
  using (gmail_account_email = lower(btrim((select auth.jwt()->>'email'))));
create policy hide_own_gmail_threads on public.gmail_hidden_threads
  for insert to authenticated
  with check (gmail_account_email = lower(btrim((select auth.jwt()->>'email')))
    and hidden_by_email = lower(btrim((select auth.jwt()->>'email'))));
create policy unhide_own_gmail_threads on public.gmail_hidden_threads
  for delete to authenticated
  using (gmail_account_email = lower(btrim((select auth.jwt()->>'email'))));

create schema if not exists private;
create or replace function private.check_hidden_gmail_thread()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.gmail_account_email := lower(btrim(new.gmail_account_email));
  new.gmail_thread_id := btrim(new.gmail_thread_id);
  new.hidden_by_email := lower(btrim(auth.jwt()->>'email'));
  new.hidden_at := now();
  if auth.uid() is null or coalesce(new.hidden_by_email, '') = ''
    or new.gmail_account_email is distinct from new.hidden_by_email then
    raise exception 'Only your own Gmail threads can be hidden.' using errcode = '42501';
  end if;
  -- Serialize hiding and linking the same mailbox/thread across workstations.
  perform pg_advisory_xact_lock(hashtextextended(new.gmail_account_email || ':' || new.gmail_thread_id, 0));
  if exists (select 1 from public.projects
    where "gmailThreadId" = new.gmail_thread_id
      and lower(btrim("gmailAccountEmail")) = new.gmail_account_email) then
    raise exception 'Linked emails cannot be hidden.';
  end if;
  return new;
end;
$$;
revoke all on function private.check_hidden_gmail_thread() from public;

create trigger check_hidden_gmail_thread
  before insert or update on public.gmail_hidden_threads
  for each row execute function private.check_hidden_gmail_thread();

create or replace function private.unhide_linked_gmail_thread()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  account_email text := lower(btrim(new."gmailAccountEmail"));
begin
  if tg_op = 'UPDATE' and new."gmailThreadId" is not distinct from old."gmailThreadId"
    and new."gmailAccountEmail" is not distinct from old."gmailAccountEmail" then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(account_email || ':' || new."gmailThreadId", 0));
  delete from public.gmail_hidden_threads
    where gmail_account_email = account_email and gmail_thread_id = new."gmailThreadId";
  return new;
end;
$$;
revoke all on function private.unhide_linked_gmail_thread() from public;

create trigger unhide_linked_gmail_thread
  after insert or update of "gmailThreadId", "gmailAccountEmail" on public.projects
  for each row when (new."gmailThreadId" is not null and new."gmailAccountEmail" is not null)
  execute function private.unhide_linked_gmail_thread();
