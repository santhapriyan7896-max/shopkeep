// Instagram API with Unified Login (what new Meta apps get): Facebook-dialog connect,
// business system-user token, everything on graph.facebook.com with the Instagram
// account id in the path. Meta is faked; the database is real (PGlite, in memory).

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import { openDb } from "../src/db.mjs";
import { createApp } from "../src/app.mjs";

const APP_SECRET_META = "meta-app-secret";
const IG_ID = "17841400000000077";
const CUSTOMER = "5551234";
const calls = [];
let rejectButtons = false;

async function fakeFetch(url, opts = {}) {
  const u = new URL(url);
  const body = typeof opts.body === "string" ? JSON.parse(opts.body) : null;
  calls.push({ host: u.host, path: u.pathname, query: Object.fromEntries(u.searchParams), method: opts.method || "GET", auth: opts.headers && opts.headers.Authorization, body });
  const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
  if (u.host !== "graph.facebook.com") return json({ error: { message: "wrong host " + u.host } }, 400);
  if (u.pathname === "/v27.0/oauth/access_token") return json({ access_token: "suat-token", token_type: "bearer" });
  if (u.pathname === "/v27.0/me/assigned_instagram_accounts") return json({ data: [{ id: IG_ID, username: "activewear.33" }, { id: "999", username: "other.shop" }] });
  if (u.pathname === `/v27.0/${IG_ID}/subscribed_apps`) return json({ success: true });
  if (u.pathname === `/v27.0/${IG_ID}/messages`) {
    if (rejectButtons && body.message.attachment) return json({ error: { message: "Unsupported template" } }, 400);
    return json({ recipient_id: CUSTOMER, message_id: "m" + calls.length });
  }
  if (u.pathname === `/v27.0/${CUSTOMER}`) return json({ name: "Kavya", username: "kavya.r" });
  return json({ error: { message: "unexpected " + u.pathname } }, 404);
}
const sends = () => calls.filter((c) => c.path.endsWith("/messages")).map((c) => c.body);

const fakeAi = {
  provider: "fake",
  model: "fake",
  isQuotaError: () => false,
  async run({ system, messages, runTool }) {
    const last = messages.at(-1).content;
    if (/book/.test(last)) {
      const id = system.match(/"id":"([0-9a-f]{8})"/)[1];
      const out = await runTool("save_order", { product_id: id, version: "standard", size: "", quantity: 1, personalization: "", customer_name: "Kavya", phone: "9876501234", address: "4 Lake Road, Gandhipuram, Coimbatore", pincode: "641012", payment: "UPI" });
      return { texts: [`Booked ${out.order_number}`] };
    }
    return { texts: ["Vanakkam! How can I help?"] };
  },
};

