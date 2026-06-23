create type public.profile_status as enum (
  'pending',
  'active'
);

create table public.profiles (
  id uuid null references auth.users(id) on delete cascade,

  email text not null,
  full_name text,
  profile_url text,

  status public.profile_status not null default 'pending',

  primary key (email)
);

alter table public.profiles enable row level security;

-- Allow authenticated users to read their profile when their JWT email matches the profile.email
-- This enables the client-only flow to lookup a profile by email before the profile.id
-- is populated. It only permits access for the authenticated user whose JWT contains
-- the matching email claim.
CREATE POLICY select_profile_by_email_authenticated
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (email = (auth.jwt() ->> 'email'));

-- Allow authenticated users to update their profile row (set `id` and `status`) when
-- the JWT email matches. `WITH CHECK` ensures updates don't change the email to a different value.
CREATE POLICY update_profile_by_email_authenticated
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (email = (auth.jwt() ->> 'email'))
  WITH CHECK (email = (auth.jwt() ->> 'email'));
