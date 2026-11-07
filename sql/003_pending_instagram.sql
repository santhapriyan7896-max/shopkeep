-- When Meta connects Shopkeep but doesn't say which Instagram account was shared, the
-- connection is kept here (encrypted) until the shop enters its Instagram account ID.
alter table shops add column if not exists pending_ig_token_enc text;
alter table shops add column if not exists pending_ig_at timestamptz;
