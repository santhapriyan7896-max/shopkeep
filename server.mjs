// Shopkeep server.
// - The product: owner app at /app/ with its API, Instagram + Razorpay webhooks
//   (src/app.mjs). Needs APP_SECRET; stores data in Supabase (DATABASE_URL) or,
//   locally, in ./.data.
// - The website, the two-phone demo and its "Live AI" chat (/api/chat), as before.
//
// Run:  npm install
//       npm start

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import crypto from "node:crypto";
import { openDb } from "./src/db.mjs";
import { makeAi } from "./src/ai.mjs";
import { createApp } from "./src/app.mjs";

import "./catalog.js";
import "./validate.js";
import "./bot.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3033);
const MODEL = process.env.AW33_MODEL || "claude-opus-5-5";
const C = globalThis.AW33_CATALOG;
const byId = Object.fromEntries(C.products.map((p) => [p.id, p]));
const V = globalThis.AW33Validate;

// ── Live AI provider ──────────────────────────────────────────
// Claude when ANTHROPIC_API_KEY is set, Gemini when GEMINI_API_KEY is set.
// If both are set, AI_PROVIDER=gemini (or claude) in .env decides.
const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
const PROVIDER = (
  process.env.AI_PROVIDER ||
  (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN ? "claude" : GEMINI_KEY ? "gemini" : "none")
).toLowerCase();
let gemini = null;

// ── Claude client (only when a key is configured) ─────────────
let client = null;
let Anthropic = null;
let liveProblem = "";
if (PROVIDER === "gemini") {
  liveProblem = GEMINI_KEY ? "" : "No GEMINI_API_KEY found (put it in .env).";
} else if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) {
  try {
    Anthropic = (await import("@anthropic-ai/sdk")).default;
    client = new Anthropic();
  } catch {
    liveProblem = "Run `npm install` to enable Live AI.";
  }
} else {
  liveProblem = "No AI key found – add GEMINI_API_KEY (or ANTHROPIC_API_KEY) to .env.";
}

