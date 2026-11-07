// All reads and writes, as plain SQL. Every function takes `db` (or a transaction `t`)
// first, and every query is scoped by shop_id so one shop can never see another's data.

const J = (v) => JSON.stringify(v ?? null);

// ── users & shops ─────────────────────────────────────────────
export const findUserByEmail = (db, email) => db.one("select * from users where email = $1", [String(email).trim().toLowerCase()]);
export const getUser = (db, id) => db.one("select id, email, name, created_at from users where id = $1", [id]);

export async function createAccount(db, { email, passwordHash, name, shopName }) {
  return db.tx(async (t) => {
    const user = await t.one("insert into users (email, password_hash, name) values ($1, $2, $3) returning id, email, name", [String(email).trim().toLowerCase(), passwordHash, name || ""]);
    const prefix = (shopName.replace(/[^a-z0-9]/gi, "").slice(0, 4) || "SK").toUpperCase();
    const shop = await t.one("insert into shops (name, order_prefix, settings) values ($1, $2, $3::text::jsonb) returning *", [shopName, prefix, J(defaultSettings())]);
    await t.query("insert into shop_members (shop_id, user_id, role) values ($1, $2, 'owner')", [shop.id, user.id]);
    return { user, shop };
  });
}

export function defaultSettings() {
  return {
    handle: "",
    about: "",
    location: "",
    address: "",
    phone: "",
    staff_hours: "9 AM – 9 PM",
    delivery_fee: 0,
    free_delivery_above: 0,
    cod_fee: 0,
    delivery_time: "3–6 days across India",
    payments: { upi: true, cod: true },
    returns_policy: "",
    offers: "",
    faq: "",
    bulk_orders: "",
    upi_id: "",
    human_pause_hours: 12,
    debounce_seconds: 4,
  };
}

export const shopForUser = (db, userId) =>
  db.one("select s.*, m.role from shops s join shop_members m on m.shop_id = s.id where m.user_id = $1 order by s.created_at limit 1", [userId]);
export const getShop = (db, id) => db.one("select * from shops where id = $1", [id]);

export async function updateShop(db, id, { name, settings, botEnabled, orderPrefix }) {
  return db.one(
    `update shops set name = coalesce($2, name), settings = coalesce($3::text::jsonb, settings),
       bot_enabled = coalesce($4, bot_enabled), order_prefix = coalesce($5, order_prefix)
     where id = $1 returning *`,
    [id, name ?? null, settings ? J(settings) : null, botEnabled ?? null, orderPrefix ?? null],
  );
}

// ── connected accounts ────────────────────────────────────────
export const getInstagram = (db, shopId) => db.one("select * from instagram_accounts where shop_id = $1", [shopId]);
export const getInstagramByAccount = (db, igUserId) => db.one("select * from instagram_accounts where ig_user_id = $1", [igUserId]);
export async function saveInstagram(db, shopId, { igUserId, username, tokenEnc, expiresAt }) {
  return db.tx(async (t) => {
    // An Instagram account can belong to one shop only; reconnecting moves it.
    await t.query("delete from instagram_accounts where ig_user_id = $1 and shop_id <> $2", [igUserId, shopId]);
    return t.one(
      `insert into instagram_accounts (shop_id, ig_user_id, username, access_token_enc, token_expires_at) values ($1, $2, $3, $4, $5)
       on conflict (shop_id) do update set ig_user_id = excluded.ig_user_id, username = excluded.username,
         access_token_enc = excluded.access_token_enc, token_expires_at = excluded.token_expires_at, connected_at = now()
       returning *`,
      [shopId, igUserId, username, tokenEnc, expiresAt],
    );
  });
}
export const updateInstagramToken = (db, shopId, tokenEnc, expiresAt) =>
  db.query("update instagram_accounts set access_token_enc = $2, token_expires_at = $3 where shop_id = $1", [shopId, tokenEnc, expiresAt]);
