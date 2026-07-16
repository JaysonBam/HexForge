alter table public.parts
add column if not exists "sourceFilePath" text;

comment on column public.parts."sourceFilePath" is
  'Path of the imported local file, relative to the matched project folder.';
