// The message pipeline.
//
// Customer DM in → stored → wait a few seconds (customers often send 2–3 messages in a
// row) → the assistant answers the whole burst → replies sent and stored → payment
// link sent for UPI orders.
//
// A person from the shop replying (in the Instagram app or from the dashboard) pauses
// the assistant in that chat for a while, so it never talks over them.

import * as repo from "./repo.mjs";
import { runAgent, matchSharedPost } from "./agent.mjs";

const HOLDING_TEXT = "Thanks for your message! Our team will get back to you soon 🙏";
const WINDOW_MS = 24 * 3600 * 1000; // Instagram: replies only within 24 h of the customer's last message

export function makeInbox({ db, ai, ig, rzp, crypto, bus, log = console, debounceOverrideMs }) {
  const timers = new Map(); // conversation id → { timer, waiters }
  const locks = new Map(); // conversation id → promise chain
  let aiPausedUntil = 0;

  const settingsOf = (shop) => ({ ...repo.defaultSettings(), ...shop.settings });

  function lock(key, fn) {
    const prev = locks.get(key) || Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => {});
    locks.set(key, tail);
    tail.then(() => locks.get(key) === tail && locks.delete(key));
    return run;
  }

  // ── sending ─────────────────────────────────────────────────
  // Stores the message first (so the dashboard shows it and echoes can be recognised),
  // then sends it on the conversation's channel. Throws if Instagram refuses.
  async function deliver(shop, conv, text, { sender = "bot", button = null } = {}) {
    const row = await repo.addMessage(db, {
      shopId: shop.id,
      conversationId: conv.id,
      direction: "out",
      sender,
      text,
      attachments: button ? [{ type: "button", ...button }] : [],
    });
    if (conv.channel === "instagram") {
      const acct = await repo.getInstagram(db, shop.id);
      if (!acct) throw new Error("Instagram is not connected");
      const a = { token: crypto.decrypt(acct.access_token_enc), igUserId: acct.ig_user_id };
      const ids = button ? await ig.sendButton(a, conv.external_id, text, button.title, button.url) : await ig.sendText(a, conv.external_id, text);
      if (ids[0]) await repo.setMessageExternalId(db, row.id, ids[0]);
    }
    bus.emit(shop.id, "message");
    return row;
  }

  // Sends without throwing; on failure the owner gets an alert instead.
  async function tryDeliver(shop, conv, text, opts) {
    try {
      await deliver(shop, conv, text, opts);
      return true;
    } catch (err) {
      log.error(`Send failed (${conv.id}): ${err.message}`);
      await repo.setConversation(db, conv.id, { needs_human: true });
      await repo.addAlert(db, shop.id, { kind: "system", title: "A reply couldn't be sent on Instagram", body: err.message.slice(0, 300), conversationId: conv.id });
      bus.emit(shop.id, "alert");
      return false;
    }
  }

  // ── incoming ────────────────────────────────────────────────
  // Returns a promise that settles after the assistant has answered (or decided not to).
  async function receive({ shop, channel, externalId, text, attachments = [], mid = null, delayMs }) {
    const conv = await repo.upsertConversation(db, shop.id, channel, externalId);
    const row = await repo.addMessage(db, { shopId: shop.id, conversationId: conv.id, direction: "in", sender: "customer", text, attachments, externalId: mid });
    if (!row) return null; // Instagram retried a message we already have
    if (channel === "instagram" && !conv.customer_name && !conv.username) fillProfile(shop, conv).catch(() => {});
    bus.emit(shop.id, "message");
    const s = settingsOf(shop);
    const delay = delayMs ?? debounceOverrideMs ?? Math.max(0, Number(s.debounce_seconds) || 0) * 1000;
    return schedule(shop.id, conv.id, delay);
  }

  async function fillProfile(shop, conv) {
    const acct = await repo.getInstagram(db, shop.id);
    if (!acct) return;
    const p = await ig.profile({ token: crypto.decrypt(acct.access_token_enc), igUserId: acct.ig_user_id }, conv.external_id);
    if (p.name || p.username) {
      await repo.setConversation(db, conv.id, { customer_name: p.name || "", username: p.username || "" });
      bus.emit(shop.id, "conversation");
    }
  }

  function schedule(shopId, convId, delayMs) {
    return new Promise((resolve) => {
      const cur = timers.get(convId) || { waiters: [] };
      clearTimeout(cur.timer);
      cur.waiters.push(resolve);
      cur.timer = setTimeout(() => {
        timers.delete(convId);
        lock(convId, () => respond(shopId, convId))
          .catch((err) => log.error("Reply failed:", err))
          .then((r) => cur.waiters.forEach((w) => w(r ?? null)));
      }, delayMs);
      timers.set(convId, cur);
    });
  }

  // A message the shop's own account sent (Instagram "echo"): either one of ours coming
  // back, or a person replying from the Instagram app → pause the assistant there.
  async function receiveEcho({ shop, customerId, text, mid }) {
    if (!text) return; // buttons, stickers, photos: nothing to compare, nothing to do
    const conv = await repo.upsertConversation(db, shop.id, "instagram", customerId);
    if (mid && (await db.one("select 1 from messages where external_id = $1", [mid]))) return;
    const ours = await db.one(
      `select id from messages where conversation_id = $1 and direction = 'out' and created_at > now() - interval '3 minutes'
         and (text = $2 or position($2 in text) > 0) order by id desc limit 1`,
      [conv.id, text],
    );
    if (ours) return;
    await repo.addMessage(db, { shopId: shop.id, conversationId: conv.id, direction: "out", sender: "staff", text, externalId: mid });
    await pauseBot(shop, conv);
    bus.emit(shop.id, "message");
  }

  async function pauseBot(shop, conv) {
    const hours = Number(settingsOf(shop).human_pause_hours) || 0;
    await repo.setConversation(db, conv.id, {
      bot_paused_until: hours ? new Date(Date.now() + hours * 3600 * 1000) : null,
      needs_human: false,
      unread: 0,
    });
  }

  // ── the assistant's turn ────────────────────────────────────
  async function respond(shopId, convId) {
    const shop = await repo.getShop(db, shopId);
    const conv = await repo.getConversation(db, shopId, convId);
    if (!shop || !conv) return null;
    const isTest = conv.channel === "test";
    if (!isTest) {
      if (!shop.bot_enabled) {
        log.log(`No reply in ${convId}: the assistant is switched off for this shop`);
        return null;
      }
      if (conv.bot_paused_until && new Date(conv.bot_paused_until) > new Date()) return null;
      if (conv.last_customer_message_at && Date.now() - new Date(conv.last_customer_message_at) > WINDOW_MS) return null;
    }
    const products = await repo.listProducts(db, shopId, { activeOnly: true });
    const history = await repo.recentMessages(db, convId, 40);
    const messages = toTurns(history, products);
    if (!messages.length || messages[messages.length - 1].role !== "user") return null;

    if (!ai || Date.now() < aiPausedUntil) return holdingReply(shop, conv, "The assistant is offline (no AI key, or over quota)");
    const pay = await repo.getPaymentAccount(db, shopId);
    let result;
    try {
      result = await runAgent({ ai, db, shop, products, conversation: conv, messages, paymentLinks: !!pay });
    } catch (err) {
      const quota = ai.isQuotaError && ai.isQuotaError(err);
      aiPausedUntil = Date.now() + (quota ? 15 : 1) * 60_000;
      log.error(`AI failed (${String(err.message).split("\n")[0].slice(0, 160)})`);
      return holdingReply(shop, conv, quota ? "The AI is over its quota" : "The AI didn't answer");
    }
    if (result.refused) return holdingReply(shop, conv, "The assistant couldn't answer this one");

    for (const text of toBubbles(result.texts)) if (!(await tryDeliver(shop, conv, text))) break;
    for (const ev of result.events) if (ev.type === "order" && ev.order.payment === "UPI") await sendPayment(shop, conv, ev.order, pay);
    if (result.events.length) bus.emit(shopId, "order");
    return result;
  }

  async function holdingReply(shop, conv, reason) {
    await repo.setConversation(db, conv.id, { needs_human: true });
    await repo.addAlert(db, shop.id, { kind: "handoff", title: "Customer waiting for a reply", body: reason, conversationId: conv.id });
    bus.emit(shop.id, "alert");
    const recent = conv.holding_reply_at && Date.now() - new Date(conv.holding_reply_at) < 6 * 3600 * 1000;
    if (recent) return null;
    await repo.setConversation(db, conv.id, { holding_reply_at: new Date() });
    await tryDeliver(shop, conv, settingsOf(shop).holding_message || HOLDING_TEXT);
    return null;
  }

  // ── payments ────────────────────────────────────────────────
  async function sendPayment(shop, conv, order, pay) {
    const s = settingsOf(shop);
    if (pay) {
      try {
        const link = await rzp.createLink(
          { keyId: pay.key_id, keySecret: crypto.decrypt(pay.key_secret_enc) },
          { amount: order.total, orderNumber: order.number, description: `${shop.name} order ${order.number}: ${order.product_name}`, customerName: order.customer_name, phone: order.phone, notes: { order_id: order.id, shop_id: shop.id } },
        );
        await db.query("update orders set payment_link_id = $2, payment_link_url = $3 where id = $1", [order.id, link.id, link.url]);
        await tryDeliver(shop, conv, `Order ${order.number} · ₹${order.total}\nTap below to pay with UPI. Your order confirms as soon as the payment goes through.`, {
          button: { title: `Pay ₹${order.total}`, url: link.url },
        });
        return;
      } catch (err) {
        log.error(`Payment link failed: ${err.message}`);
        await repo.addAlert(db, shop.id, { kind: "system", title: `Couldn't create a payment link for ${order.number}`, body: err.message.slice(0, 300), conversationId: conv.id, orderId: order.id });
      }
    }
    if (s.upi_id) await tryDeliver(shop, conv, `Order ${order.number} · ₹${order.total}\nPay to UPI ID: ${s.upi_id}\nSend the payment screenshot here and we'll confirm your order.`);
  }

  // Razorpay said a link was paid.
  async function paymentReceived(shop, { linkId, paymentId }) {
    const order = await repo.findOrderByLink(db, shop.id, linkId);
    if (!order) return { ok: false, reason: "unknown link" };
    const done = await repo.moveOrder(db, shop.id, order.id, { to: "paid", from: ["awaiting_payment"], note: `Paid online (${paymentId || "Razorpay"})`, extra: { payment_id: paymentId, paid_at: new Date() } });
    if (!done) {
      if (order.status === "cancelled")
        await repo.addAlert(db, shop.id, { kind: "system", title: `Payment received for cancelled order ${order.number}`, body: "Refund it or restore the order.", orderId: order.id, conversationId: order.conversation_id });
      return { ok: true, already: true };
    }
    await repo.addAlert(db, shop.id, { kind: "paid", title: `Paid: ${order.number} · ₹${order.total}`, body: `${order.product_name} · ${order.customer_name}`, orderId: order.id, conversationId: order.conversation_id });
    const conv = order.conversation_id && (await repo.getConversation(db, shop.id, order.conversation_id));
    if (conv) await tryDeliver(shop, conv, `Payment received ✅\nYour order ${order.number} is confirmed. Delivery: ${settingsOf(shop).delivery_time}.`);
    bus.emit(shop.id, "order");
    return { ok: true };
  }

  // Status change from the dashboard; tells the customer.
  const STATUS_FLOW = {
    confirmed: { from: ["review", "awaiting_payment"], note: "Confirmed by the team", dm: (o) => `Your order ${o.number} is confirmed ✅ We'll ship it soon.` },
    paid: { from: ["awaiting_payment"], note: "Payment checked by the team", dm: (o) => `Payment received ✅ Your order ${o.number} is confirmed.` },
    shipped: { from: ["paid", "confirmed"], note: "Shipped", dm: (o) => `Your order ${o.number} is on the way 🚚${o.tracking ? `\nTracking: ${o.tracking}` : ""}` },
    delivered: { from: ["shipped"], note: "Delivered", dm: null },
    cancelled: { from: ["awaiting_payment", "review", "paid", "confirmed"], note: "Cancelled", dm: (o) => `Your order ${o.number} has been cancelled. Reply here if you have any questions.` },
  };
  async function changeOrderStatus(shop, orderId, to, { note, tracking, notify = true } = {}) {
    const flow = STATUS_FLOW[to];
    if (!flow) throw Object.assign(new Error("Unknown status"), { status: 400 });
    const extra = tracking ? { tracking } : {};
    if (to === "paid") extra.paid_at = new Date();
    const order = await repo.moveOrder(db, shop.id, orderId, { to, from: flow.from, note: note || flow.note, extra });
    if (!order) throw Object.assign(new Error("This order can't move to that status from where it is"), { status: 409 });
    let told = false;
    if (notify && flow.dm && order.conversation_id) {
      const conv = await repo.getConversation(db, shop.id, order.conversation_id);
      if (conv) told = await tryDeliver(shop, conv, flow.dm(order), { sender: "staff" });
    }
    bus.emit(shop.id, "order");
    return { order, told };
  }

  // Every few minutes: one reminder for unpaid UPI orders, cancel after 24 h.
  async function sweepUnpaid() {
    for (const o of await repo.unpaidOrders(db)) {
      const shop = await repo.getShop(db, o.shop_id);
      const age = Date.now() - new Date(o.created_at);
      if (age > 24 * 3600 * 1000) {
        await repo.moveOrder(db, shop.id, o.id, { to: "cancelled", from: ["awaiting_payment"], note: "Not paid within 24 hours" });
        bus.emit(shop.id, "order");
      } else if (!o.reminded_at && o.payment_link_url && o.conversation_id) {
        await repo.markReminded(db, o.id);
        const conv = await repo.getConversation(db, shop.id, o.conversation_id);
        if (conv) await tryDeliver(shop, conv, `Your order ${o.number} is waiting for payment. It's held for you for 24 hours.`, { button: { title: `Pay ₹${o.total}`, url: o.payment_link_url } });
      }
    }
  }

  return { receive, receiveEcho, deliver, pauseBot, respond, paymentReceived, changeOrderStatus, sweepUnpaid, idle: () => Promise.all([...locks.values()]) };
}

