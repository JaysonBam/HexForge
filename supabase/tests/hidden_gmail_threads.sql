-- Run after the hidden-thread migration. Every test record rolls back.
begin;
create temp table hidden_thread_test_marker (id integer);
create function pg_temp.assert_hidden_thread_test(passed boolean, message text)
returns void language plpgsql as $$
begin
  if passed is distinct from true then raise exception '%', message; end if;
end;
$$;

insert into public.projects (id, "studentName", "studentNumber", "createdAt", "gmailThreadId", "gmailAccountEmail")
values ('CODEX-HIDDEN-LINKED-TEST', 'Controlled test', '12345678', '2026-10-08T00:00:00Z',
  'linked-test-thread', 'Printing-Fixture@Example.invalid');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","email":"printing-fixture@example.invalid","role":"authenticated"}', true);
set local role authenticated;

-- The backend normalizes the mailbox and supplies the actor, ignoring spoofed input.
insert into public.gmail_hidden_threads (gmail_account_email, gmail_thread_id, hidden_by_email)
values (' Printing-Fixture@Example.invalid ', 'hidden-test-thread', 'spoofed@example.invalid');
select pg_temp.assert_hidden_thread_test(
  (select hidden_by_email = 'printing-fixture@example.invalid' and hidden_at is not null
    from public.gmail_hidden_threads where gmail_thread_id = 'hidden-test-thread'), 'Actor must come from authenticated JWT');
insert into public.gmail_hidden_threads (gmail_account_email, gmail_thread_id)
values ('printing-fixture@example.invalid', 'hidden-test-thread') on conflict do nothing;
select pg_temp.assert_hidden_thread_test(
  (select count(*) = 1 from public.gmail_hidden_threads where gmail_thread_id = 'hidden-test-thread'), 'Repeated hide must be idempotent');

-- Refreshing a previous-year hide cannot spoof the actor/time or move mailboxes.
reset role;
alter table public.gmail_hidden_threads disable trigger check_hidden_gmail_thread;
update public.gmail_hidden_threads set hidden_at = '2025-01-01T00:00:00Z' where gmail_thread_id = 'hidden-test-thread';
alter table public.gmail_hidden_threads enable trigger check_hidden_gmail_thread;
set local role authenticated;
insert into public.gmail_hidden_threads (gmail_account_email, gmail_thread_id)
values ('printing-fixture@example.invalid', 'hidden-test-thread')
on conflict (gmail_account_email, gmail_thread_id) do update set gmail_thread_id = excluded.gmail_thread_id;
update public.gmail_hidden_threads set hidden_by_email = 'spoofed@example.invalid', hidden_at = '2025-01-01T00:00:00Z'
where gmail_thread_id = 'hidden-test-thread';
select pg_temp.assert_hidden_thread_test(
  (select hidden_by_email = 'printing-fixture@example.invalid' and hidden_at = now()
   from public.gmail_hidden_threads where gmail_thread_id = 'hidden-test-thread'), 'Rehide must use server actor and current timestamp');
do $$
begin
  begin
    update public.gmail_hidden_threads set gmail_account_email = 'manager-fixture@example.invalid'
    where gmail_thread_id = 'hidden-test-thread';
    raise exception 'Hide entry was moved to another mailbox';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.gmail_hidden_threads set gmail_thread_id = 'linked-test-thread'
    where gmail_thread_id = 'hidden-test-thread';
    raise exception 'Linked email was hidden by update';
  exception when raise_exception then
    if sqlerrm <> 'Linked emails cannot be hidden.' then raise; end if;
  end;
end;
$$;

do $$
begin
  begin
    insert into public.gmail_hidden_threads (gmail_account_email, gmail_thread_id)
    values ('printing-fixture@example.invalid', 'linked-test-thread');
    raise exception 'Linked email was incorrectly hidden';
  exception when raise_exception then
    if sqlerrm <> 'Linked emails cannot be hidden.' then raise; end if;
  end;
  begin
    insert into public.gmail_hidden_threads (gmail_account_email, gmail_thread_id)
    values ('manager-fixture@example.invalid', 'other-account-thread');
    raise exception 'Other mailbox was incorrectly modified';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- Linking a previously hidden thread clears it, whether a project is created or updated.
insert into public.projects (id, "studentName", "studentNumber", "createdAt", "gmailThreadId", "gmailAccountEmail")
values ('CODEX-HIDDEN-INSERT-TEST', 'Controlled test', '12345678', '2026-10-08T00:00:00Z',
  'hidden-test-thread', 'PRINTING-FIXTURE@example.invalid');
select pg_temp.assert_hidden_thread_test(
  not exists (select 1 from public.gmail_hidden_threads where gmail_thread_id = 'hidden-test-thread'), 'Creating a linked project must unhide its email');

insert into public.gmail_hidden_threads (gmail_account_email, gmail_thread_id)
values ('printing-fixture@example.invalid', 'update-test-thread');
update public.projects set "gmailThreadId" = 'update-test-thread'
where id = 'CODEX-HIDDEN-INSERT-TEST';
select pg_temp.assert_hidden_thread_test(
  not exists (select 1 from public.gmail_hidden_threads where gmail_thread_id = 'update-test-thread'), 'Updating a project must remove its hidden email');
update public.projects set "gmailThreadId" = null where id = 'CODEX-HIDDEN-INSERT-TEST';
select pg_temp.assert_hidden_thread_test(
  not exists (select 1 from public.gmail_hidden_threads where gmail_thread_id = 'update-test-thread'), 'Unlinking must not restore an old hide entry');

insert into public.gmail_hidden_threads (gmail_account_email, gmail_thread_id)
values ('printing-fixture@example.invalid', 'restore-test-thread');
delete from public.gmail_hidden_threads where gmail_thread_id = 'restore-test-thread';
select pg_temp.assert_hidden_thread_test(
  not exists (select 1 from public.gmail_hidden_threads where gmail_thread_id = 'restore-test-thread'), 'Unhide must remove the entry');

-- The same Gmail thread ID in another account is independent; RLS keeps lists private.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","email":"manager-fixture@example.invalid","role":"authenticated"}', true);
insert into public.gmail_hidden_threads (gmail_account_email, gmail_thread_id)
values ('manager-fixture@example.invalid', 'linked-test-thread');
select pg_temp.assert_hidden_thread_test(
  (select count(*) = 1 from public.gmail_hidden_threads), 'Manager should see only their own hidden list');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","email":"printing-fixture@example.invalid","role":"authenticated"}', true);
select pg_temp.assert_hidden_thread_test(
  not exists (select 1 from public.gmail_hidden_threads where gmail_account_email = 'manager-fixture@example.invalid'), 'Another mailbox hide list must be private');
delete from public.gmail_hidden_threads where gmail_account_email = 'manager-fixture@example.invalid';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","email":"manager-fixture@example.invalid","role":"authenticated"}', true);
select pg_temp.assert_hidden_thread_test(
  (select count(*) = 1 from public.gmail_hidden_threads), 'Another user cannot unhide this mailbox');

set local role anon;
do $$
begin
  begin
    perform 1 from public.gmail_hidden_threads;
    raise exception 'Anonymous user read the hidden list';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
rollback;