let server, base, db, app;
let cookie = "";
async function api(method, path, body) {
  const r = await fetch(base + path, { method, redirect: "manual", headers: { Cookie: cookie, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const set = r.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const t = await r.text();
  try {
    return { status: r.status, data: JSON.parse(t), headers: r.headers };
  } catch {
    return { status: r.status, data: t, headers: r.headers };
  }
}
async function dm(text, mid) {
  const raw = JSON.stringify({ object: "instagram", entry: [{ id: IG_ID, time: Date.now(), messaging: [{ sender: { id: CUSTOMER }, recipient: { id: IG_ID }, timestamp: Date.now(), message: { mid, text } }] }] });
  const sig = "sha256=" + crypto.createHmac("sha256", APP_SECRET_META).update(raw).digest("hex");
  return fetch(base + "/webhooks/instagram", { method: "POST", headers: { "X-Hub-Signature-256": sig }, body: raw });
}
async function until(fn, ms = 3000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

before(async () => {
  db = await openDb();
  app = createApp({
    db,
    ai: fakeAi,
    fetchImpl: fakeFetch,
    debounceOverrideMs: 0,
    log: { error() {}, warn() {}, log() {} },
    config: { appSecret: "u".repeat(40), publicUrl: "https://shop.test", igMode: "unified", igAppId: "meta-123", igAppSecret: APP_SECRET_META, igConfigId: "cfg-42", igVerifyToken: "vt", jobs: false },
  });
  server = http.createServer(async (req, res) => {
    if (!(await app.handle(req, res, new URL(req.url, "http://x")))) {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  await api("POST", "/api/v1/auth/signup", { email: "u@shop.test", password: "unified pass", shop_name: "Activewear33" });
  await api("POST", "/api/v1/products", { name: "Team Kit", prices: { standard: 650 } });
  await api("PUT", "/api/v1/shop", { settings: { payments: { upi: true, cod: false }, delivery_fee: 0 } });
});
after(async () => {
  app.close();
  server.close();
  await db.close();
});

test("connect link is Meta's Facebook dialog with the configuration id", async () => {
  const r = await api("POST", "/api/v1/instagram/connect", {});
  const u = new URL(r.data.url);
  assert.equal(u.host, "www.facebook.com");
  assert.equal(u.pathname, "/dialog/oauth");
  assert.equal(u.searchParams.get("config_id"), "cfg-42");
  assert.equal(u.searchParams.get("client_id"), "meta-123");
  assert.equal(u.searchParams.get("redirect_uri"), "https://shop.test/auth/instagram/callback");
  assert.equal(u.searchParams.get("scope"), null, "config_id replaces scope");
  assert.equal((await api("GET", "/api/v1/me")).data.instagram_mode, "unified");
});

test("callback: code → system-user token → Instagram account → webhook subscription", async () => {
  const state = new URL((await api("POST", "/api/v1/instagram/connect", {})).data.url).searchParams.get("state");
  const cb = await api("GET", `/auth/instagram/callback?code=CODE1&state=${encodeURIComponent(state)}`);
  assert.equal(cb.headers.get("location"), "/app/#settings?ig=connected");
  const ex = calls.find((c) => c.path === "/v27.0/oauth/access_token");
  assert.equal(ex.query.client_secret, APP_SECRET_META);
  assert.equal(ex.query.code, "CODE1");
  const sub = calls.find((c) => c.path.endsWith("/subscribed_apps"));
  assert.equal(sub.method, "POST");
  assert.equal(sub.query.subscribed_fields, "messages");
  const me = (await api("GET", "/api/v1/me")).data.shop;
  assert.equal(me.instagram.username, "activewear.33");
  assert.equal(me.instagram.expires_at, null, "this token doesn't expire");
  const alerts = (await api("GET", "/api/v1/alerts")).data.alerts;
  assert.ok(alerts.some((a) => a.body.includes("other.shop")), "told about the extra account it won't answer");
});

test("DM in → reply sent to graph.facebook.com/<ig id>/messages with the token", async () => {
  await api("PUT", "/api/v1/shop", { bot_enabled: true });
  await dm("hi", "u.1");
  await until(() => sends().length >= 1);
  const send = calls.find((c) => c.path === `/v27.0/${IG_ID}/messages`);
  assert.equal(send.auth, "Bearer suat-token");
  assert.deepEqual(send.body, { recipient: { id: CUSTOMER }, message: { text: "Vanakkam! How can I help?" } });
  const conv = await until(async () => (await api("GET", "/api/v1/conversations")).data.conversations.find((c) => c.customer_name));
  assert.equal(conv.customer_name, "Kavya");
});

test("order over Unified login: confirmation and UPI details both reach the customer", async () => {
  const before = sends().length;
  await api("PUT", "/api/v1/shop", { settings: { upi_id: "aw33@okaxis" } });
  await dm("book it", "u.2");
  await until(() => sends().length >= before + 2);
  const texts = sends().slice(before).map((b) => b.message.text);
  assert.match(texts[0], /Booked /);
  assert.match(texts[1], /aw33@okaxis/);
});

test("button refused → same message re-sent as text with the link", async () => {
  const { makeInstagram } = await import("../src/instagram.mjs");
  const ig = makeInstagram({ mode: "unified", appId: "a", appSecret: "b", configId: "c", redirectUri: "https://x/cb", fetchImpl: fakeFetch });
  rejectButtons = true;
  const n = calls.length;
  await ig.sendButton({ token: "suat-token", igUserId: IG_ID }, CUSTOMER, "Order AW-1 · ₹650", "Pay ₹650", "https://rzp.io/i/abc");
  const tried = calls.slice(n).filter((c) => c.path.endsWith("/messages"));
  assert.equal(tried.length, 2);
  assert.ok(tried[0].body.message.attachment, "tried the button first");
  assert.equal(tried[1].body.message.text, "Order AW-1 · ₹650\n\nPay ₹650: https://rzp.io/i/abc");
});
