create type public.project_state as enum (
  'INTAKE',
  'REVIEW',
  'QUOTE',
  'AWAITING_PAYMENT',
  'READY_FOR_PRINTING',
  'IN_PRODUCTION',
  'READY_FOR_COLLECTION',
  'PARTIALLY_COLLECTED',
  'CLOSED',
  'CANCELLED'
);

create table public.projects (
  id text primary key,
  "priorityNumber" integer not null default 0,
  "studentName" text not null,
  "studentNumber" text not null,
  email text,
  course text,
  lecturer text,
  "needsPayment" boolean not null default true,
  "moduleOrLecturerPays" boolean not null default false,
  "paymentNote" text,
  "paymentOverrideNote" text,
  "defaultFilamentSource" text not null default 'misc' check ("defaultFilamentSource" in ('misc', 'student_provided', 'module_provided')),
  "receiptNumber" text,
  "printLabel" text,
  state public.project_state not null default 'INTAKE',
  archived boolean not null default false,
  "createdAt" text not null
);

alter table public.projects enable row level security;
CREATE POLICY allow_authenticated_full_access_projects
  ON public.projects
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
