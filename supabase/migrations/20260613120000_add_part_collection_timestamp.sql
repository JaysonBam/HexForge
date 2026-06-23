alter table public.parts
add column if not exists "collectedAt" timestamp with time zone;

update public.parts p
set "collectedAt" = coalesce(
  (
    select max(pr.finished_at)
    from public.print_runs pr
    where pr.part_id = p.id
      and pr.finished_at is not null
  ),
  timezone('utc'::text, now())
)
where p."printStatus" = 'COLLECTED'
  and p."collectedAt" is null;

create or replace function public.set_part_collected_at()
returns trigger
language plpgsql
as $$
begin
  if new."printStatus" = 'COLLECTED'
    and old."printStatus" is distinct from 'COLLECTED'
    and new."collectedAt" is null then
    new."collectedAt" := timezone('utc'::text, now());
  end if;

  if new."printStatus" <> 'COLLECTED' then
    new."collectedAt" := null;
  end if;

  return new;
end;
$$;

drop trigger if exists set_part_collected_at_before_update on public.parts;

create trigger set_part_collected_at_before_update
before update on public.parts
for each row
execute function public.set_part_collected_at();