export const deleteInstagram = (db, shopId) => db.query("delete from instagram_accounts where shop_id = $1", [shopId]);
export const setPendingInstagram = (db, shopId, tokenEnc) =>
  db.query("update shops set pending_ig_token_enc = $2, pending_ig_at = case when $2::text is null then null else now() end where id = $1", [shopId, tokenEnc]);
export const instagramDueForRefresh = (db) =>
  db.query("select * from instagram_accounts where token_expires_at < now() + interval '15 days' and connected_at < now() - interval '1 day'");

export const getPaymentAccount = (db, shopId) => db.one("select * from payment_accounts where shop_id = $1", [shopId]);
export const savePaymentAccount = (db, shopId, { keyId, keySecretEnc, webhookSecretEnc }) =>
  db.one(
    `insert into payment_accounts (shop_id, key_id, key_secret_enc, webhook_secret_enc) values ($1, $2, $3, $4)
     on conflict (shop_id) do update set key_id = excluded.key_id, key_secret_enc = excluded.key_secret_enc,
       webhook_secret_enc = excluded.webhook_secret_enc, updated_at = now()
     returning shop_id, key_id, updated_at`,
    [shopId, keyId, keySecretEnc, webhookSecretEnc],
  );
export const deletePaymentAccount = (db, shopId) => db.query("delete from payment_accounts where shop_id = $1", [shopId]);

// ── products ──────────────────────────────────────────────────
export const listProducts = (db, shopId, { activeOnly = false } = {}) =>
  db.query(`select * from products where shop_id = $1 ${activeOnly ? "and active" : ""} order by sort, created_at`, [shopId]);
export const getProduct = (db, shopId, id) => db.one("select * from products where shop_id = $1 and id = $2", [shopId, id]);

export function cleanProduct(p) {
  const num = (v) => Math.max(0, Math.round(Number(v) || 0));
  const prices = {};
  for (const [k, v] of Object.entries(p.prices || {})) if (String(k).trim()) prices[String(k).trim().toLowerCase().slice(0, 30)] = num(v);
  if (!Object.keys(prices).length) prices.standard = num(p.price);
  const sizes = {};
  for (const [k, v] of Object.entries(p.sizes || {})) if (String(k).trim()) sizes[String(k).trim().slice(0, 20)] = num(v);
  const list = (v) => (Array.isArray(v) ? v : String(v || "").split(/[,\n]/)).map((s) => String(s).trim()).filter(Boolean).slice(0, 30);
  return {
    name: String(p.name || "").trim().slice(0, 120),
    category: String(p.category || "").trim().slice(0, 60),
    description: String(p.description || "").trim().slice(0, 1000),
    prices,
    sizes,
    keywords: list(p.keywords),
    post_urls: list(p.post_urls),
    personalization_price: p.personalization_price === "" || p.personalization_price == null ? null : num(p.personalization_price),
    active: p.active !== false,
    sort: Number(p.sort) || 0,
  };
}

export async function saveProduct(db, shopId, id, input) {
  const p = cleanProduct(input);
  if (!p.name) throw Object.assign(new Error("Product name is required"), { status: 400 });
  const vals = [p.name, p.category, p.description, J(p.prices), J(p.sizes), J(p.keywords), J(p.post_urls), p.personalization_price, p.active, p.sort];
  if (id)
    return db.one(
      `update products set name=$3, category=$4, description=$5, prices=$6::text::jsonb, sizes=$7::text::jsonb, keywords=$8::text::jsonb,
         post_urls=$9::text::jsonb, personalization_price=$10, active=$11, sort=$12, updated_at=now()
       where shop_id = $1 and id = $2 returning *`,
      [shopId, id, ...vals],
    );
  return db.one(
    `insert into products (shop_id, name, category, description, prices, sizes, keywords, post_urls, personalization_price, active, sort)
     values ($1, $2, $3, $4, $5::text::jsonb, $6::text::jsonb, $7::text::jsonb, $8::text::jsonb, $9, $10, $11) returning *`,
    [shopId, ...vals],
  );
}
export const deleteProduct = (db, shopId, id) => db.query("delete from products where shop_id = $1 and id = $2", [shopId, id]);

