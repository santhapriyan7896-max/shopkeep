// Shopkeep, the real product: accounts, the owner app's API, Instagram connect,
// Instagram + Razorpay webhooks, live updates and background jobs.
//
//   const app = createApp({ db, ai, config });
//   if (await app.handle(req, res, url)) return;   // inside the HTTP server
//
// Routes
//   /api/v1/...                    owner app API (login cookie)
//   /auth/instagram/callback       Instagram OAuth return
//   /webhooks/instagram            Meta webhook (GET verify, POST events)
//   /webhooks/razorpay/<shopId>    Razorpay webhook (per shop, own secret)

import { EventEmitter } from "node:events";
import { makeCrypto, hashPassword, checkPassword, hmacMatches } from "./crypto.mjs";
import { makeInstagram, parseWebhook } from "./instagram.mjs";
import { makeRazorpay } from "./razorpay.mjs";
import { makeInbox } from "./inbox.mjs";
import * as repo from "./repo.mjs";

const COOKIE = "sk_session";
const SESSION_DAYS = 30;

export function createApp({ db, ai, config, fetchImpl = fetch, log = console, debounceOverrideMs }) {
  const crypto = makeCrypto(config.appSecret);
  const publicUrl = String(config.publicUrl || "").replace(/\/$/, "");
  const ig = makeInstagram({ mode: config.igMode, appId: config.igAppId, appSecret: config.igAppSecret, configId: config.igConfigId, redirectUri: `${publicUrl}/auth/instagram/callback`, version: config.igApiVersion, fetchImpl });
  const rzp = makeRazorpay({ fetchImpl });
  const bus = new EventEmitter();
  bus.setMaxListeners(0);
  const emit = (shopId, kind) => bus.emit(`shop:${shopId}`, kind);
  const inbox = makeInbox({ db, ai, ig, rzp, crypto, bus: { emit }, log, debounceOverrideMs });

  // ── helpers ─────────────────────────────────────────────────
  const send = (res, code, body, headers = {}) => {
    res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers });
    res.end(JSON.stringify(body));
  };
  const fail = (status, message) => Object.assign(new Error(message), { status });

  async function rawBody(req, limit) {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > limit) throw fail(413, "Request too large");
      chunks.push(c);
    }
    return Buffer.concat(chunks);
  }
  async function jsonBody(req) {
    const raw = await rawBody(req, 200_000);
    try {
      return raw.length ? JSON.parse(raw.toString("utf8")) : {};
    } catch {
      throw fail(400, "Invalid JSON");
    }
  }

  const hits = new Map();
  function limited(req, kind, perMinute) {
    const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "?";
    const key = `${kind}:${ip}`;
    const now = Date.now();
    const recent = (hits.get(key) || []).filter((t) => now - t < 60_000);
    recent.push(now);
    hits.set(key, recent);
    return recent.length > perMinute;
  }
  const hitsTimer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (!v.some((t) => now - t < 60_000)) hits.delete(k);
  }, 5 * 60_000);
  hitsTimer.unref();

  function cookieHeader(value, maxAge) {
    const secure = publicUrl.startsWith("https://") ? "; Secure" : "";
    return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
  }
  function readCookie(req) {
    const m = String(req.headers.cookie || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
    return m ? m[1] : null;
  }
  async function session(req) {
    const data = crypto.verify(readCookie(req));
    if (!data || !data.uid) return null;
    const user = await repo.getUser(db, data.uid);
    if (!user) return null;
    const shop = await repo.shopForUser(db, user.id);
    return shop ? { user, shop } : null;
  }

  async function shopView(shop) {
    const acct = await repo.getInstagram(db, shop.id);
    const pay = await repo.getPaymentAccount(db, shop.id);
    return {
      id: shop.id,
      name: shop.name,
      order_prefix: shop.order_prefix,
      bot_enabled: shop.bot_enabled,
      settings: { ...repo.defaultSettings(), ...shop.settings },
      instagram: acct ? { connected: true, username: acct.username, expires_at: acct.token_expires_at } : { connected: false },
      payments: pay ? { provider: "razorpay", key_id: pay.key_id, test_mode: pay.key_id.startsWith("rzp_test_") } : null,
      urls: { razorpay_webhook: `${publicUrl}/webhooks/razorpay/${shop.id}` },
    };
  }

  // ── public routes ───────────────────────────────────────────
  async function instagramWebhook(req, res, url) {
    if (req.method === "GET") {
      const ok = url.searchParams.get("hub.mode") === "subscribe" && config.igVerifyToken && url.searchParams.get("hub.verify_token") === config.igVerifyToken;
      res.writeHead(ok ? 200 : 403, { "Content-Type": "text/plain" });
      return res.end(ok ? url.searchParams.get("hub.challenge") || "" : "Forbidden");
    }
    const raw = await rawBody(req, 1_000_000);
    if (!hmacMatches(raw, config.igAppSecret, req.headers["x-hub-signature-256"])) {
      log.warn("Instagram webhook with a bad signature, ignored");
      res.writeHead(401);
      return res.end();
    }
    res.writeHead(200);
    res.end("EVENT_RECEIVED"); // answer fast; Meta retries slow webhooks
    let body;
    try {
      body = JSON.parse(raw.toString("utf8"));
    } catch {
      return;
    }
    for (const ev of parseWebhook(body)) {
      handleInstagramEvent(ev).catch((err) => log.error("Instagram event failed:", err));
    }
  }

  async function handleInstagramEvent(ev) {
    const acct = await repo.getInstagramByAccount(db, ev.igAccountId);
    if (!acct) return;
    const shop = await repo.getShop(db, acct.shop_id);
    if (!shop) return;
    if (ev.isEcho) return inbox.receiveEcho({ shop, customerId: ev.recipientId, text: ev.text, mid: ev.mid });
    if (ev.senderId === acct.ig_user_id) return;
    return inbox.receive({ shop, channel: "instagram", externalId: ev.senderId, text: ev.text, attachments: ev.attachments, mid: ev.mid });
  }

  async function razorpayWebhook(req, res, shopId) {
    const raw = await rawBody(req, 1_000_000);
    const pay = /^[0-9a-f-]{36}$/.test(shopId) ? await repo.getPaymentAccount(db, shopId) : null;
    if (!pay || !hmacMatches(raw, crypto.decrypt(pay.webhook_secret_enc), req.headers["x-razorpay-signature"])) {
      res.writeHead(400);
      return res.end();
    }
    const paid = rzp.parsePaid(JSON.parse(raw.toString("utf8")));
    if (paid) {
      const shop = await repo.getShop(db, shopId);
      await inbox.paymentReceived(shop, paid);
    }
    return send(res, 200, { ok: true });
  }

  async function instagramCallback(req, res, url) {
    const back = (q) => {
      res.writeHead(302, { Location: `/app/#settings?${q}` });
      res.end();
    };
    const state = crypto.verify(url.searchParams.get("state"));
    const s = await session(req);
    if (!state || !s || s.shop.id !== state.shop) return back("ig=error&reason=" + encodeURIComponent("Sign in again and retry"));
    if (url.searchParams.get("error")) return back("ig=cancelled");
    try {
      const c = await ig.connect(url.searchParams.get("code"));
      await repo.saveInstagram(db, s.shop.id, { igUserId: c.igUserId, username: c.username, tokenEnc: crypto.encrypt(c.token), expiresAt: c.expiresAt });
      if (c.otherAccounts.length)
        await repo.addAlert(db, s.shop.id, { kind: "system", title: `Connected @${c.username}`, body: `You also shared ${c.otherAccounts.join(", ")}. Shopkeep answers one account per shop; make another shop account for the others.` });
      emit(s.shop.id, "settings");
      return back("ig=connected");
    } catch (err) {
      log.error("Instagram connect failed:", err.message, err.details ? `| ${err.details.join(" | ")}` : "");
      return back("ig=error&reason=" + encodeURIComponent(err.message.slice(0, 200)));
    }
  }

  // ── owner API ───────────────────────────────────────────────
  async function api(req, res, url) {
    const path = url.pathname.slice("/api/v1".length);
    const method = req.method;
    if (method !== "GET" && !String(req.headers["content-type"] || "").startsWith("application/json"))
      throw fail(415, "Send JSON"); // also blocks cross-site form posts

    // accounts
    if (path === "/auth/signup" && method === "POST") {
      if (limited(req, "auth", 10)) throw fail(429, "Too many attempts, wait a minute");
      const b = await jsonBody(req);
      if (config.signupCode && b.signup_code !== config.signupCode) throw fail(403, "Invite code is wrong");
      const email = String(b.email || "").trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw fail(400, "Enter a valid email");
      if (String(b.password || "").length < 8) throw fail(400, "Password needs at least 8 characters");
      const shopName = String(b.shop_name || "").trim().slice(0, 80);
      if (!shopName) throw fail(400, "Enter your shop's name");
      if (await repo.findUserByEmail(db, email)) throw fail(409, "An account with this email already exists");
      const { user } = await repo.createAccount(db, { email, passwordHash: await hashPassword(b.password), name: String(b.name || "").slice(0, 80), shopName });
      return send(res, 200, { ok: true }, { "Set-Cookie": cookieHeader(crypto.sign({ uid: user.id }, SESSION_DAYS * 86400), SESSION_DAYS * 86400) });
    }
    if (path === "/auth/login" && method === "POST") {
      if (limited(req, "auth", 10)) throw fail(429, "Too many attempts, wait a minute");
      const b = await jsonBody(req);
      const user = await repo.findUserByEmail(db, b.email || "");
      if (!user || !(await checkPassword(b.password || "", user.password_hash))) throw fail(401, "Email or password is wrong");
      return send(res, 200, { ok: true }, { "Set-Cookie": cookieHeader(crypto.sign({ uid: user.id }, SESSION_DAYS * 86400), SESSION_DAYS * 86400) });
    }
    if (path === "/auth/logout" && method === "POST") return send(res, 200, { ok: true }, { "Set-Cookie": cookieHeader("", 0) });
    if (path === "/config" && method === "GET")
      return send(res, 200, { signup_code_required: !!config.signupCode, instagram_available: ig.configured, ai: ai ? { provider: ai.provider, model: ai.model } : null });

    const s = await session(req);
    if (!s) throw fail(401, "Please sign in");
    const { user, shop } = s;
    const sid = shop.id;
    let m;

    if (path === "/me" && method === "GET")
      return send(res, 200, { user, shop: await shopView(shop), ai: ai ? { provider: ai.provider, model: ai.model } : null, instagram_available: ig.configured, instagram_mode: ig.mode });

    if (path === "/shop" && method === "PUT") {
      const b = await jsonBody(req);
      const settings = b.settings ? sanitizeSettings({ ...repo.defaultSettings(), ...shop.settings, ...b.settings }) : undefined;
      const prefix = b.order_prefix != null ? String(b.order_prefix).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) || undefined : undefined;
      const updated = await repo.updateShop(db, sid, { name: b.name ? String(b.name).slice(0, 80) : undefined, settings, botEnabled: typeof b.bot_enabled === "boolean" ? b.bot_enabled : undefined, orderPrefix: prefix });
      emit(sid, "settings");
      return send(res, 200, { shop: await shopView(updated) });
    }

    if (path === "/stats" && method === "GET") return send(res, 200, await repo.stats(db, sid));

    // products
    if (path === "/products" && method === "GET") return send(res, 200, { products: await repo.listProducts(db, sid) });
    if (path === "/products" && method === "POST") return send(res, 200, { product: await repo.saveProduct(db, sid, null, await jsonBody(req)) });
    if ((m = path.match(/^\/products\/([0-9a-f-]{36})$/))) {
      if (method === "PUT") {
        const p = await repo.saveProduct(db, sid, m[1], await jsonBody(req));
        if (!p) throw fail(404, "Product not found");
        return send(res, 200, { product: p });
      }
      if (method === "DELETE") {
        await repo.deleteProduct(db, sid, m[1]);
        return send(res, 200, { ok: true });
      }
    }

    // conversations
    if (path === "/conversations" && method === "GET")
      return send(res, 200, { conversations: await repo.listConversations(db, sid, { filter: url.searchParams.get("filter") || "all" }) });
    if ((m = path.match(/^\/conversations\/([0-9a-f-]{36})(\/[a-z]+)?$/))) {
      const conv = await repo.getConversation(db, sid, m[1]);
      if (!conv) throw fail(404, "Conversation not found");
      const action = m[2];
      if (!action && method === "GET") {
        if (conv.unread) await repo.setConversation(db, conv.id, { unread: 0 });
        return send(res, 200, { conversation: { ...conv, unread: 0 }, messages: await repo.recentMessages(db, conv.id, 200), orders: await repo.ordersForConversation(db, sid, conv.id) });
      }
      if (action === "/reply" && method === "POST") {
        const text = String((await jsonBody(req)).text || "").trim().slice(0, 2000);
        if (!text) throw fail(400, "Type a message");
        await inbox.deliver(shop, conv, text, { sender: "staff" }).catch((err) => {
          throw fail(502, err.message);
        });
        await inbox.pauseBot(shop, conv);
        return send(res, 200, { ok: true });
      }
      if (action === "/bot" && method === "POST") {
        const b = await jsonBody(req);
        if (b.paused) await inbox.pauseBot(shop, conv);
        else await repo.setConversation(db, conv.id, { bot_paused_until: null });
        emit(sid, "conversation");
        return send(res, 200, { ok: true });
      }
      if (action === "/resolve" && method === "POST") {
        await repo.setConversation(db, conv.id, { needs_human: false });
        emit(sid, "conversation");
        return send(res, 200, { ok: true });
      }
    }

    // orders
    if (path === "/orders" && method === "GET") return send(res, 200, { orders: await repo.listOrders(db, sid, { status: url.searchParams.get("status") || null }) });
    if ((m = path.match(/^\/orders\/([0-9a-f-]{36})\/status$/)) && method === "POST") {
      const b = await jsonBody(req);
      const out = await inbox.changeOrderStatus(shop, m[1], String(b.status), { note: b.note ? String(b.note).slice(0, 300) : null, tracking: b.tracking ? String(b.tracking).slice(0, 200) : null, notify: b.notify !== false });
      return send(res, 200, out);
    }

    // leads & alerts
    if (path === "/leads" && method === "GET") return send(res, 200, { leads: await repo.listLeads(db, sid) });
    if ((m = path.match(/^\/leads\/([0-9a-f-]{36})$/)) && method === "POST") {
      const status = String((await jsonBody(req)).status);
      if (!["new", "contacted", "won", "lost"].includes(status)) throw fail(400, "Unknown status");
      return send(res, 200, { lead: await repo.setLeadStatus(db, sid, m[1], status) });
    }
    if (path === "/alerts" && method === "GET") return send(res, 200, { alerts: await repo.listAlerts(db, sid) });
    if (path === "/alerts/read" && method === "POST") {
      await repo.readAlerts(db, sid);
      return send(res, 200, { ok: true });
    }

    // test chat: talk to your own assistant before going live
    if (path === "/test-chat" && (method === "GET" || method === "POST")) {
      const conv = await repo.upsertConversation(db, sid, "test", `test:${user.id}`);
      if (method === "POST") {
        if (limited(req, "test", 20)) throw fail(429, "Slow down a little");
        if (!ai) throw fail(503, "No AI key is set on the server (GEMINI_API_KEY or ANTHROPIC_API_KEY)");
        const b = await jsonBody(req);
        const text = String(b.text || "").trim().slice(0, 1000);
        const attachments = b.shared_post_url ? [{ type: "share", url: String(b.shared_post_url).slice(0, 300) }] : [];
        if (!text && !attachments.length) throw fail(400, "Type a message");
        await inbox.receive({ shop, channel: "test", externalId: `test:${user.id}`, text, attachments, delayMs: 0 });
      }
      return send(res, 200, { conversation_id: conv.id, messages: await repo.recentMessages(db, conv.id, 100) });
    }
    if (path === "/test-chat/reset" && method === "POST") {
      await db.query("delete from conversations where shop_id = $1 and channel = 'test' and external_id = $2", [sid, `test:${user.id}`]);
      return send(res, 200, { ok: true });
    }

    // Instagram
    if (path === "/instagram/connect" && method === "POST") {
      if (!ig.configured) throw fail(503, "Instagram isn't set up on this server yet (META_APP_ID / META_APP_SECRET / META_CONFIG_ID)");
      return send(res, 200, { url: ig.authUrl(crypto.sign({ shop: sid, uid: user.id }, 15 * 60)) });
    }
    if (path === "/instagram/disconnect" && method === "POST") {
      await repo.deleteInstagram(db, sid);
      await repo.updateShop(db, sid, { botEnabled: false });
      emit(sid, "settings");
      return send(res, 200, { ok: true });
    }

    // Razorpay keys
    if (path === "/payments/razorpay" && method === "PUT") {
      const b = await jsonBody(req);
      const keyId = String(b.key_id || "").trim();
      const keySecret = String(b.key_secret || "").trim();
      const hookSecret = String(b.webhook_secret || "").trim();
      if (!/^rzp_(test|live)_[A-Za-z0-9]+$/.test(keyId)) throw fail(400, "Key ID looks like rzp_test_… or rzp_live_…");
      if (!keySecret || !hookSecret) throw fail(400, "Enter the key secret and the webhook secret");
      await repo.savePaymentAccount(db, sid, { keyId, keySecretEnc: crypto.encrypt(keySecret), webhookSecretEnc: crypto.encrypt(hookSecret) });
      emit(sid, "settings");
      return send(res, 200, { shop: await shopView(shop) });
    }
    if (path === "/payments/razorpay" && method === "DELETE") {
      await repo.deletePaymentAccount(db, sid);
      emit(sid, "settings");
      return send(res, 200, { ok: true });
    }

    // live updates (Server-Sent Events)
    if (path === "/events" && method === "GET") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
      res.write("retry: 3000\n\n");
      const onEvent = (kind) => res.write(`data: ${JSON.stringify({ kind })}\n\n`);
      bus.on(`shop:${sid}`, onEvent);
      const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
      req.on("close", () => {
        clearInterval(ping);
        bus.off(`shop:${sid}`, onEvent);
      });
      return;
    }

    throw fail(404, "Not found");
  }

  // ── entry point ─────────────────────────────────────────────
  async function handle(req, res, url) {
    const p = url.pathname;
    const ours = p.startsWith("/api/v1/") || p === "/webhooks/instagram" || p.startsWith("/webhooks/razorpay/") || p === "/auth/instagram/callback";
    if (!ours) return false;
    try {
      if (p === "/webhooks/instagram") await instagramWebhook(req, res, url);
      else if (p.startsWith("/webhooks/razorpay/") && req.method === "POST") await razorpayWebhook(req, res, p.split("/")[3]);
      else if (p === "/auth/instagram/callback") await instagramCallback(req, res, url);
      else if (p.startsWith("/api/v1/")) await api(req, res, url);
      else throw fail(404, "Not found");
    } catch (err) {
      if (!err.status || err.status >= 500) log.error(err);
      if (!res.headersSent) send(res, err.status || 500, { error: err.status ? err.message : "Something went wrong" });
    }
    return true;
  }

  // ── background jobs ─────────────────────────────────────────
  async function refreshTokens() {
    for (const acct of await repo.instagramDueForRefresh(db)) {
      try {
        const r = await ig.refresh(crypto.decrypt(acct.access_token_enc));
        await repo.updateInstagramToken(db, acct.shop_id, crypto.encrypt(r.token), r.expiresAt);
      } catch (err) {
        await repo.addAlert(db, acct.shop_id, { kind: "system", title: "Instagram connection needs renewing", body: "Open Settings and connect Instagram again. " + err.message.slice(0, 200) });
      }
    }
  }
  const jobs = [];
  if (config.jobs !== false) {
    const every = (ms, fn) => {
      const t = setInterval(() => fn().catch((err) => log.error("Job failed:", err)), ms);
      t.unref();
      jobs.push(t);
    };
    every(5 * 60_000, () => inbox.sweepUnpaid());
    every(6 * 3600_000, refreshTokens);
  }

  return {
    handle,
    inbox,
    close: () => {
      jobs.forEach(clearInterval);
      clearInterval(hitsTimer);
    },
  };
}

// Only known settings, with sane types, are stored.
function sanitizeSettings(s) {
  const str = (v, n = 500) => String(v ?? "").slice(0, n);
  const num = (v) => Math.max(0, Math.round(Number(v) || 0));
  return {
    handle: str(s.handle, 60).replace(/^@/, ""),
    about: str(s.about, 600),
    location: str(s.location, 120),
    address: str(s.address, 300),
    phone: str(s.phone, 40),
    staff_hours: str(s.staff_hours, 80),
    delivery_fee: num(s.delivery_fee),
    free_delivery_above: num(s.free_delivery_above),
    cod_fee: num(s.cod_fee),
    delivery_time: str(s.delivery_time, 120),
    payments: { upi: !!(s.payments && s.payments.upi), cod: !!(s.payments && s.payments.cod) },
    returns_policy: str(s.returns_policy, 600),
    offers: str(s.offers, 600),
    faq: str(s.faq, 4000),
    bulk_orders: str(s.bulk_orders, 600),
    upi_id: str(s.upi_id, 80),
    holding_message: str(s.holding_message, 300),
    human_pause_hours: Math.min(168, num(s.human_pause_hours)),
    debounce_seconds: Math.min(20, num(s.debounce_seconds)),
  };
}
