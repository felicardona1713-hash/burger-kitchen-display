-- Ensure extension for UUID generation
create extension if not exists "pgcrypto";

-- Add missing columns expected by the app and edge function
alter table public.orders
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists total numeric,
  add column if not exists status text default 'pending',
  add column if not exists fecha timestamptz default now(),
  add column if not exists created_at timestamptz default now();

-- Backfill existing rows to satisfy NOT NULL/PK constraints
update public.orders set id = gen_random_uuid() where id is null;
update public.orders set created_at = now() where created_at is null;
update public.orders set fecha = now() where fecha is null;
update public.orders set status = 'pending' where status is null;

-- Enforce constraints
alter table public.orders
  alter column id set not null,
  alter column created_at set not null,
  alter column status set not null,
  alter column fecha set not null;

-- Add primary key on id (table previously had none)
alter table public.orders add constraint orders_pkey primary key (id);

-- Helpful indexes
create index if not exists idx_orders_status on public.orders (status);
create index if not exists idx_orders_created_at on public.orders (created_at desc);
