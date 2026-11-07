-- Repairs JSON that an earlier version saved as a quoted string on real Postgres
-- (the driver turned it into text a second time). Turns '"{\"fan\":599}"' back into
-- {"fan":599}. Only touches values whose top level is a string, so correct rows are left alone.

update shops set settings = (settings #>> '{}')::jsonb where jsonb_typeof(settings) = 'string';

update products set prices = (prices #>> '{}')::jsonb where jsonb_typeof(prices) = 'string';
update products set sizes = (sizes #>> '{}')::jsonb where jsonb_typeof(sizes) = 'string';
update products set keywords = (keywords #>> '{}')::jsonb where jsonb_typeof(keywords) = 'string';
update products set post_urls = (post_urls #>> '{}')::jsonb where jsonb_typeof(post_urls) = 'string';

update messages set attachments = (attachments #>> '{}')::jsonb where jsonb_typeof(attachments) = 'string';
update leads set data = (data #>> '{}')::jsonb where jsonb_typeof(data) = 'string';
update orders set checks = (checks #>> '{}')::jsonb where jsonb_typeof(checks) = 'string';

-- Order history: a string at the top, or a string as the first item of the array
-- (status changes appended entries after it).
update orders set history = (history #>> '{}')::jsonb where jsonb_typeof(history) = 'string';
update orders set history = ((history ->> 0)::jsonb) || (history - 0)
  where jsonb_typeof(history) = 'array' and jsonb_typeof(history -> 0) = 'string' and (history ->> 0) like '[%';