// Changes stock for one size by delta (negative = sold). Never below zero.
export async function adjustStock(t, shopId, productId, size, delta) {
  if (!productId || !size) return;
  await t.query(
    `update products set sizes = jsonb_set(sizes, array[$3::text], to_jsonb(greatest(0, coalesce((sizes->>$3)::int, 0) + $4::int))), updated_at = now()
     where shop_id = $1 and id = $2 and sizes ? $3`,
    [shopId, productId, size, delta],
  );
}

// ── conversations & messages ─────────────────────────────────
export async function upsertConversation(db, shopId, channel, externalId) {
  return db.one(
    `insert into conversations (shop_id, channel, external_id) values ($1, $2, $3)
     on conflict (shop_id, channel, external_id) do update set external_id = excluded.external_id
     returning *`,
    [shopId, channel, externalId],
  );
}
export const getConversation = (db, shopId, id) => db.one("select * from conversations where shop_id = $1 and id = $2", [shopId, id]);
export const setConversation = (db, id, fields) => {
  const keys = Object.keys(fields);
  return db.one(`update conversations set ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")} where id = $1 returning *`, [id, ...keys.map((k) => fields[k])]);
};

export async function listConversations(db, shopId, { filter = "all", limit = 100 } = {}) {
  const where = filter === "needs_human" ? "and c.needs_human" : filter === "unread" ? "and c.unread > 0" : "";
  return db.query(
    `select c.*, (select text from messages m where m.conversation_id = c.id order by m.id desc limit 1) as last_text,
            (select sender from messages m where m.conversation_id = c.id order by m.id desc limit 1) as last_sender
     from conversations c where c.shop_id = $1 ${where} order by c.last_message_at desc limit $2`,
    [shopId, limit],
  );
}

// Returns the new row, or null if this Instagram message id was already stored (retries).
export async function addMessage(db, { shopId, conversationId, direction, sender, text, attachments = [], externalId = null }) {
  const row = await db.one(
    `insert into messages (shop_id, conversation_id, direction, sender, text, attachments, external_id)
     values ($1, $2, $3, $4, $5, $6::text::jsonb, $7) on conflict (external_id) do nothing returning *`,
    [shopId, conversationId, direction, sender, text || "", J(attachments), externalId],
  );
  if (row)
    await db.query(
      `update conversations set last_message_at = now()
         ${sender === "customer" ? ", last_customer_message_at = now(), unread = unread + 1" : ""}
       where id = $1`,
      [conversationId],
    );
  return row;
}
export const setMessageExternalId = (db, id, externalId) => db.query("update messages set external_id = $2 where id = $1", [id, externalId]);
export const recentMessages = (db, conversationId, limit = 40) =>
  db.query("select * from (select * from messages where conversation_id = $1 order by id desc limit $2) x order by id", [conversationId, limit]);

// ── orders ────────────────────────────────────────────────────
export async function createOrder(db, shopId, o) {
  return db.tx(async (t) => {
    const seq = await t.one("update shops set order_seq = order_seq + 1 where id = $1 returning order_seq, order_prefix", [shopId]);
    const number = `${seq.order_prefix}-${seq.order_seq}`;
    const order = await t.one(
      `insert into orders (shop_id, number, conversation_id, product_id, product_name, version, size, quantity, personalization,
         item_total, delivery_fee, cod_fee, total, payment, status, customer_name, phone, address, pincode, checks, history)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::text::jsonb,$21::text::jsonb) returning *`,
      [shopId, number, o.conversationId, o.productId, o.productName, o.version, o.size, o.quantity, o.personalization,
        o.itemTotal, o.deliveryFee, o.codFee, o.total, o.payment, o.status, o.customerName, o.phone, o.address, o.pincode,
        J(o.checks || {}), J([{ at: new Date().toISOString(), text: o.historyText || "Order placed on Instagram" }])],
    );
    await adjustStock(t, shopId, o.productId, o.size, -o.quantity);
    return order;
  });
}
export const getOrder = (db, shopId, id) => db.one("select * from orders where shop_id = $1 and id = $2", [shopId, id]);
export const findOrderByLink = (db, shopId, linkId) => db.one("select * from orders where shop_id = $1 and payment_link_id = $2", [shopId, linkId]);
export const ordersForConversation = (db, shopId, conversationId) =>
  db.query("select * from orders where shop_id = $1 and conversation_id = $2 order by created_at desc limit 10", [shopId, conversationId]);
