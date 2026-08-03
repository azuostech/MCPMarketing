create extension if not exists pgcrypto;

create table if not exists public.marketing_users (
  id uuid primary key default gen_random_uuid(),
  google_subject text not null unique,
  email text not null,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.google_ads_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.marketing_users(id) on delete cascade,
  encrypted_refresh_token text not null,
  scopes text[] not null default '{}',
  status text not null default 'active' check (status in ('active', 'revoked', 'error')),
  selected_customer_id text,
  login_customer_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.google_ads_accounts (
  connection_id uuid not null references public.google_ads_connections(id) on delete cascade,
  customer_id text not null,
  descriptive_name text,
  status text,
  manager boolean,
  level integer,
  updated_at timestamptz not null default now(),
  primary key (connection_id, customer_id)
);

create table if not exists public.mcp_oauth_clients (
  client_id text primary key,
  encrypted_client_data text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.mcp_oauth_pending (
  state_hash text primary key,
  client_id text not null references public.mcp_oauth_clients(client_id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,
  mcp_state text,
  scopes text[] not null default '{}',
  resource text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.mcp_oauth_codes (
  code_hash text primary key,
  client_id text not null references public.mcp_oauth_clients(client_id) on delete cascade,
  user_id uuid not null references public.marketing_users(id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,
  scopes text[] not null default '{}',
  resource text,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.mcp_oauth_tokens (
  token_hash text primary key,
  token_type text not null check (token_type in ('access', 'refresh')),
  client_id text not null references public.mcp_oauth_clients(client_id) on delete cascade,
  user_id uuid not null references public.marketing_users(id) on delete cascade,
  scopes text[] not null default '{}',
  resource text,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists mcp_oauth_tokens_user_id_idx on public.mcp_oauth_tokens(user_id);
create index if not exists mcp_oauth_tokens_client_id_idx on public.mcp_oauth_tokens(client_id);
create index if not exists mcp_oauth_pending_expires_at_idx on public.mcp_oauth_pending(expires_at);
create index if not exists mcp_oauth_codes_expires_at_idx on public.mcp_oauth_codes(expires_at);

alter table public.marketing_users enable row level security;
alter table public.google_ads_connections enable row level security;
alter table public.google_ads_accounts enable row level security;
alter table public.mcp_oauth_clients enable row level security;
alter table public.mcp_oauth_pending enable row level security;
alter table public.mcp_oauth_codes enable row level security;
alter table public.mcp_oauth_tokens enable row level security;

comment on table public.google_ads_connections is
  'Server-only Google Ads OAuth connections. Refresh tokens are encrypted before storage.';
comment on table public.mcp_oauth_tokens is
  'Server-only MCP OAuth tokens. Only SHA-256 token hashes are stored.';
