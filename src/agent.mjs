// The sales assistant for one shop: builds its prompt from the shop's own settings and
// catalog, and runs the tools (orders, leads, hand-offs) against the database.

import "../validate.js"; // phone + address checks (globalThis.AW33Validate)
import * as repo from "./repo.mjs";

const V = globalThis.AW33Validate;
const code = (p) => p.id.slice(0, 8); // short product id for the model

// Postgres stores sizes as a JSON object and doesn't keep key order, so sort them:
// XS, S, M, L, XL, XXL, 3XL…, then numbers (UK 7, UK 8…), then anything else.
const SIZE_RANK = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "2XL", "XXXL", "3XL", "4XL", "5XL"];
export function sortSizes(sizes) {
  const rank = (k) => {
    const i = SIZE_RANK.indexOf(String(k).toUpperCase().replace(/\s/g, ""));
    if (i >= 0) return [0, i];
    const n = parseFloat(String(k).replace(/[^\d.]/g, ""));
    return Number.isFinite(n) ? [1, n] : [2, 0];
  };
  return Object.fromEntries(Object.entries(sizes || {}).sort(([a], [b]) => {
    const [ga, ra] = rank(a), [gb, rb] = rank(b);
    return ga - gb || ra - rb || String(a).localeCompare(String(b));
  }));
}

