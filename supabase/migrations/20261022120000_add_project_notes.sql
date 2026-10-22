-- One shared plain-text scratchpad per project. Existing projects start empty.
alter table public.projects add column notes text not null default '';
