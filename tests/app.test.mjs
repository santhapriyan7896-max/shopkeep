// End-to-end tests for the real product: accounts, catalog, Instagram connect + webhook,
// AI replies with tools, Razorpay payment links + webhook, staff takeover.
// The AI, Instagram and Razorpay are replaced by fakes; the database is a real
// Postgres (PGlite, in memory).
//
//   npm test

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import { openDb } from "../src/db.mjs";
import { createApp } from "../src/app.mjs";

const IG_SECRET = "ig-app-secret";
const IG_ACCOUNT = "17841400000000001";
const CUSTOMER = "998877665544";
const sigIg = (raw) => "sha256=" + crypto.createHmac("sha256", IG_SECRET).update(raw).digest("hex");

// ── fakes ─────────────────────────────────────────────────────
const outbound = []; // everything the server sent to Instagram / Razorpay
let linkSeq = 0;
async function fakeFetch(url, opts = {}) {
  const u = new URL(url);
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  outbound.push({ url: u.href, method: opts.method || "GET", body: opts.body && typeof opts.body === "string" ? JSON.parse(opts.body) : null });
  if (u.host === "api.instagram.com" && u.pathname === "/oauth/access_token") return json({ data: [{ access_token: "short-token", user_id: "app-scoped-1" }] });
  if (u.pathname === "/access_token") return json({ access_token: "long-token", token_type: "bearer", expires_in: 5184000 });
  if (u.pathname.endsWith("/me") && u.searchParams.get("fields")) return json({ user_id: IG_ACCOUNT, username: "testshop" });
  if (u.pathname.endsWith("/me/subscribed_apps")) return json({ success: true });
  if (u.pathname.endsWith("/me/messages")) return json({ recipient_id: CUSTOMER, message_id: "mid.out." + outbound.length });
  if (u.pathname.endsWith(`/${CUSTOMER}`)) return json({ name: "Arun K", username: "arun.k" });
  if (u.host === "api.razorpay.com") {
    linkSeq++;
    return json({ id: `plink_${linkSeq}`, short_url: `https://rzp.io/i/test${linkSeq}` });
  }
  return json({ error: { message: "unexpected " + u.href } }, 404);
}
const igSends = () => outbound.filter((o) => o.url.includes("/me/messages")).map((o) => o.body);

// A scripted "AI": reads the product id out of the real system prompt and calls the
// real tools, so prompt building and tool code both run.
const fakeAi = {
  provider: "fake",
  model: "fake-1",
  isQuotaError: () => false,
  async run({ system, messages, runTool }) {
    const last = messages[messages.length - 1].content;
    const productId = (system.match(/"id":"([0-9a-f]{8})"/) || [])[1];
    const order = (payment, phone = "98765 43210") =>
      runTool("save_order", { product_id: productId, version: "player", size: "L", quantity: 1, personalization: "", customer_name: "Arun", phone, address: "12 Gandhi Street, RS Puram, Coimbatore", pincode: "641002", payment });
    if (/bad phone/.test(last)) {
      const out = await order("UPI", "12345");
      return { texts: [out.error ? "Can you check the phone number? It needs 10 digits." : "booked?"] };
    }
    if (/book upi/.test(last)) {
      if (/Orders already booked in this chat/.test(system) && !/TEST-\d+: .*cancelled/.test(system) && /ok book upi/.test(last)) {
        // the real tool must refuse a duplicate even if the model tries
        const again = await order("UPI");
        return { texts: [again.already_booked ? `Already booked ${again.order_number}` : `Booked again ${again.order_number}`] };
      }
      const out = await order("UPI");
      return { texts: [`Booked ✅ Order ${out.order_number}, total ₹${out.total}.`] };
    }
    if (/book cod/.test(last)) {
      const out = await order("COD");
      return { texts: [`Order ${out.order_number} placed, the team will confirm it soon.`] };
    }
    if (/where is my order/.test(last)) {
      const out = await runTool("find_orders", {});
      return { texts: [`Your order ${out.orders[0].number} is ${out.orders[0].status}.`] };
    }
    if (/refund/.test(last)) {
      await runTool("handoff_to_human", { priority: "urgent", summary: "Wants a refund" });
      return { texts: ["Sorry about that. The team will reply during team hours."] };
    }
    if (/refuse/.test(last)) return { texts: [], refused: true };
    return { texts: [`Hi! We have ${productId ? "jerseys" : "nothing yet"}.\n\nWhich size do you need?`] };
  },
};