export const TOOLS = [
  {
    name: "save_order",
    description:
      "Book an order once the customer has chosen product, size and version (if the product has several prices) and given name, phone, full address with pincode and payment method. Checks the phone number, address and stock; if it returns an error, ask the customer to fix just that one thing.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        product_id: { type: "string", description: "The product's id from the catalog" },
        version: { type: "string", description: "Key from the product's prices, e.g. 'standard' or 'player'" },
        size: { type: "string", description: "Exactly as in the product's stock, e.g. 'M' or 'UK 9'; empty string if the product has no sizes" },
        quantity: { type: "integer" },
        personalization: { type: "string", description: "Name / number / text to print, only if the product offers it; else empty string" },
        customer_name: { type: "string" },
        phone: { type: "string" },
        address: { type: "string", description: "Door number, street, area, city" },
        pincode: { type: "string" },
        payment: { type: "string", enum: ["UPI", "COD"] },
      },
      required: ["product_id", "version", "size", "quantity", "personalization", "customer_name", "phone", "address", "pincode", "payment"],
      additionalProperties: false,
    },
  },
  {
    name: "find_orders",
    description: "Look up this customer's orders (status, total, tracking) when they ask about an order they placed.",
    strict: true,
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    name: "save_lead",
    description: "Save a bulk / custom / wholesale enquiry for the team to follow up, after collecting the details the shop asks for.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "One line, e.g. '25 football jerseys with club logo'" },
        quantity: { type: "integer" },
        details: { type: "string", description: "Everything else the customer said: design, sizes, names, budget…" },
        deadline: { type: "string" },
        contact_name: { type: "string" },
        phone: { type: "string", description: "If given, else empty string" },
      },
      required: ["summary", "quantity", "details", "deadline", "contact_name", "phone"],
      additionalProperties: false,
    },
  },
  {
    name: "handoff_to_human",
    description: "Flag this conversation for the shop team: complaints, damaged or wrong items, refunds, bargaining beyond listed offers, or anything you can't answer from the shop info.",
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

export function buildSystem(shop, products, { paymentLinks = false } = {}) {
  const s = { ...repo.defaultSettings(), ...shop.settings };
  const methods = [s.payments.upi && "UPI", s.payments.cod && "COD"].filter(Boolean);
  const catalog = products.map((p) => ({
    id: code(p),
    name: p.name,
    category: p.category || undefined,
    description: p.description || undefined,
    prices: p.prices,
    stockBySize: Object.keys(p.sizes || {}).length ? sortSizes(p.sizes) : undefined,
    personalizationPrice: p.personalization_price ?? undefined,
  }));
  const line = (label, v) => (v ? `- ${label}: ${v}\n` : "");
  const upiStep = paymentLinks
    ? "UPI: the order waits for payment. A Pay button with a secure payment link is sent right after your message automatically. Tell them to pay with it and that the order confirms itself as soon as the payment goes through. Never write a link yourself."
    : s.upi_id
      ? "UPI: the order waits for payment. The shop's UPI ID is sent right after your message automatically. Ask them to pay and send a screenshot here; the team confirms once they see it."
      : "UPI: the order waits for payment; tell them the team will send payment details shortly.";

  return `You are the Instagram DM sales assistant for ${shop.name}${s.handle ? ` (@${s.handle.replace(/^@/, "")})` : ""}${s.location ? `, ${s.location}` : ""}. You reply to customers at any hour, including when the shop team is offline (team hours: ${s.staff_hours}).
${s.about ? `\nAbout the shop: ${s.about}\n` : ""}
How to write
- Write the way a friendly shop staff member replies on Instagram: short, plain, warm. Send 1–3 short messages, separated by a blank line. Each message is 1–4 short lines.
- Plain text only: no markdown, no bold, no headings, no bullet symbols. A list of products is one per line, like "Ferrari jersey – ₹899".
- At most one emoji per message, and most messages have none. No filler like "Great choice!", "Absolutely!" or "I'd be happy to help".
- Mirror the customer's language. If they mix languages in English letters (Tanglish, Hinglish…), reply in the same light, natural mix; otherwise simple English. If they call you "anna", "bhai" or "bro", use it back now and then.
- Answer first, then ask the ONE next thing that moves toward a sale (product, then size, then version, then "Shall I book it?").
- Never claim to be a person. If asked whether this is a bot, say it's ${shop.name}'s auto reply and a person from the team is available during team hours.

Facts
- Use only the products, prices, stock and shop info below. Never invent products, prices, discounts, stock or delivery promises. If something isn't covered, say you'll check with the team and call handoff_to_human.
- stockBySize is units left; 0 means sold out. Say "only N left" when N ≤ 2. Products without stockBySize have no sizes.
- Customers often share one of the shop's posts and ask "Price?". The shared product is given in square brackets at the start of their message. If a shared post isn't recognised, ask which product they mean.
- Messages starting with "(Reply from the shop team)" were written by a person from the shop; stay consistent with them.

Shop info
${line("Address", s.address)}${line("Phone", s.phone)}${line("Delivery time", s.delivery_time)}${line("Delivery fee", s.delivery_fee ? `₹${s.delivery_fee}${s.free_delivery_above ? `, free above ₹${s.free_delivery_above}` : ""}` : "free")}${line("Payment methods", methods.join(", "))}${s.payments.cod ? line("COD fee", s.cod_fee ? `₹${s.cod_fee}` : "none") : ""}${line("Returns / exchange", s.returns_policy)}${line("Current offers", s.offers)}${s.faq ? `- More answers from the shop:\n${s.faq}\n` : ""}
Taking an order
- When the product, size and version are settled and the customer wants it, ask for name, phone number and full address with pincode, then ${methods.join(" or ")}.
- Then call save_order. If it returns an error, ask the customer to fix just that one thing and call it again.
- ${upiStep}
${s.payments.cod ? "- COD: the order goes to the team for a quick check; tell them the team will confirm it soon.\n" : ""}- After an order is booked, share the order number and total.
- If they ask about an order they placed, call find_orders.
${s.bulk_orders ? `\nBulk / custom orders\n- ${s.bulk_orders}\n- Collect the details one question at a time, then call save_lead and tell them the team will get back to them.\n` : ""}
Hand to a person
- Complaints, wrong or damaged items, refunds, bargaining beyond listed offers, or anything you can't answer: apologise briefly if needed, call handoff_to_human, and tell them the team will reply during team hours.

Catalog (JSON)
${JSON.stringify(catalog)}`;
}

// Runs one assistant turn. Returns { texts, events, refused }.
// events: { type: "order", order } | { type: "lead", lead } | { type: "handoff", summary }
export async function runAgent({ ai, db, shop, products, conversation, messages, paymentLinks }) {
  const events = [];
  const s = { ...repo.defaultSettings(), ...shop.settings };
  const byCode = new Map(products.map((p) => [code(p), p]));

  async function runTool(name, input) {
    try {
      if (name === "save_order") return await saveOrder(input);
      if (name === "find_orders") {
        const rows = await repo.ordersForConversation(db, shop.id, conversation.id);
        if (!rows.length) return { orders: [], note: "No orders from this chat. Ask for the order number and hand off if needed." };
        return { orders: rows.map((o) => ({ number: o.number, product: o.product_name, size: o.size, total: o.total, payment: o.payment, status: o.status, tracking: o.tracking || undefined, placed: o.created_at })) };
      }
      if (name === "save_lead") {
        const lead = await repo.addLead(db, shop.id, conversation.id, input);
        await repo.addAlert(db, shop.id, { kind: "lead", title: `New enquiry: ${input.summary}`, body: `${input.contact_name}${input.phone ? ", " + input.phone : ""} · by ${input.deadline}`, conversationId: conversation.id });
        events.push({ type: "lead", lead });
        return { saved: true };
      }
      if (name === "handoff_to_human") {
        await repo.setConversation(db, conversation.id, { needs_human: true });
        await repo.addAlert(db, shop.id, { kind: "handoff", title: `${input.priority === "urgent" ? "Urgent: " : ""}${input.summary}`, conversationId: conversation.id });
        events.push({ type: "handoff", summary: input.summary });
        return { flagged: true, team_hours: s.staff_hours };
      }
      return { error: "Unknown tool" };
    } catch (err) {
      console.error(`Tool ${name} failed:`, err);
      return { error: "Something went wrong saving this. Tell the customer the team will follow up, and call handoff_to_human." };
    }
  }

  async function saveOrder(i) {
    const p = byCode.get(String(i.product_id).slice(0, 8));
    if (!p) return { error: "Unknown product_id. Use an id from the catalog." };
    const versions = Object.keys(p.prices);
    const version = versions.length === 1 ? versions[0] : String(i.version || "").toLowerCase();
    if (!(version in p.prices)) return { error: `Ask which version: ${versions.join(", ")}` };
    const qty = Math.max(1, Math.min(50, Number(i.quantity) || 1));
    const sizes = p.sizes || {};
    let size = null;
    if (Object.keys(sizes).length) {
      size = Object.keys(sizes).find((k) => k.toLowerCase() === String(i.size || "").trim().toLowerCase());
      if (!size) return { error: `Size not available. Sizes: ${Object.keys(sortSizes(sizes)).join(", ")}` };
      if (sizes[size] < qty) return { error: sizes[size] === 0 ? `${size} is sold out` : `Only ${sizes[size]} left in ${size}` };
    }
    const method = i.payment === "COD" ? "COD" : "UPI";
    if (!s.payments[method.toLowerCase()]) return { error: `${method} is not offered. Payment methods: ${[s.payments.upi && "UPI", s.payments.cod && "COD"].filter(Boolean).join(", ")}` };
    const ph = V.checkPhone(i.phone);
    if (!ph.ok) return { error: `Phone number ${ph.reason}. Ask for a 10 digit mobile number starting with 6, 7, 8 or 9.` };
    const check = V.checkAddress(`${i.address}, ${i.pincode}`, { phone: ph.phone, name: i.customer_name });
    if (!check.pinOk) return { error: "Pincode missing or not valid. Ask for the 6 digit pincode." };
    if (check.cityMatch === false) return { error: `Pincode ${check.pincode} is in ${check.area || check.state}, but the address says ${check.city}. Ask which is correct.` };
    if (!check.hasDoor) return { error: "Address has no door / house number. Ask for it." };

    const personal = String(i.personalization || "").trim();
    if (personal && p.personalization_price == null) return { error: "This product can't be personalised. Book it without the text, or ask the customer." };
    const unit = p.prices[version] + (personal ? p.personalization_price : 0);
    const itemTotal = unit * qty;
    const deliveryFee = s.free_delivery_above && itemTotal >= s.free_delivery_above ? 0 : Number(s.delivery_fee) || 0;
    const codFee = method === "COD" ? Number(s.cod_fee) || 0 : 0;
    const order = await repo.createOrder(db, shop.id, {
      conversationId: conversation.id,
      productId: p.id,
      productName: p.name,
      version: versions.length > 1 ? version : null,
      size,
      quantity: qty,
      personalization: personal || null,
      itemTotal,
      deliveryFee,
      codFee,
      total: itemTotal + deliveryFee + codFee,
      payment: method,
      status: method === "UPI" ? "awaiting_payment" : "review",
      customerName: String(i.customer_name).trim(),
      phone: ph.phone,
      address: String(i.address).trim(),
      pincode: check.pincode,
      checks: check,
      historyText: conversation.channel === "test" ? "Placed in the test chat" : "Placed on Instagram",
    });
    await repo.addAlert(db, shop.id, {
      kind: method === "COD" ? "cod_review" : "order",
      title: method === "COD" ? `COD order ${order.number} needs review` : `New order ${order.number}, waiting for UPI payment`,
      body: `${p.name}${size ? ` (${size})` : ""} × ${qty} · ₹${order.total} · ${order.customer_name}`,
      conversationId: conversation.id,
      orderId: order.id,
    });
    events.push({ type: "order", order });
    return {
      order_number: order.number,
      item_total: itemTotal,
      delivery_fee: deliveryFee,
      cod_fee: codFee,
      total: order.total,
      delivery_time: s.delivery_time,
      status: order.status,
    };
  }

  const res = await ai.run({ system: buildSystem(shop, products, { paymentLinks }), messages, tools: TOOLS, runTool });
  return { ...res, events };
}

// Instagram post / reel links → product, using the post links saved on each product.
export function matchSharedPost(products, url) {
  const key = (u) => (String(u || "").match(/instagram\.com\/(?:[^/]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/) || [])[1];
  const k = key(url);
  if (!k) return null;
  return products.find((p) => (p.post_urls || []).some((u) => key(u) === k)) || null;
}

export { code as productCode };