export async function listOrders(db, shopId, { status, limit = 200 } = {}) {
  if (status === "open") return db.query("select * from orders where shop_id = $1 and status in ('awaiting_payment','review','paid','confirmed') order by created_at desc limit $2", [shopId, limit]);
  if (status) return db.query("select * from orders where shop_id = $1 and status = $2 order by created_at desc limit $3", [shopId, status, limit]);
  return db.query("select * from orders where shop_id = $1 order by created_at desc limit $2", [shopId, limit]);
}

// Moves an order to a new status (only from the allowed previous ones), with a history line.
// Returns the updated order, or null if it wasn't in an allowed state (already done).
export async function moveOrder(db, shopId, id, { to, from, note, extra = {} }) {
  return db.tx(async (t) => {
    const keys = Object.keys(extra);
    const sets = keys.map((k, i) => `, ${k} = $${i + 6}`).join("");
    const row = await t.one(
      `update orders set status = $3, updated_at = now(),
         history = history || jsonb_build_array(jsonb_build_object('at', now(), 'text', $4::text)) ${sets}
       where shop_id = $1 and id = $2 and status = any(string_to_array($5, ',')) returning *`,
      [shopId, id, to, note, [].concat(from).join(","), ...keys.map((k) => extra[k])],
    );
    if (row && to === "cancelled") await adjustStock(t, shopId, row.product_id, row.size, row.quantity);
    return row;
  });
}

export const markReminded = (db, id) => db.query("update orders set reminded_at = now() where id = $1", [id]);
export const unpaidOrders = (db) => db.query("select * from orders where status = 'awaiting_payment' and created_at < now() - interval '30 minutes'");

// ── leads, alerts ─────────────────────────────────────────────
export const addLead = (db, shopId, conversationId, data) =>
  db.one("insert into leads (shop_id, conversation_id, data) values ($1, $2, $3::text::jsonb) returning *", [shopId, conversationId, J(data)]);
export const listLeads = (db, shopId) => db.query("select * from leads where shop_id = $1 order by created_at desc limit 200", [shopId]);
export const setLeadStatus = (db, shopId, id, status) => db.one("update leads set status = $3 where shop_id = $1 and id = $2 returning *", [shopId, id, status]);

export const addAlert = (db, shopId, { kind, title, body = "", conversationId = null, orderId = null }) =>
  db.one("insert into alerts (shop_id, kind, title, body, conversation_id, order_id) values ($1,$2,$3,$4,$5,$6) returning *", [shopId, kind, title, body, conversationId, orderId]);
export const listAlerts = (db, shopId) => db.query("select * from alerts where shop_id = $1 order by id desc limit 50", [shopId]);
export const readAlerts = (db, shopId) => db.query("update alerts set read = true where shop_id = $1 and not read", [shopId]);

export async function stats(db, shopId) {
  return db.one(
    `select
       (select count(*)::int from orders where shop_id = $1 and created_at > now() - interval '24 hours') as orders_24h,
       (select coalesce(sum(total), 0)::int from orders where shop_id = $1 and status in ('paid','confirmed','shipped','delivered') and created_at > now() - interval '24 hours') as revenue_24h,
       (select count(*)::int from orders where shop_id = $1 and status = 'review') as to_review,
       (select count(*)::int from orders where shop_id = $1 and status = 'awaiting_payment') as awaiting_payment,
       (select count(*)::int from conversations where shop_id = $1 and needs_human) as needs_human,
       (select count(*)::int from messages where shop_id = $1 and sender = 'customer' and created_at > now() - interval '24 hours') as messages_24h,
       (select count(*)::int from leads where shop_id = $1 and status = 'new') as new_leads`,
    [shopId],
  );
}
