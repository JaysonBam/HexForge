create table public.vendors (
  vendor_id uuid primary key default gen_random_uuid(),
  filament_type text not null,
  vendor_name text not null,
  price numeric not null,
  price_per_gram numeric not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.vendors enable row level security;

-- Add appropriate RLS policies here
-- Allow any authenticated user full CRUD on vendors
CREATE POLICY allow_authenticated_full_access_vendors
  ON public.vendors
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