// Stored messages → alternating user / assistant turns for the model.
export function toTurns(history, products) {
  const turns = [];
  for (const m of history) {
    let text = m.text || "";
    if (m.sender === "customer") {
      const notes = (m.attachments || []).map((a) => {
        if (["share", "ig_post", "ig_reel", "reel", "story_mention"].includes(a.type)) {
          const p = matchSharedPost(products, a.url);
          return p ? `[Customer shared your post: "${p.name}" (product_id ${p.id.slice(0, 8)})]` : `[Customer shared a post or reel we couldn't match to a product${a.title ? `: "${a.title}"` : ""}]`;
        }
        if (a.type === "image") return "[Customer sent a photo]";
        if (a.type === "audio") return "[Customer sent a voice message]";
        if (a.type === "video") return "[Customer sent a video]";
        return `[Customer sent a ${a.type}]`;
      });
      text = [...notes, text].filter(Boolean).join("\n");
    } else if (m.sender === "staff") text = `(Reply from the shop team) ${text}`;
    if (!text) continue;
    const role = m.sender === "customer" ? "user" : "assistant";
    const last = turns[turns.length - 1];
    if (last && last.role === role) last.content += "\n\n" + text;
    else turns.push({ role, content: text });
  }
  while (turns.length && turns[0].role !== "user") turns.shift();
  return turns;
}

// One chat bubble per paragraph, like separate DMs; never split mid-sentence.
export function toBubbles(texts) {
  const out = [];
  for (const t of texts)
    for (const part of String(t).split(/\n\s*\n/)) {
      const clean = part.replace(/\*\*(.+?)\*\*/g, "$1").trim();
      if (!clean) continue;
      const prev = out[out.length - 1];
      if (prev && !/[.!?…:)\]"”]$|\p{Extended_Pictographic}$/u.test(prev)) out[out.length - 1] = prev + " " + clean;
      else out.push(clean);
    }
  return out;
}