// ── the product (owner app, Instagram, payments) ─────────────
async function startProduct() {
  try {
    let appSecret = process.env.APP_SECRET;
    const hosted = !!(process.env.RENDER || process.env.NODE_ENV === "production");
    if (!appSecret) {
      if (hosted) {
        console.warn("Owner app: off. Set APP_SECRET (a long random string) to turn it on.");
        return null;
      }
      // Local development: make one and keep it in .data/
      const file = path.join(here, ".data", "app-secret");
      appSecret = await fs.readFile(file, "utf8").catch(() => null);
      if (!appSecret) {
        appSecret = crypto.randomBytes(32).toString("hex");
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, appSecret);
      }
    }
    const url = process.env.DATABASE_URL;
    if (!url && hosted) console.warn("Owner app: no DATABASE_URL, so data lives on this server's disk and is lost on redeploy. Add your Supabase connection string.");
    const db = await openDb({ url, dir: url ? null : path.join(here, ".data", "pg") });
    const ai = await makeAi().catch((err) => {
      console.warn("Owner app: AI unavailable:", err.message);
      return null;
    });
    const app = createApp({
      db,
      ai,
      config: {
        appSecret,
        publicUrl: process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`,
        igAppId: process.env.IG_APP_ID,
        igAppSecret: process.env.IG_APP_SECRET,
        igVerifyToken: process.env.IG_VERIFY_TOKEN,
        igApiVersion: process.env.IG_API_VERSION || "v24.0",
        signupCode: process.env.SIGNUP_CODE || "",
      },
    });
    console.log(`Owner app: on (${db.kind === "postgres" ? "Supabase / Postgres" : "local database in .data/"}, AI ${ai ? `${ai.provider} · ${ai.model}` : "off"}, Instagram ${process.env.IG_APP_ID ? "configured" : "not configured"})`);
    return app;
  } catch (err) {
    console.error("Owner app failed to start:", err);
    return null;
  }
}
const product = await startProduct();

// ── prompt + tools ────────────────────────────────────────────
const catalogForModel = {
  shop: C.shop,
  sizeChart: C.sizeChart,
  teamwear: C.teamwear,
  products: C.products.map(({ id, category, name, versions, price, sizes, colour, note, print, shoe }) => ({
    id, category, name, colour, note, prices: versions || { standard: price }, stockBySize: sizes,
    nameNumberPrinting: !!print, footwear: !!shoe,
  })),
};

const SYSTEM = `You are the Instagram DM sales assistant for Activewear33 (@activewear.33), a sportswear shop in Coimbatore, Tamil Nadu. You answer customers at night while the shop team is offline (team hours ${C.shop.staffHours}).

How to write
- Write the way the shop's own staff reply on Instagram: short, plain, friendly. Send 1–3 short messages; separate each message with a blank line. Each message is 1–4 short lines.
- Plain text only: no markdown, no bold, no headings, no bullet symbols, no em dashes. A simple list of products is one per line, like "Ferrari – ₹899".
- At most one emoji per message, and most messages have none. No salesy filler like "Great choice!", "Absolutely!", "I'd be happy to help".
- Mirror the customer. Many write Tanglish (Tamil in English letters: "iruka", "evlo", "venum", "anna"). If they do, reply in light, natural Tanglish ("XL iruku anna", "Book pannatuma?"); otherwise simple English. If they call you "anna" or "bro", use it back now and then.
- Answer first, then ask the ONE next thing that moves toward a sale (product, then size, then version, then "Shall I book it?").
- Never claim to be a person. If asked whether this is a bot, say it's Activewear33's after-hours auto reply and the team is online from 9 AM.

Facts
- Use only the products, prices, sizes, stock and policies in the catalog below. Never invent products, prices, discounts or delivery promises. If something isn't covered, say you'll check with the team and call handoff_to_human.
- stockBySize is units left; 0 means sold out. Say "only N left" when N ≤ 2.
- Customers often share one of the shop's posts and ask "Price??". The shared product is given in square brackets at the start of their message.
- Size help: S ≤55 kg, M 56–65 kg, L 66–76 kg, XL 77–86 kg, XXL above. Player versions are slim-fit, so suggest one size up for a loose fit. For boots, use their normal UK shoe size.

Taking an order
- When product, size and version (if the product has several prices) are settled and the customer wants it, ask for name, phone number and full address with pincode, then COD or UPI.
- Then call save_order. It checks the phone number (10 digits, starting 6–9) and the address (valid pincode that matches the city, door number). If it returns an error, ask the customer to fix just that one thing, then call save_order again.
- UPI: the order waits for payment. A "Tap to pay" card appears under your message automatically; tell them to pay with it and that the order confirms as soon as the payment goes through. Don't write any link yourself.
- COD: the order goes to the team for review; tell them the team will verify and confirm by morning.

Team / custom kits (10+ pieces, college/school/club/corporate, own design or logo)
- Collect, one question at a time: sport, quantity, design (own design + logo / club-style / needs design help), names & numbers on the back (free for team orders), deadline, team name and a contact name.
- Then call save_team_lead and share the estimate range it returns. Say the team will call at 9 AM with a mockup and final quote.

Hand to a person
- Complaints, wrong or damaged items, order tracking, refunds, bargaining beyond listed offers, or anything you can't answer: apologise briefly if needed, call handoff_to_human, and tell them the team replies first thing at 9 AM.

Catalog (JSON)
${JSON.stringify(catalogForModel)}`;

const ids = C.products.map((p) => p.id);
const TOOLS = [
  {
    name: "save_order",
    description: "Book a confirmed retail order after the customer gave product, size, version, name, phone, address with pincode and payment method.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        product_id: { type: "string", enum: ids },
        version: { type: "string", enum: ["fan", "player", "set", "jersey", "standard"], description: "Which price option; 'standard' for single-price products" },
        size: { type: "string", description: "Exactly as in stockBySize, e.g. 'M' or 'UK 9'" },
        print_text: { type: "string", description: "Name & number to print, or empty string" },
        customer_name: { type: "string" },
        phone: { type: "string" },
        address: { type: "string" },
        pincode: { type: "string" },
        payment: { type: "string", enum: ["COD", "UPI"] },
      },
      required: ["product_id", "version", "size", "print_text", "customer_name", "phone", "address", "pincode", "payment"],
      additionalProperties: false,
    },
  },
  {
    name: "save_team_lead",
    description: "Save a custom team-kit enquiry for the owner to call back at 9 AM.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        sport: { type: "string" },
        quantity: { type: "integer" },
        design: { type: "string" },
        names_and_numbers: { type: "boolean" },
        deadline: { type: "string" },
        team_name: { type: "string" },
        contact_name: { type: "string" },
      },
      required: ["sport", "quantity", "design", "names_and_numbers", "deadline", "team_name", "contact_name"],
      additionalProperties: false,
    },
  },
  {
    name: "handoff_to_human",
    description: "Flag this conversation for the shop team (complaints, tracking, refunds, anything outside the catalog).",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        priority: { type: "string", enum: ["urgent", "normal"] },
        summary: { type: "string", description: "One line for the owner" },
      },
      required: ["priority", "summary"],
      additionalProperties: false,
    },
  },
];

// ── tool execution ────────────────────────────────────────────
let orderSeq = 1042;
function runTool(name, input, events, ctx) {
  if (name === "save_order") {
    const p = byId[input.product_id];
    if (!p) return { error: "Unknown product_id" };
    if (!(input.size in p.sizes)) return { error: `Size not available. Sizes: ${Object.keys(p.sizes).join(", ")}` };
    if (p.sizes[input.size] === 0) return { error: `${input.size} is sold out` };
    const ph = V.checkPhone(input.phone);
    if (!ph.ok) return { error: `Phone number ${ph.reason}. Ask the customer for a 10 digit mobile number starting with 6, 7, 8 or 9.` };
    const check = V.checkAddress(`${input.address}, ${input.pincode}`, { phone: ph.phone, name: input.customer_name });
    if (!check.pinOk) return { error: "Pincode missing or not valid. Ask for the 6 digit pincode." };
    if (check.cityMatch === false) return { error: `Pincode ${check.pincode} is in ${check.area || check.state}, but the address says ${check.city}. Ask which is correct.` };
    if (!check.hasDoor) return { error: "Address has no door / house number. Ask for it." };
    const item = (p.versions ? p.versions[input.version] ?? Math.min(...Object.values(p.versions)) : p.price) + (input.print_text ? C.shop.printPrice : 0);
    const ship = item >= C.shop.shipping.freeAbove ? 0 : C.shop.shipping.charge;
    const cod = input.payment === "COD" ? C.shop.codFee : 0;
    const total = item + ship + cod;
    const pin = check.pincode || "";
    const eta = pin.startsWith("641") ? C.shop.shipping.local : /^6[0-4]/.test(pin) ? C.shop.shipping.state : C.shop.shipping.india;
    const id = "AW33-" + Math.max(orderSeq, ctx.nextOrderNo || 0);
    orderSeq = Math.max(orderSeq, ctx.nextOrderNo || 0) + 1;
    const labels = { fan: "fan version", player: "player version", set: "set with shorts", jersey: "jersey only" };
    const status = input.payment === "UPI" ? "awaiting_payment" : "review";
    events.push({
      type: "order", id, product: p.name, productId: p.id, size: input.size, version: labels[input.version] || null,
      print: input.print_text || null, item, delivery: ship, codFee: cod, amount: total, payment: input.payment, eta, status,
      name: input.customer_name, phone: ph.phone, address: input.address, pincode: check.pincode, check,
    });
    return {
      order_id: id, item_price: item, delivery: ship, cod_fee: cod, total, delivery_time: eta, status,
      next_step: status === "awaiting_payment"
        ? "A 'Tap to pay' card is shown under your reply automatically. Ask them to pay with it; the order confirms itself after payment."
        : "COD order sent to the team for review. Tell them the team will verify and confirm by morning.",
    };
  }
  if (name === "save_team_lead") {
    const lo = input.quantity * C.teamwear.perSetLow;
    const hi = input.quantity * C.teamwear.perSetHigh;
    events.push({
      type: "lead", sport: input.sport, qty: input.quantity, design: input.design, names: input.names_and_numbers,
      deadline: input.deadline, contact: `${input.team_name}, ${input.contact_name}`, estimateLow: lo, estimateHigh: hi,
    });
    return { saved: true, estimate_low: lo, estimate_high: hi, per_set: `${C.teamwear.perSetLow}–${C.teamwear.perSetHigh}`, production: C.teamwear.production };
  }
  if (name === "handoff_to_human") {
    events.push({ type: "handoff", priority: input.priority, summary: input.summary });
    return { flagged: true, team_back_at: "9:00 AM" };
  }
  return { error: "Unknown tool" };
}

// ── one customer turn ─────────────────────────────────────────
// ── Gemini turn ───────────────────────────────────────────────
if (PROVIDER === "gemini" && GEMINI_KEY) {
  const { createGemini } = await import("./gemini.mjs");
  gemini = await createGemini({ key: GEMINI_KEY, model: process.env.GEMINI_MODEL, system: SYSTEM, tools: TOOLS, runTool });
}

async function chatTurnGemini(sessionId, text, sharedProductId, ctx = {}) {
  const shared = sharedProductId && byId[sharedProductId];
  const userText = (shared ? `[Customer shared your post: "${shared.name}" (product_id ${shared.id})]\n` : "") + (text || "(no text)");
  const events = [];
  for (const id of globalThis.AW33Bot.findProducts(globalThis.AW33Bot.normalize(text))) events.push({ type: "view", productId: id });
  if (shared) events.push({ type: "view", productId: shared.id });

  const texts = await gemini.chatTurn(sessionId, userText, events, ctx);
  if (texts === null) {
    events.push({ type: "handoff", priority: "normal", summary: (text || "").slice(0, 140) });
    return { messages: [{ text: "I've passed this to our team, they'll reply first thing in the morning 🙏" }], events };
  }
  // One bubble per paragraph, like separate DM messages – but never split mid-sentence.
  const pieces = [];
  for (const t of texts)
    for (const part of t.split(/\n\s*\n/)) {
      const clean = part.replace(/\*\*(.+?)\*\*/g, "$1").trim();
      if (!clean) continue;
      const prev = pieces[pieces.length - 1];
      if (prev && !/[.!?…:)\]"”]$|\p{Extended_Pictographic}$/u.test(prev)) pieces[pieces.length - 1] = prev + " " + clean;
      else pieces.push(clean);
    }
  const replies = pieces.map((text) => ({ text }));
  return { messages: replies.length ? replies : [{ text: "🙂" }], events };
}

const sessions = new Map(); // sessionId -> messages (kept exactly as returned, thinking blocks included)

async function chatTurn(sessionId, text, sharedProductId, ctx = {}) {
  if (!sessions.has(sessionId)) {
    if (sessions.size >= 500) sessions.delete(sessions.keys().next().value); // keep memory bounded
    sessions.set(sessionId, []);
  }
  const messages = sessions.get(sessionId);
  const before = messages.length;
  const shared = sharedProductId && byId[sharedProductId];
  const userText = (shared ? `[Customer shared your post: "${shared.name}" (product_id ${shared.id})]\n` : "") + (text || "(no text)");
  messages.push({ role: "user", content: userText });

  const events = [];
  for (const id of globalThis.AW33Bot.findProducts(globalThis.AW33Bot.normalize(text))) events.push({ type: "view", productId: id });
  if (shared) events.push({ type: "view", productId: shared.id });

  const replies = [];
  for (let i = 0; i < 6; i++) {
    const params = {
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      tools: TOOLS,
      messages,
      output_config: { effort: "low" },
      cache_control: { type: "ephemeral" },
    };
    // Haiku has no server-side fallback; Opus / Sonnet get one if a safety classifier declines.
    const response = MODEL.startsWith("claude-haiku")
      ? await client.messages.create(params)
      : await client.beta.messages.create({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });

    if (response.stop_reason === "refusal") {
      messages.length = before; // drop this turn; history stays exactly as it was
      events.push({ type: "handoff", priority: "normal", summary: (text || "").slice(0, 140) });
      return { messages: [{ text: "I've passed this to our team, they'll reply first thing in the morning 🙏" }], events };
    }

    messages.push({ role: "assistant", content: response.content });
    // One bubble per paragraph, like separate DM messages.
    for (const block of response.content) {
      if (block.type !== "text") continue;
      for (const part of block.text.split(/\n\s*\n/)) {
        const clean = part.replace(/\*\*(.+?)\*\*/g, "$1").trim();
        if (clean) replies.push({ text: clean });
      }
    }

    if (response.stop_reason === "pause_turn") continue;
    if (response.stop_reason !== "tool_use") break;

    const results = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      const out = runTool(block.name, block.input, events, ctx);
      results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(out), ...(out.error ? { is_error: true } : {}) });
    }
    messages.push({ role: "user", content: results });
  }
  return { messages: replies.length ? replies : [{ text: "🙂" }], events };
}

// ── India Post pincode lookup (free public API) ─────────────
const pinCache = new Map();
async function lookupPincode(pin) {
  if (pinCache.has(pin)) return pinCache.get(pin);
  try {
    const r = await fetch(`https://api.postalpincode.in/pincode/${pin}`, { signal: AbortSignal.timeout(6000) });
    const [j] = await r.json();
    const out = j && j.Status === "Success" && j.PostOffice
      ? { ok: true, pin, offices: j.PostOffice.map((o) => o.Name), district: j.PostOffice[0].District, state: j.PostOffice[0].State }
      : { ok: false, pin, error: "India Post has no record of this pincode" };
    pinCache.set(pin, out);
    return out;
  } catch {
    return { ok: false, pin, error: "Couldn't reach India Post right now" };
  }
}

// ── http ──────────────────────────────────────────────────────
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".mp4": "video/mp4" };

function sendJson(res, code, body) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let data = "";
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 20000) throw new Error("Message too long");
  }
  return JSON.parse(data || "{}");
}