// ── server ────────────────────────────────────────────────────
let server, base, db, app;
before(async () => {
  db = await openDb();
  app = createApp({
    db,
    ai: fakeAi,
    fetchImpl: fakeFetch,
    debounceOverrideMs: 0,
    log: { error() {}, warn() {}, log() {} },
    config: { appSecret: "s".repeat(40), publicUrl: "https://shop.test", igMode: "instagram", igAppId: "123", igAppSecret: IG_SECRET, igVerifyToken: "verify-me", jobs: false },
  });
  server = http.createServer(async (req, res) => {
    if (!(await app.handle(req, res, new URL(req.url, "http://x")))) {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  app.close();
  server.close();
  await db.close();
});

function client() {
  let cookie = "";
  async function call(method, path, body) {
    const r = await fetch(base + path, {
      method,
      redirect: "manual",
      headers: { Cookie: cookie, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = r.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const text = await r.text();
    let data = text;
    try {
      data = JSON.parse(text);
    } catch {}
    return { status: r.status, data, headers: r.headers };
  }
  return { call, get: (p) => call("GET", p), post: (p, b = {}) => call("POST", p, b), put: (p, b) => call("PUT", p, b), del: (p) => call("DELETE", p, {}) };
}

async function until(fn, ms = 3000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function postWebhook(body) {
  const raw = JSON.stringify(body);
  return fetch(base + "/webhooks/instagram", { method: "POST", headers: { "Content-Type": "application/json", "X-Hub-Signature-256": sigIg(raw) }, body: raw });
}
const dm = (text, mid, extra = {}) => ({
  object: "instagram",
  entry: [{ id: IG_ACCOUNT, time: Date.now(), messaging: [{ sender: { id: CUSTOMER }, recipient: { id: IG_ACCOUNT }, timestamp: Date.now(), message: { mid, text, ...extra } }] }],
});
const echo = (text, mid) => ({
  object: "instagram",
  entry: [{ id: IG_ACCOUNT, time: Date.now(), messaging: [{ sender: { id: IG_ACCOUNT }, recipient: { id: CUSTOMER }, timestamp: Date.now(), message: { mid, text, is_echo: true } }] }],
});

// ── tests ─────────────────────────────────────────────────────
const owner = client();
let productId;

test("sign up, sign in, wrong password, signed-out access", async () => {
  assert.equal((await owner.get("/api/v1/me")).status, 401);
  const bad = await owner.post("/api/v1/auth/signup", { email: "owner@shop.test", password: "short", shop_name: "Test Shop" });
  assert.equal(bad.status, 400);
  const ok = await owner.post("/api/v1/auth/signup", { email: "Owner@Shop.test", password: "correct horse", name: "Priya", shop_name: "Test Shop" });
  assert.equal(ok.status, 200);
  const me = await owner.get("/api/v1/me");
  assert.equal(me.data.shop.name, "Test Shop");
  assert.equal(me.data.shop.order_prefix, "TEST");
  assert.equal(me.data.shop.instagram.connected, false);
  const dup = await client().post("/api/v1/auth/signup", { email: "owner@shop.test", password: "correct horse", shop_name: "X" });
  assert.equal(dup.status, 409);
  const wrong = await client().post("/api/v1/auth/login", { email: "owner@shop.test", password: "nope nope" });
  assert.equal(wrong.status, 401);
  const c = client();
  assert.equal((await c.post("/api/v1/auth/login", { email: "OWNER@shop.test", password: "correct horse" })).status, 200);
  assert.equal((await c.get("/api/v1/me")).status, 200);
});

test("JSON is required for changes (blocks cross-site form posts)", async () => {
  const r = await fetch(base + "/api/v1/auth/login", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "email=a&password=b" });
  assert.equal(r.status, 415);
});

test("shop settings and products", async () => {
  const s = await owner.put("/api/v1/shop", { settings: { handle: "@testshop", delivery_fee: 70, free_delivery_above: 999, cod_fee: 50, payments: { upi: true, cod: true }, staff_hours: "10 AM – 8 PM", nonsense: "dropped" } });
  assert.equal(s.status, 200);
  assert.equal(s.data.shop.settings.handle, "testshop");
  assert.equal(s.data.shop.settings.nonsense, undefined);
  const p = await owner.post("/api/v1/products", { name: "Ferrari F1 Jersey", category: "F1", prices: { fan: 599, player: 899 }, sizes: { M: 3, L: 10, XL: 0 }, keywords: "ferrari, f1", post_urls: ["https://www.instagram.com/p/ABC123/"] });
  assert.equal(p.status, 200);
  productId = p.data.product.id;
  assert.deepEqual(p.data.product.keywords, ["ferrari", "f1"]);
  assert.equal((await owner.post("/api/v1/products", { name: "" })).status, 400);
  const list = await owner.get("/api/v1/products");
  assert.equal(list.data.products.length, 1);
});

test("another shop can't see or change this shop's data", async () => {
  const other = client();
  await other.post("/api/v1/auth/signup", { email: "rival@shop.test", password: "another pass", shop_name: "Rival" });
  assert.equal((await other.get("/api/v1/products")).data.products.length, 0);
  assert.equal((await other.put(`/api/v1/products/${productId}`, { name: "Hacked" })).status, 404);
  await other.del(`/api/v1/products/${productId}`);
  assert.equal((await owner.get("/api/v1/products")).data.products[0].name, "Ferrari F1 Jersey");
});

test("test chat talks to the assistant and books a UPI order (manual UPI ID)", async () => {
  await owner.put("/api/v1/shop", { settings: { upi_id: "testshop@okaxis" } });
  const hi = await owner.post("/api/v1/test-chat", { text: "hi price?" });
  assert.equal(hi.status, 200);
  const texts = hi.data.messages.map((m) => m.text);
  assert.ok(texts.includes("Hi! We have jerseys."), texts.join(" | "));
  assert.ok(texts.includes("Which size do you need?"));
  const book = await owner.post("/api/v1/test-chat", { text: "book upi" });
  const last = book.data.messages.slice(-2).map((m) => m.text);
  assert.match(last[0], /Order TEST-1001, total ₹969/); // 899 + 70 delivery
  assert.match(last[1], /testshop@okaxis/);
  const orders = (await owner.get("/api/v1/orders")).data.orders;
  assert.equal(orders[0].status, "awaiting_payment");
  const product = (await owner.get("/api/v1/products")).data.products[0];
  assert.equal(product.sizes.L, 9, "stock goes down");
  await owner.post("/api/v1/test-chat/reset");
  assert.equal((await owner.get("/api/v1/test-chat")).data.messages.length, 0);
});

test("asking to book the same thing again doesn't create a second order", async () => {
  await owner.post("/api/v1/test-chat/reset");
  const before = (await owner.get("/api/v1/orders")).data.orders.length;
  const first = await owner.post("/api/v1/test-chat", { text: "book upi" });
  const n1 = first.data.messages.map((m) => m.text).join(" ").match(/TEST-\d+/)[0];
  const again = await owner.post("/api/v1/test-chat", { text: "ok book upi" });
  assert.equal((await owner.get("/api/v1/orders")).data.orders.length, before + 1, "still one new order");
  assert.ok(again.data.messages.some((m) => m.text.includes(`Already booked ${n1}`)), again.data.messages.map((m) => m.text).join(" | "));
  const o = (await owner.get("/api/v1/orders")).data.orders.find((x) => x.number === n1);
  await owner.post(`/api/v1/orders/${o.id}/status`, { status: "cancelled", notify: false });
  await owner.post("/api/v1/test-chat/reset");
});

test("bad phone number is sent back to the assistant, no order saved", async () => {
  const before = (await owner.get("/api/v1/orders")).data.orders.length;
  const r = await owner.post("/api/v1/test-chat", { text: "bad phone" });
  assert.match(r.data.messages.at(-1).text, /10 digits/);
  assert.equal((await owner.get("/api/v1/orders")).data.orders.length, before);
});

test("connect Instagram (OAuth) and receive the webhook verification", async () => {
  const c = await owner.post("/api/v1/instagram/connect");
  const authUrl = new URL(c.data.url);
  assert.equal(authUrl.host, "www.instagram.com");
  assert.match(authUrl.searchParams.get("scope"), /instagram_business_manage_messages/);
  const state = authUrl.searchParams.get("state");
  const cb = await owner.get(`/auth/instagram/callback?code=abc123%23_&state=${encodeURIComponent(state)}`);
  assert.equal(cb.status, 302);
  assert.equal(cb.headers.get("location"), "/app/#settings?ig=connected");
  const me = await owner.get("/api/v1/me");
  assert.equal(me.data.shop.instagram.username, "testshop");
  assert.ok(outbound.some((o) => o.url.includes("subscribed_apps")));
  // A forged state is refused.
  const forged = await owner.get(`/auth/instagram/callback?code=x&state=forged.value`);
  assert.match(forged.headers.get("location"), /ig=error/);

  const v = await fetch(base + "/webhooks/instagram?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=42");
  assert.equal(await v.text(), "42");
  const nv = await fetch(base + "/webhooks/instagram?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=42");
  assert.equal(nv.status, 403);
});

test("Instagram DM: bot off → no reply; bot on → reply sent; duplicates ignored", async () => {
  const bad = await fetch(base + "/webhooks/instagram", { method: "POST", headers: { "X-Hub-Signature-256": "sha256=00" }, body: JSON.stringify(dm("hi", "m1")) });
  assert.equal(bad.status, 401);

  assert.equal((await postWebhook(dm("hello", "mid.1"))).status, 200);
  const convs = await until(async () => (await owner.get("/api/v1/conversations")).data.conversations.find((c) => c.channel === "instagram"));
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(igSends().length, 0, "assistant is off until the owner turns it on");
  assert.equal((await until(async () => (await owner.get(`/api/v1/conversations/${convs.id}`)).data.conversation.customer_name)), "Arun K");

  await owner.put("/api/v1/shop", { bot_enabled: true });
  await postWebhook(dm("hi there", "mid.2"));
  await until(() => igSends().length >= 2);
  assert.deepEqual(igSends().map((b) => b.message.text), ["Hi! We have jerseys.", "Which size do you need?"]);
  assert.equal(igSends()[0].recipient.id, CUSTOMER);

  await postWebhook(dm("hi there", "mid.2")); // Meta retry
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(igSends().length, 2);
});

test("our own echoes are ignored; a staff reply from the Instagram app pauses the bot", async () => {
  const sentText = igSends()[0].message.text;
  await postWebhook(echo(sentText, "mid.echo.ours"));
  await new Promise((r) => setTimeout(r, 100));
  let conv = (await owner.get("/api/v1/conversations")).data.conversations.find((c) => c.channel === "instagram");
  assert.equal(conv.bot_paused_until, null);

  await postWebhook(echo("Hi Arun, this is Priya from the shop", "mid.staff.1"));
  conv = await until(async () => (await owner.get("/api/v1/conversations")).data.conversations.find((c) => c.channel === "instagram" && c.bot_paused_until));
  const before = igSends().length;
  await postWebhook(dm("ok thanks", "mid.3"));
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(igSends().length, before, "bot stays quiet while staff handle the chat");

  await owner.post(`/api/v1/conversations/${conv.id}/bot`, { paused: false });
  const detail = await owner.get(`/api/v1/conversations/${conv.id}`);
  assert.ok(detail.data.messages.some((m) => m.sender === "staff" && m.text.includes("Priya")));
});

test("UPI order with Razorpay: pay link button, signed webhook confirms, customer told", async () => {
  const keys = await owner.put("/api/v1/payments/razorpay", { key_id: "rzp_test_abc123", key_secret: "sec", webhook_secret: "hook-secret" });
  assert.equal(keys.status, 200);
  assert.equal(keys.data.shop.payments.test_mode, true);
  assert.equal((await owner.put("/api/v1/payments/razorpay", { key_id: "nope", key_secret: "a", webhook_secret: "b" })).status, 400);

  const before = igSends().length;
  await postWebhook(dm("book upi", "mid.4"));
  await until(() => igSends().length >= before + 2);
  const [confirm, pay] = igSends().slice(before);
  const num = confirm.message.text.match(/TEST-\d+/)[0];
  assert.equal(pay.message.attachment.payload.buttons[0].url, "https://rzp.io/i/test1");
  assert.equal(pay.message.attachment.payload.buttons[0].title, "Pay ₹969");
  const rzpCall = outbound.find((o) => o.url.includes("razorpay"));
  assert.equal(rzpCall.body.amount, 96900);
  assert.equal(rzpCall.body.reference_id, num);

  const me = (await owner.get("/api/v1/me")).data.shop;
  const hook = new URL(me.urls.razorpay_webhook).pathname;
  const event = { event: "payment_link.paid", payload: { payment_link: { entity: { id: "plink_1", reference_id: num, amount: 96900, amount_paid: 96900, status: "paid" } }, payment: { entity: { id: "pay_XYZ", amount: 96900 } } } };
  const raw = JSON.stringify(event);
  const forged = await fetch(base + hook, { method: "POST", headers: { "X-Razorpay-Signature": "bad" }, body: raw });
  assert.equal(forged.status, 400);
  const sig = crypto.createHmac("sha256", "hook-secret").update(raw).digest("hex");
  const ok = await fetch(base + hook, { method: "POST", headers: { "X-Razorpay-Signature": sig }, body: raw });
  assert.equal(ok.status, 200);
  const order = (await owner.get("/api/v1/orders")).data.orders.find((o) => o.number === num);
  assert.equal(order.status, "paid");
  assert.equal(order.payment_id, "pay_XYZ");
  const paidText = igSends().at(-1).message.text;
  assert.ok(paidText.startsWith("Payment received ✅") && paidText.includes(num), paidText);

  // Razorpay retries the same webhook: nothing happens twice.
  const n = igSends().length;
  await fetch(base + hook, { method: "POST", headers: { "X-Razorpay-Signature": sig }, body: raw });
  assert.equal(igSends().length, n);
});

test("COD order goes to review; owner confirms, ships with tracking, customer is told", async () => {
  await postWebhook(dm("book cod", "mid.5"));
  const order = await until(async () => (await owner.get("/api/v1/orders?status=review")).data.orders[0]);
  assert.equal(order.total, 899 + 70 + 50);
  const alerts = (await owner.get("/api/v1/alerts")).data.alerts;
  assert.ok(alerts.some((a) => a.kind === "cod_review" && a.title.includes(order.number)));

  const wrong = await owner.post(`/api/v1/orders/${order.id}/status`, { status: "delivered" });
  assert.equal(wrong.status, 409);
  const c = await owner.post(`/api/v1/orders/${order.id}/status`, { status: "confirmed" });
  assert.equal(c.data.told, true);
  assert.match(igSends().at(-1).message.text, new RegExp(`${order.number} is confirmed`));
  await owner.post(`/api/v1/orders/${order.id}/status`, { status: "shipped", tracking: "DTDC D123" });
  assert.match(igSends().at(-1).message.text, /on the way[\s\S]*DTDC D123/);

  await postWebhook(dm("where is my order", "mid.6"));
  await until(() => /is shipped/.test(igSends().at(-1).message.text || ""));
});

test("cancelling restores stock", async () => {
  const p0 = (await owner.get("/api/v1/products")).data.products[0];
  await owner.post("/api/v1/test-chat", { text: "book cod" });
  const p1 = (await owner.get("/api/v1/products")).data.products[0];
  assert.equal(p1.sizes.L, p0.sizes.L - 1);
  const order = (await owner.get("/api/v1/orders?status=review")).data.orders[0];
  await owner.post(`/api/v1/orders/${order.id}/status`, { status: "cancelled" });
  const p2 = (await owner.get("/api/v1/products")).data.products[0];
  assert.equal(p2.sizes.L, p0.sizes.L);
});

test("hand-off and refusals flag the chat for a person", async () => {
  await postWebhook(dm("I want a refund", "mid.7"));
  const conv = await until(async () => (await owner.get("/api/v1/conversations?filter=needs_human")).data.conversations[0]);
  assert.equal(conv.needs_human, true);
  await owner.post(`/api/v1/conversations/${conv.id}/resolve`);
  await postWebhook(dm("please refuse this", "mid.8"));
  await until(async () => (await owner.get("/api/v1/conversations?filter=needs_human")).data.conversations.length === 1);
  assert.match(igSends().at(-1).message.text, /team will get back to you soon/);
});

test("staff reply from the dashboard goes to Instagram and pauses the bot", async () => {
  const conv = (await owner.get("/api/v1/conversations")).data.conversations.find((c) => c.channel === "instagram");
  const r = await owner.post(`/api/v1/conversations/${conv.id}/reply`, { text: "Refund done, sorry!" });
  assert.equal(r.status, 200);
  assert.equal(igSends().at(-1).message.text, "Refund done, sorry!");
  const after = (await owner.get(`/api/v1/conversations/${conv.id}`)).data.conversation;
  assert.ok(new Date(after.bot_paused_until) > new Date());
});

test("stats", async () => {
  const s = (await owner.get("/api/v1/stats")).data;
  assert.ok(s.orders_24h >= 4);
  assert.ok(s.revenue_24h >= 969);
});
