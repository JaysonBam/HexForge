-- Re-hiding a previous-year thread is one atomic upsert. The existing guard
-- still supplies the actor/time and rejects threads already linked to projects.
grant update on public.gmail_hidden_threads to authenticated;
create policy rehide_own_gmail_threads on public.gmail_hidden_threads
  for update to authenticated
  using (gmail_account_email = lower(btrim((select auth.jwt()->>'email'))))
  with check (gmail_account_email = lower(btrim((select auth.jwt()->>'email')))
    and hidden_by_email = lower(btrim((select auth.jwt()->>'email'))));