// ── protection for a public deployment ────────────────────────
// Per-visitor rate limits, so nobody can run up the AI bill or hammer India Post.
const LIMITS = { chat: Number(process.env.CHAT_LIMIT_PER_MIN || 15), pincode: 30 };
const hits = new Map(); // "kind:ip" → recent request times
function rateLimited(req, kind) {
  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "?";
  const key = kind + ":" + ip;
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(key, recent);
  return recent.length > LIMITS[kind];
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) if (!v.some((t) => now - t < 60_000)) hits.delete(k);
}, 5 * 60_000).unref();

// ── built-in assistant as a safety net ────────────────────────
// Same catalog, checks and order flow as the offline demo (bot.js). Used while the
// AI is paused after a quota error or timeout.
let aiPausedUntil = 0;
const offlineStates = new Map();
function offlineTurn(sessionId, text, sharedProductId, ctx = {}) {
  if (!offlineStates.has(sessionId)) {
    if (offlineStates.size >= 500) offlineStates.delete(offlineStates.keys().next().value);
    offlineStates.set(sessionId, globalThis.AW33Bot.newState({ orderSeq: ctx.nextOrderNo || 1042 }));
  }
  const r = globalThis.AW33Bot.reply(offlineStates.get(sessionId), { text, sharedProductId });
  return { messages: r.messages.map((m) => ({ text: m.text })), events: r.events, fallback: true };
}

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "SAMEORIGIN", // our own pages embed each other; nobody else may
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  try {
    if (url.pathname === "/healthz") return sendJson(res, 200, { ok: true });
    if (url.pathname === "/app") {
      res.writeHead(301, { Location: "/app/" });
      return res.end();
    }
    if (product && (await product.handle(req, res, url))) return;
    if (url.pathname.startsWith("/api/v1/")) return sendJson(res, 503, { error: "The owner app isn't switched on for this server (APP_SECRET missing)." });
    const pinRoute = url.pathname.match(/^\/api\/pincode\/(\d{6})$/);
    if (pinRoute) {
      if (rateLimited(req, "pincode")) return sendJson(res, 429, { ok: false, error: "Too many lookups – try again in a minute" });
      return sendJson(res, 200, await lookupPincode(pinRoute[1]));
    }
    if (url.pathname === "/api/status")
      return sendJson(res, 200, { live: !!(gemini || client), model: gemini ? gemini.model : MODEL, provider: gemini ? "gemini" : "claude", note: liveProblem });
    if (url.pathname === "/api/chat" && req.method === "POST") {
      if (!gemini && !client) return sendJson(res, 503, { error: liveProblem });
      if (rateLimited(req, "chat")) return sendJson(res, 429, { error: "You're sending messages very fast – wait a minute and try again." });
      const body = await readBody(req);
      const sessionId = String(body.sessionId || "default").slice(0, 64);
      const text = String(body.text || "").slice(0, 1000); // a DM, not an essay
      const args = [sessionId, text, body.sharedProductId || null, { nextOrderNo: Number(body.nextOrderNo) || 0 }];
      // If the AI is out of quota, slow or down, answer with the built-in assistant
      // instead of showing the customer an error.
      if (Date.now() < aiPausedUntil) return sendJson(res, 200, offlineTurn(...args));
      try {
        const out = gemini ? await chatTurnGemini(...args) : await chatTurn(...args);
        return sendJson(res, 200, out);
      } catch (err) {
        const quota = err.status === 429 || (Anthropic && err instanceof Anthropic.RateLimitError);
        aiPausedUntil = Date.now() + (quota ? 15 : 2) * 60_000;
        console.error(`AI failed (${err.message.split("\n")[0].slice(0, 120)}); using the built-in assistant for ${quota ? 15 : 2} min`);
        return sendJson(res, 200, offlineTurn(...args));
      }
    }

    // static files from this folder only (no dotfiles, server code or node_modules)
    const rel = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname.endsWith("/") ? url.pathname + "index.html" : url.pathname);
    const file = path.normalize(path.join(here, rel));
    const ext = path.extname(file).toLowerCase();
    if (!file.startsWith(here + path.sep) || rel.includes("/.") || rel.includes("node_modules") || /^\/(src|sql|tests)\//.test(rel) || !TYPES[ext]) {
      res.writeHead(404);
      return res.end("Not found");
    }
    const data = await fs.readFile(file);
    // Videos: answer byte-range requests so the browser can seek.
    const range = ext === ".mp4" && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
    if (range) {
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Math.min(Number(range[2]), data.length - 1) : data.length - 1;
      res.writeHead(206, { "Content-Type": TYPES[ext], "Content-Range": `bytes ${start}-${end}/${data.length}`, "Accept-Ranges": "bytes", "Content-Length": end - start + 1 });
      return res.end(data.subarray(start, end + 1));
    }
    res.writeHead(200, { "Content-Type": TYPES[ext], "Cache-Control": "no-store", ...(ext === ".mp4" ? { "Accept-Ranges": "bytes" } : {}) });
    res.end(data);
  } catch (err) {
    if (err.code === "ENOENT" || err.code === "EISDIR") {
      res.writeHead(404);
      return res.end("Not found");
    }
    if (Anthropic && err instanceof Anthropic.AuthenticationError) return sendJson(res, 500, { error: "API key rejected — check ANTHROPIC_API_KEY in .env" });
    if (Anthropic && err instanceof Anthropic.RateLimitError) return sendJson(res, 500, { error: "Rate limited — wait a few seconds and try again" });
    if (Anthropic && err instanceof Anthropic.APIError) return sendJson(res, 500, { error: `Claude API error ${err.status}: ${err.message}` });
    console.error(err);
    return sendJson(res, 500, { error: err.message });
  }
});

server.on("error", (err) => {
  if (err.code !== "EADDRINUSE") throw err;
  console.error(`\nPort ${PORT} is already in use: another Shopkeep server (or another app) is still running.`);
  console.error("Stop it (close its terminal, or end the old node.exe in Task Manager), or start this one on another port:");
  console.error(process.platform === "win32" ? `  $env:PORT=${PORT + 1}; npm start\n` : `  PORT=${PORT + 1} npm start\n`);
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`Shopkeep → http://localhost:${PORT}  (owner app: http://localhost:${PORT}/app/)`);
  console.log(gemini ? `Live AI: ON (Gemini · ${gemini.model})` : client ? `Live AI: ON (Claude · ${MODEL})` : `Live AI: off — ${liveProblem}`);
});
