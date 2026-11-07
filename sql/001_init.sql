-- Shopkeep schema. Runs automatically on server start (see src/db.mjs).
-- Row level security is switched on for every table with no policies, so Supabase's
-- public REST API (anon / authenticated keys) can read nothing. Only the server,
-- connecting with the database password, can.

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  name text not null default '',
  created_at timestamptz not null default now()
);

create table shops (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  order_prefix text not null default 'SK',
  order_seq int not null default 1000,
  bot_enabled boolean not null default false,
  settings jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table shop_members (
  shop_id uuid not null references shops(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'staff')),
  primary key (shop_id, user_id)
);

-- One connected Instagram professional account per shop.
create table instagram_accounts (
  shop_id uuid primary key references shops(id) on delete cascade,
  ig_user_id text not null unique,       -- the id Instagram puts in webhooks (entry.id)
  username text not null default '',
  access_token_enc text not null,        -- encrypted with APP_SECRET
  token_expires_at timestamptz,
  connected_at timestamptz not null default now()
);

-- Payment gateway keys per shop (secrets encrypted with APP_SECRET).
create table payment_accounts (
  shop_id uuid primary key references shops(id) on delete cascade,
  provider text not null default 'razorpay',
  key_id text not null,
  key_secret_enc text not null,
  webhook_secret_enc text not null,
  updated_at timestamptz not null default now()
);

create table products (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  name text not null,
  category text not null default '',
  description text not null default '',
  prices jsonb not null default '{"standard": 0}',   -- {"standard": 599} or {"fan": 599, "player": 899}
  sizes jsonb not null default '{}',                 -- {"M": 5, "L": 0}; empty = no sizes
  keywords jsonb not null default '[]',              -- extra words customers use for it
  post_urls jsonb not null default '[]',             -- its Instagram posts, to recognise shared posts
  personalization_price int,                         -- e.g. name & number printing; null = not offered
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index products_shop on products (shop_id, sort);

create table conversations (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  channel text not null check (channel in ('instagram', 'test')),
  external_id text not null,             -- Instagram-scoped user id of the customer
  customer_name text not null default '',
  username text not null default '',
  bot_paused_until timestamptz,          -- set when a person from the shop replies
  needs_human boolean not null default false,
  unread int not null default 0,
  last_message_at timestamptz not null default now(),
  last_customer_message_at timestamptz,
  holding_reply_at timestamptz,          -- last "team will reply" fallback, to avoid repeats
  created_at timestamptz not null default now(),
  unique (shop_id, channel, external_id)
);
create index conversations_recent on conversations (shop_id, last_message_at desc);

create table messages (
  id bigserial primary key,
  shop_id uuid not null references shops(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  direction text not null check (direction in ('in', 'out')),
  sender text not null check (sender in ('customer', 'bot', 'staff')),
  text text not null default '',
  attachments jsonb not null default '[]',
  external_id text unique,               -- Instagram message id (mid)
  created_at timestamptz not null default now()
);
create index messages_conv on messages (conversation_id, id);

create table orders (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  number text not null,
  conversation_id uuid references conversations(id) on delete set null,
  product_id uuid references products(id) on delete set null,
  product_name text not null,
  version text,
  size text,
  quantity int not null default 1,
  personalization text,
  item_total int not null,
  delivery_fee int not null default 0,
  cod_fee int not null default 0,
  total int not null,
  payment text not null check (payment in ('UPI', 'COD')),
  status text not null check (status in ('awaiting_payment', 'paid', 'review', 'confirmed', 'shipped', 'delivered', 'cancelled')),
  customer_name text not null,
  phone text not null,
  address text not null,
  pincode text not null,
  checks jsonb not null default '{}',
  payment_link_id text,
  payment_link_url text,
  payment_id text,
  paid_at timestamptz,
  reminded_at timestamptz,
  tracking text,
  history jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, number)
);
create index orders_shop on orders (shop_id, created_at desc);
create index orders_link on orders (payment_link_id);

create table leads (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete set null,
  data jsonb not null,
  status text not null default 'new' check (status in ('new', 'contacted', 'won', 'lost')),
  created_at timestamptz not null default now()
);
create index leads_shop on leads (shop_id, created_at desc);

create table alerts (
  id bigserial primary key,
  shop_id uuid not null references shops(id) on delete cascade,
  kind text not null,                    -- order | paid | cod_review | lead | handoff | system
  title text not null,
  body text not null default '',
  conversation_id uuid references conversations(id) on delete set null,
  order_id uuid references orders(id) on delete set null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index alerts_shop on alerts (shop_id, id desc);

alter table users enable row level security;
alter table shops enable row level security;
alter table shop_members enable row level security;
alter table instagram_accounts enable row level security;
alter table payment_accounts enable row level security;
alter table products enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;
alter table orders enable row level security;
alter table leads enable row level security;
alter table alerts enable row level security;
