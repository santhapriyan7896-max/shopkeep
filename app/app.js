// Shopkeep owner app. Plain JS, no build step.
// Screens: Home, Inbox, Orders, Products, Enquiries, Test chat, Settings (hash routes).
// Everything a customer typed is escaped before it touches the page.

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const rupees = (n) => "₹" + Number(n || 0).toLocaleString("en-IN");
const view = $("#view");

// Postgres stores sizes as a JSON object and doesn't keep key order, so sort them:
// XS, S, M, L, XL, XXL, 3XL…, then numbers (UK 7, UK 8…), then anything else.
const SIZE_RANK = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "2XL", "XXXL", "3XL", "4XL", "5XL"];
function sortSizes(sizes) {
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

const state = { me: null, config: null, route: "home", param: null, orderFilter: "open", inboxFilter: "all", openOrder: null };

// ── API ───────────────────────────────────────────────────────
async function api(path, { method = "GET", body } = {}) {
  const r = await fetch("/api/v1" + path, {
    method,
    headers: body !== undefined || method !== "GET" ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : method !== "GET" ? "{}" : undefined,
    credentials: "same-origin",
  });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && !path.startsWith("/auth/")) {
    showAuth();
    throw new Error("Please sign in");
  }
  if (!r.ok) throw new Error(data.error || `Error ${r.status}`);
  return data;
}

function toast(text, err = false) {
  const t = $("#toast");
  t.textContent = text;
  t.className = "toast" + (err ? " err" : "");
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 3200);
}
const guard = (fn) => async (...a) => {
  try {
    await fn(...a);
  } catch (e) {
    if (e.message !== "Please sign in") toast(e.message, true);
  }
};

function ago(d) {
  const s = (Date.now() - new Date(d)) / 1000;
  if (s < 60) return "now";
  if (s < 3600) return Math.floor(s / 60) + "m";
  if (s < 86400) return Math.floor(s / 3600) + "h";
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
const when = (d) => new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

// ── auth ──────────────────────────────────────────────────────
let signup = false;
function showAuth() {
  $("#shell").hidden = true;
  $("#auth").hidden = false;
  setAuthMode(signup);
}
function setAuthMode(isSignup) {
  signup = isSignup;
  $("#auth-title").textContent = isSignup ? "Create your shop" : "Sign in";
  $("#auth-submit").textContent = isSignup ? "Create account" : "Sign in";
  $("#auth-switch-text").textContent = isSignup ? "Already have an account?" : "New to Shopkeep?";
  $("#auth-switch").textContent = isSignup ? "Sign in" : "Create an account";
  $$("[data-signup]").forEach((el) => (el.hidden = !isSignup || (el.hasAttribute("data-code") && !(state.config && state.config.signup_code_required))));
  $("#auth-form [name=password]").autocomplete = isSignup ? "new-password" : "current-password";
  $("#auth-error").textContent = "";
}
$("#auth-switch").onclick = (e) => {
  e.preventDefault();
  setAuthMode(!signup);
};
$("#auth-form").onsubmit = async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  $("#auth-submit").disabled = true;
  try {
    await api(signup ? "/auth/signup" : "/auth/login", { method: "POST", body: f });
    e.target.reset();
    await start();
  } catch (err) {
    $("#auth-error").textContent = err.message;
  } finally {
    $("#auth-submit").disabled = false;
  }
};
$("#logout").onclick = guard(async () => {
  await api("/auth/logout", { method: "POST" });
  if (events) events.close();
  state.me = null;
  showAuth();
});

// ── start & routing ───────────────────────────────────────────
async function start() {
  state.config = await fetch("/api/v1/config").then((r) => r.json()).catch(() => ({}));
  try {
    state.me = await api("/me");
  } catch {
    return;
  }
  $("#auth").hidden = true;
  $("#shell").hidden = false;
  paintShell();
  connectLive();
  route();
}

function paintShell() {
  const s = state.me.shop;
  $("#shop-name").textContent = s.name;
  const b = $("#bot-state");
  b.textContent = s.bot_enabled ? "Assistant on" : "Assistant off";
  b.className = s.bot_enabled ? "on" : "";
}

window.addEventListener("hashchange", route);
function route() {
  if (!state.me) return;
  const [name, param] = (location.hash.slice(1) || "home").split(/[/?]/);
  state.route = SCREENS[name] ? name : "home";
  state.param = param || null;
  $$(".nav a").forEach((a) => a.classList.toggle("on", a.dataset.view === state.route));
  render();
}
const render = guard(async () => {
  await SCREENS[state.route]();
  refreshBadges();
});

// ── live updates ─────────────────────────────────────────────
let events = null;
let refreshTimer = null;
function connectLive() {
  if (events) events.close();
  events = new EventSource("/api/v1/events");
  events.onopen = () => $("#live").classList.add("on");
  events.onerror = () => $("#live").classList.remove("on");
  events.onmessage = (e) => {
    const { kind } = JSON.parse(e.data);
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(async () => {
      if (kind === "settings") {
        state.me = await api("/me");
        paintShell();
      }
      // Don't redraw a form the owner is typing in.
      if (["settings", "products"].includes(state.route) && kind !== "settings") return refreshBadges();
      if (document.activeElement && document.activeElement.closest("#view form, .composer")) return SCREENS[state.route].live ? SCREENS[state.route].live() : refreshBadges();
      render();
    }, 250);
  };
}
async function refreshBadges() {
  const s = await api("/stats").catch(() => null);
  if (!s) return;
  const set = (id, n) => {
    const el = $(id);
    el.hidden = !n;
    el.textContent = n;
  };
  set("#badge-inbox", s.needs_human);
  set("#badge-orders", s.to_review);
  set("#badge-leads", s.new_leads);
}

// ── Home ──────────────────────────────────────────────────────
async function home() {
  const [stats, { alerts }, { products }] = await Promise.all([api("/stats"), api("/alerts"), api("/products")]);
  const s = state.me.shop;
  const steps = [
    { done: products.length > 0, label: "Add your products and prices", href: "#products" },
    { done: !!(s.settings.delivery_time && (s.settings.address || s.settings.about)), label: "Fill in shop details and policies", href: "#settings" },
    { done: false, label: "Try your assistant in the test chat", href: "#test", optional: true },
    { done: !!s.payments || !!s.settings.upi_id, label: "Set up UPI payments", href: "#settings" },
    { done: s.instagram.connected, label: "Connect your Instagram account", href: "#settings" },
    { done: s.bot_enabled, label: "Turn on the assistant", href: "#settings" },
  ];
  const left = steps.filter((x) => !x.done && !x.optional).length;
  view.innerHTML = `
    <div class="page-head"><h1 class="grow">Good ${greeting()}, ${esc((state.me.user.name || "").split(" ")[0] || "there")}</h1>
      ${state.me.ai ? "" : `<span class="pill needs">No AI key on the server</span>`}</div>
    <div class="stats">
      <a class="stat" href="#orders"><span>Orders today</span><b>${stats.orders_24h}</b></a>
      <a class="stat" href="#orders"><span>Paid today</span><b>${rupees(stats.revenue_24h)}</b></a>
      <a class="stat ${stats.to_review ? "warn" : ""}" href="#orders"><span>COD to review</span><b>${stats.to_review}</b></a>
      <a class="stat ${stats.needs_human ? "warn" : ""}" href="#inbox"><span>Chats needing you</span><b>${stats.needs_human}</b></a>
    </div>
    <div class="two">
      <section class="card pad">
        <h2>${left ? `Get set up · ${left} step${left > 1 ? "s" : ""} left` : "You're all set"}</h2>
        <ol class="steps">${steps.map((x) => `<li class="${x.done ? "done" : ""}"><span class="tick">${x.done ? "✓" : ""}</span><span class="label">${esc(x.label)}</span><a class="btn sm" href="${x.href}">${x.done ? "Edit" : "Open"}</a></li>`).join("")}</ol>
      </section>
      <section class="card pad">
        <div class="row"><h2 class="grow">Activity</h2>${alerts.some((a) => !a.read) ? `<button class="btn sm" id="read-all">Mark all read</button>` : ""}</div>
        ${alerts.length ? `<ul class="alerts">${alerts.slice(0, 12).map(alertItem).join("")}</ul>` : `<p class="empty">New orders, payments and chats that need you will show up here.</p>`}
      </section>
    </div>`;
  const ra = $("#read-all");
  if (ra) ra.onclick = guard(async () => (await api("/alerts/read", { method: "POST" }), render()));
}
function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
}
function alertItem(a) {
  const link = a.conversation_id ? `#inbox/${a.conversation_id}` : a.order_id ? "#orders" : null;
  return `<li class="${a.read ? "" : "unread"}"><b>${esc(a.title)}</b>${a.body ? `<span class="sub">${esc(a.body)}</span>` : ""}
    <span class="sub">${ago(a.created_at)}${link ? ` · <a href="${link}">Open</a>` : ""}</span></li>`;
}

// ── Inbox ─────────────────────────────────────────────────────
async function inbox() {
  const { conversations } = await api(`/conversations?filter=${state.inboxFilter}`);
  const list = conversations.filter((c) => c.channel === "instagram");
  const openId = state.param;
  view.innerHTML = `
    <div class="page-head"><h1 class="grow">Inbox</h1>
      ${state.me.shop.instagram.connected ? `<span class="muted small">@${esc(state.me.shop.instagram.username)}</span>` : `<a class="btn sm" href="#settings">Connect Instagram</a>`}</div>
    <div class="card inbox ${openId ? "open" : ""}">
      <div class="conv-list">
        <div class="chips">${[["all", "All"], ["needs_human", "Needs you"], ["unread", "Unread"]].map(([k, l]) => `<button data-f="${k}" class="${state.inboxFilter === k ? "on" : ""}">${l}</button>`).join("")}</div>
        ${list.length ? list.map((c) => `
          <a class="conv ${c.id === openId ? "on" : ""} ${c.unread ? "unread" : ""}" href="#inbox/${c.id}">
            <div class="conv-top"><b>${esc(c.customer_name || (c.username ? "@" + c.username : "Customer"))}</b>${c.needs_human ? `<span class="pill needs">Needs you</span>` : ""}<time>${ago(c.last_message_at)}</time></div>
            <p>${c.last_sender === "customer" ? "" : c.last_sender === "bot" ? "Assistant: " : "You: "}${esc(c.last_text || "")}</p>
          </a>`).join("") : `<p class="empty">${state.me.shop.instagram.connected ? "No chats yet." : "Connect Instagram in Settings to see your DMs here. Until then, try the Test chat."}</p>`}
      </div>
      <div class="thread" id="thread">${openId ? "" : `<p class="empty">Pick a chat</p>`}</div>
    </div>`;
  $$(".conv-list .chips button").forEach((b) => (b.onclick = () => ((state.inboxFilter = b.dataset.f), render())));
  if (openId) await thread(openId);
}
inbox.live = () => state.param && thread(state.param, { keepDraft: true });

async function thread(id, { keepDraft = false } = {}) {
  const box = $("#thread");
  if (!box) return;
  const { conversation: c, messages, orders } = await api(`/conversations/${id}`);
  const draft = keepDraft && $("#reply") ? $("#reply").value : "";
  const paused = c.bot_paused_until && new Date(c.bot_paused_until) > new Date();
  const windowOpen = c.last_customer_message_at && Date.now() - new Date(c.last_customer_message_at) < 24 * 3600 * 1000;
  box.innerHTML = `
    <div class="thread-head">
      <a class="btn sm hide-lg" href="#inbox" style="display:none" id="back">←</a>
      <div class="who"><b>${esc(c.customer_name || "Customer")}</b><span class="sub">${c.username ? "@" + esc(c.username) : "Instagram"}</span></div>
      ${orders.map((o) => `<a class="pill ${o.status}" href="#orders" title="${esc(o.product_name)}">${esc(o.number)}</a>`).join(" ")}
      ${c.needs_human ? `<button class="btn sm" id="resolve">Mark handled</button>` : ""}
      <button class="btn sm" id="botbtn">${paused ? "Resume assistant" : "Pause assistant"}</button>
    </div>
    ${paused ? `<div class="banner"><span class="grow">You're handling this chat. The assistant stays quiet until ${when(c.bot_paused_until)}.</span></div>` : ""}
    <div class="bubbles" id="bubbles">${bubbles(messages)}</div>
    ${windowOpen ? `<form class="composer" id="composer"><textarea id="reply" placeholder="Reply as the shop…" rows="1"></textarea><button class="btn primary">Send</button></form>`
      : `<div class="banner"><span class="grow">Instagram only allows replies within 24 hours of the customer's last message. Reply from the Instagram app if needed.</span></div>`}`;
  if (matchMedia("(max-width: 900px)").matches) $("#back").style.display = "";
  const bb = $("#bubbles");
  bb.scrollTop = bb.scrollHeight;
  $("#botbtn").onclick = guard(async () => (await api(`/conversations/${id}/bot`, { method: "POST", body: { paused: !paused } }), thread(id)));
  if ($("#resolve")) $("#resolve").onclick = guard(async () => (await api(`/conversations/${id}/resolve`, { method: "POST" }), render()));
  const form = $("#composer");
  if (form) {
    const ta = $("#reply");
    ta.value = draft;
    ta.onkeydown = (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        form.requestSubmit();
      }
    };
    form.onsubmit = guard(async (e) => {
      e.preventDefault();
      const text = ta.value.trim();
      if (!text) return;
      ta.disabled = true;
      try {
        await api(`/conversations/${id}/reply`, { method: "POST", body: { text } });
        ta.value = "";
        await thread(id);
      } finally {
        ta.disabled = false;
      }
    });
  }
}

function bubbles(messages) {
  let lastDay = "";
  return messages.map((m) => {
    const day = new Date(m.created_at).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
    const sep = day !== lastDay ? `<div class="day">${day}</div>` : "";
    lastDay = day;
    const atts = (m.attachments || []).map((a) =>
      a.type === "button" ? `<a class="paybtn" href="${esc(safeUrl(a.url))}" target="_blank" rel="noopener">${esc(a.title)}</a>`
        : `<span class="att">${a.type === "share" || a.type === "ig_post" || a.type === "ig_reel" ? "Shared a post" : "Sent a " + esc(a.type)}${a.url ? ` · <a href="${esc(safeUrl(a.url))}" target="_blank" rel="noopener">open</a>` : ""}</span>`).join("");
    const who = m.sender === "bot" ? "Assistant" : m.sender === "staff" ? "Team" : "";
    return `${sep}<div class="b ${m.sender}">${atts && m.sender === "customer" ? atts : ""}${esc(m.text)}${atts && m.sender !== "customer" ? atts : ""}<span class="meta">${who ? who + " · " : ""}${new Date(m.created_at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}</span></div>`;
  }).join("");
}
const safeUrl = (u) => (/^https?:\/\//i.test(String(u || "")) ? u : "#");

// ── Orders ────────────────────────────────────────────────────
const STATUS = { awaiting_payment: "Waiting for payment", review: "COD · review", paid: "Paid", confirmed: "Confirmed", shipped: "Shipped", delivered: "Delivered", cancelled: "Cancelled" };
async function orders() {
  const f = state.orderFilter;
  const { orders } = await api(`/orders${f === "all" ? "" : `?status=${f}`}`);
  view.innerHTML = `
    <div class="page-head"><h1 class="grow">Orders</h1>
      <div class="chips">${[["open", "Open"], ["review", "COD review"], ["awaiting_payment", "Unpaid"], ["paid", "Paid"], ["confirmed", "Confirmed"], ["shipped", "Shipped"], ["all", "All"]].map(([k, l]) => `<button data-f="${k}" class="${f === k ? "on" : ""}">${l}</button>`).join("")}</div></div>
    <div class="card">${orders.length ? `<table class="table"><thead><tr><th>Order</th><th>Customer</th><th class="hide-sm">Item</th><th>Status</th><th class="num">Total</th></tr></thead>
      <tbody>${orders.map((o) => `
        <tr class="click" data-id="${o.id}"><td><b>${esc(o.number)}</b><span class="sub">${ago(o.created_at)}</span></td>
          <td>${esc(o.customer_name)}<span class="sub">${esc(o.phone)}</span></td>
          <td class="hide-sm">${esc(o.product_name)}<span class="sub">${[o.version, o.size, o.quantity > 1 ? "× " + o.quantity : ""].filter(Boolean).map(esc).join(" · ")}</span></td>
          <td><span class="pill ${o.status}">${STATUS[o.status]}</span><span class="sub">${o.payment}</span></td>
          <td class="num"><b>${rupees(o.total)}</b></td></tr>
        ${state.openOrder === o.id ? orderDetail(o) : ""}`).join("")}</tbody></table>` : `<p class="empty">No orders here yet.</p>`}</div>`;
  $$(".page-head .chips button").forEach((b) => (b.onclick = () => ((state.orderFilter = b.dataset.f), render())));
  $$("tr.click").forEach((tr) => (tr.onclick = () => ((state.openOrder = state.openOrder === tr.dataset.id ? null : tr.dataset.id), render())));
  $$("[data-act]").forEach((b) => (b.onclick = guard(() => orderAction(b.dataset.order, b.dataset.act))));
  $$("[data-pin]").forEach((b) => (b.onclick = guard(() => verifyPin(b))));
}
function orderDetail(o) {
  const flags = (o.checks && o.checks.flags) || [];
  const acts = {
    review: [["confirmed", "Confirm order", "primary"], ["cancelled", "Cancel", "danger"]],
    awaiting_payment: [["paid", "Mark as paid"], ["cancelled", "Cancel", "danger"]],
    paid: [["shipped", "Mark shipped", "primary"], ["cancelled", "Cancel", "danger"]],
    confirmed: [["shipped", "Mark shipped", "primary"], ["cancelled", "Cancel", "danger"]],
    shipped: [["delivered", "Mark delivered"]],
  }[o.status] || [];
  return `<tr class="detail"><td colspan="5"><div class="detail-grid">
    <div><h3>Deliver to</h3>${esc(o.customer_name)}<br>${esc(o.address)}<br>${esc(o.pincode)} · ${esc(o.phone)}
      ${flags.length ? `<ul class="flags">${flags.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : `<span class="sub">Phone and address checks passed</span>`}
      <div class="acts" style="margin-top:8px"><button class="btn sm" data-pin="${esc(o.pincode)}">Check pincode with India Post</button></div></div>
    <div><h3>Item</h3>${esc(o.product_name)}${o.version ? ` (${esc(o.version)})` : ""}${o.size ? `, size ${esc(o.size)}` : ""} × ${o.quantity}
      ${o.personalization ? `<br>Print: ${esc(o.personalization)}` : ""}
      <span class="sub">Items ${rupees(o.item_total)} · delivery ${rupees(o.delivery_fee)}${o.cod_fee ? ` · COD ${rupees(o.cod_fee)}` : ""}</span>
      ${o.payment_link_url ? `<span class="sub">Payment link: <a href="${esc(safeUrl(o.payment_link_url))}" target="_blank" rel="noopener">${esc(o.payment_link_url)}</a></span>` : ""}
      ${o.payment_id ? `<span class="sub mono">${esc(o.payment_id)}</span>` : ""}
      ${o.tracking ? `<span class="sub">Tracking: ${esc(o.tracking)}</span>` : ""}</div>
    <div><h3>History</h3><ul class="history">${(o.history || []).map((h) => `<li><span class="muted">${when(h.at)}</span> · ${esc(h.text)}</li>`).join("")}</ul>
      ${o.conversation_id ? `<a class="btn sm" style="margin-top:8px" href="#inbox/${o.conversation_id}">Open chat</a>` : ""}</div>
  </div>${acts.length ? `<div class="acts">${acts.map(([s, l, cls]) => `<button class="btn ${cls || ""}" data-order="${o.id}" data-act="${s}">${l}</button>`).join("")}<span class="muted small" style="align-self:center">The customer gets a DM about the change.</span></div>` : ""}</td></tr>`;
}
async function orderAction(id, status) {
  let body = { status };
  if (status === "shipped") {
    const tracking = await ask("Mark as shipped", "Courier and tracking number (optional). The customer gets it in a DM.", "e.g. DTDC D12345678");
    if (tracking === null) return;
    body.tracking = tracking;
  }
  if (status === "cancelled" && !(await confirmDlg("Cancel this order?", "The stock goes back and the customer gets a DM saying it's cancelled."))) return;
  const r = await api(`/orders/${id}/status`, { method: "POST", body });
  toast(r.told ? "Updated, customer told" : "Updated");
  render();
}
async function verifyPin(btn) {
  btn.disabled = true;
  const r = await fetch(`/api/pincode/${btn.dataset.pin}`).then((x) => x.json()).catch(() => ({ ok: false, error: "Couldn't reach India Post" }));
  btn.outerHTML = r.ok ? `<span class="pill on">✓ ${esc(r.district)}, ${esc(r.state)}</span>` : `<span class="pill needs">${esc(r.error)}</span>`;
}

// ── Products ──────────────────────────────────────────────────
async function products() {
  const { products } = await api("/products");
  view.innerHTML = `
    <div class="page-head"><h1 class="grow">Products</h1><button class="btn primary" id="add">Add product</button></div>
    ${products.length ? `<div class="prod-grid">${products.map((p) => `
      <div class="card prod" data-id="${p.id}">
        <div class="row"><h3 class="grow">${esc(p.name)}</h3>${p.active ? "" : `<span class="pill">Hidden</span>`}</div>
        ${p.category ? `<span class="sub">${esc(p.category)}</span>` : ""}
        <div class="prices">${Object.entries(p.prices).map(([k, v]) => (Object.keys(p.prices).length > 1 ? `${esc(k)} ${rupees(v)}` : rupees(v))).join(" · ")}</div>
        <div class="sizes">${Object.entries(sortSizes(p.sizes)).map(([k, v]) => `<span class="${v === 0 ? "out" : v <= 2 ? "low" : ""}" title="${v} left">${esc(k)} · ${v}</span>`).join("")}</div>
      </div>`).join("")}</div>`
      : `<div class="card"><p class="empty">Add what you sell, with prices and stock per size. The assistant only ever quotes what's here.</p></div>`}`;
  $("#add").onclick = () => productDialog(null);
  $$(".prod").forEach((el) => (el.onclick = () => productDialog(products.find((p) => p.id === el.dataset.id))));
}

function productDialog(p) {
  const d = $("#dialog");
  const prices = p ? Object.entries(p.prices) : [["standard", ""]];
  const sizes = p ? Object.entries(sortSizes(p.sizes)) : [];
  const row = (k, v, kp, vp) => `<div class="r"><input value="${esc(k)}" placeholder="${kp}"><input type="number" min="0" value="${esc(v)}" placeholder="${vp}"><button type="button" title="Remove">×</button></div>`;
  d.innerHTML = `<form class="dlg" method="dialog" id="pform">
    <h2>${p ? "Edit product" : "Add product"}</h2>
    <div class="form-grid">
      <label class="full">Name<input name="name" required value="${esc(p?.name)}" placeholder="e.g. Ferrari F1 Jersey 2026"></label>
      <label>Category<input name="category" value="${esc(p?.category)}" placeholder="e.g. F1 jerseys"></label>
      <label>Personalisation price<input name="personalization_price" type="number" min="0" value="${esc(p?.personalization_price ?? "")}" placeholder="Leave empty if not offered"><span class="hint">e.g. name &amp; number printing</span></label>
      <label class="full">Description<textarea name="description" placeholder="Material, fit, what's included…">${esc(p?.description)}</textarea></label>
      <div class="full"><label>Prices<span class="hint">One row per version, e.g. "fan" and "player". Use "standard" if there's only one price.</span></label>
        <div class="rows" id="prices">${prices.map(([k, v]) => row(k, v, "Version", "₹")).join("")}</div>
        <button type="button" class="link small" id="add-price">+ Add a price</button></div>
      <div class="full"><label>Sizes and stock<span class="hint">Units left per size. Leave empty for products without sizes.</span></label>
        <div class="rows" id="sizes">${sizes.map(([k, v]) => row(k, v, "Size", "Stock")).join("")}</div>
        <button type="button" class="link small" id="add-size">+ Add a size</button>
        ${p ? "" : `<button type="button" class="link small" id="std-sizes" style="margin-left:12px">Add S–XXL</button>`}</div>
      <label class="full">Other words customers use<input name="keywords" value="${esc((p?.keywords || []).join(", "))}" placeholder="e.g. scuderia, leclerc, red jersey"></label>
      <label class="full">Instagram post links<textarea name="post_urls" placeholder="One per line. When a customer shares one of these posts, the assistant knows which product it is.">${esc((p?.post_urls || []).join("\n"))}</textarea></label>
      <label class="full" style="display:flex;gap:8px;align-items:center;font-weight:400"><input type="checkbox" name="active" ${!p || p.active ? "checked" : ""} style="width:auto;margin:0"> Show to customers</label>
    </div>
    <p class="form-error" id="perr"></p>
    <div class="dlg-foot">${p ? `<button type="button" class="btn danger" id="pdel">Delete</button>` : ""}<span class="grow"></span>
      <button type="button" class="btn" id="pcancel">Cancel</button><button class="btn primary">Save</button></div>
  </form>`;
  const wireRows = (box) => $$(".r button", box).forEach((b) => (b.onclick = () => b.parentElement.remove()));
  const addRow = (box, kp, vp, k = "", v = "") => {
    box.insertAdjacentHTML("beforeend", row(k, v, kp, vp));
    wireRows(box);
  };
  wireRows($("#prices", d));
  wireRows($("#sizes", d));
  $("#add-price", d).onclick = () => addRow($("#prices", d), "Version", "₹");
  $("#add-size", d).onclick = () => addRow($("#sizes", d), "Size", "Stock");
  if ($("#std-sizes", d)) $("#std-sizes", d).onclick = () => ["S", "M", "L", "XL", "XXL"].forEach((s) => addRow($("#sizes", d), "Size", "Stock", s, 5));
  $("#pcancel", d).onclick = () => d.close();
  if ($("#pdel", d))
    $("#pdel", d).onclick = guard(async () => {
      if (!(await confirmDlg("Delete this product?", "Orders already placed keep their details."))) return productDialog(p);
      await api(`/products/${p.id}`, { method: "DELETE" });
      d.close();
      render();
    });
  $("#pform", d).onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const pairs = (box) => Object.fromEntries($$(".r", box).map((r) => [$$("input", r)[0].value.trim(), $$("input", r)[1].value]).filter(([k]) => k));
    const body = {
      name: f.get("name"), category: f.get("category"), description: f.get("description"),
      personalization_price: f.get("personalization_price"), keywords: f.get("keywords"),
      post_urls: f.get("post_urls"), active: f.get("active") === "on",
      prices: pairs($("#prices", d)), sizes: pairs($("#sizes", d)),
    };
    try {
      await api(p ? `/products/${p.id}` : "/products", { method: p ? "PUT" : "POST", body });
      d.close();
      toast("Saved");
      render();
    } catch (err) {
      $("#perr", d).textContent = err.message;
    }
  };
  d.showModal();
}

// ── Enquiries ─────────────────────────────────────────────────
async function leads() {
  const { leads } = await api("/leads");
  view.innerHTML = `
    <div class="page-head"><h1 class="grow">Enquiries</h1><span class="muted small">Bulk and custom orders the assistant collected</span></div>
    <div class="card">${leads.length ? `<table class="table"><thead><tr><th>Enquiry</th><th class="hide-sm">Details</th><th>Contact</th><th>Status</th></tr></thead><tbody>
      ${leads.map((l) => `<tr><td><b>${esc(l.data.summary)}</b><span class="sub">${l.data.quantity ? esc(l.data.quantity) + " pcs · " : ""}by ${esc(l.data.deadline || "—")} · ${ago(l.created_at)}</span></td>
        <td class="hide-sm">${esc(l.data.details)}</td>
        <td>${esc(l.data.contact_name)}<span class="sub">${esc(l.data.phone || "")}</span>${l.conversation_id ? `<a class="sub" href="#inbox/${l.conversation_id}">Open chat</a>` : ""}</td>
        <td><select data-lead="${l.id}">${["new", "contacted", "won", "lost"].map((s) => `<option ${l.status === s ? "selected" : ""}>${s}</option>`).join("")}</select></td></tr>`).join("")}
    </tbody></table>` : `<p class="empty">${state.me.shop.settings.bulk_orders ? "No enquiries yet." : `Bulk / custom orders are off. Describe what you offer under <a href="#settings">Settings → Bulk orders</a> and the assistant will collect enquiries.`}</p>`}</div>`;
  $$("[data-lead]").forEach((s) => (s.onchange = guard(async () => (await api(`/leads/${s.dataset.lead}`, { method: "POST", body: { status: s.value } }), toast("Saved"), refreshBadges()))));
}

// ── Test chat ─────────────────────────────────────────────────
async function test() {
  const { messages } = await api("/test-chat");
  view.innerHTML = `
    <div class="page-head"><h1 class="grow">Test chat</h1><button class="btn" id="reset">Start over</button></div>
    <div class="test-wrap">
      <div class="card phone">
        <div class="thread-head"><div class="who"><b>You, as a customer</b><span class="sub">Nothing here goes to Instagram</span></div></div>
        <div class="bubbles" id="bubbles">${messages.length ? bubbles(messages) : `<p class="empty">Message your assistant the way a customer would.</p>`}</div>
        <form class="composer" id="tform"><textarea id="ttext" rows="1" placeholder="e.g. Ferrari jersey price?"></textarea><button class="btn primary">Send</button></form>
      </div>
      <div class="card pad"><h2>Things to try</h2>
        <ul class="tips">
          <li>Ask a price the way customers do: <i>"price??"</i>, <i>"XL iruka?"</i></li>
          <li>Go all the way to an order with a name, phone and address</li>
          <li>Give a wrong phone number or pincode and see it ask again</li>
          <li>Ask something not in your shop info. It should hand over to you, not make things up</li>
        </ul>
        <p class="muted small">Orders you place here are real orders in your dashboard (marked from the test chat). Cancel them after.</p>
        ${state.me.ai ? `<p class="muted small">AI: ${esc(state.me.ai.provider)} · ${esc(state.me.ai.model)}</p>` : `<p class="pill needs">No AI key on the server yet</p>`}
      </div>
    </div>`;
  const bb = $("#bubbles");
  bb.scrollTop = bb.scrollHeight;
  $("#reset").onclick = guard(async () => (await api("/test-chat/reset", { method: "POST" }), render()));
  const ta = $("#ttext");
  ta.focus();
  ta.onkeydown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      $("#tform").requestSubmit();
    }
  };
  $("#tform").onsubmit = guard(async (e) => {
    e.preventDefault();
    const text = ta.value.trim();
    if (!text) return;
    ta.value = "";
    bb.insertAdjacentHTML("beforeend", `<div class="b customer">${esc(text)}</div><div class="day" id="typing">typing…</div>`);
    bb.scrollTop = bb.scrollHeight;
    try {
      const r = await api("/test-chat", { method: "POST", body: { text } });
      bb.innerHTML = bubbles(r.messages);
      bb.scrollTop = bb.scrollHeight;
    } catch (err) {
      $("#typing")?.remove();
      throw err;
    }
    ta.focus();
  });
}
test.live = () => {};

// ── Settings ──────────────────────────────────────────────────
async function settings() {
  state.me = await api("/me");
  paintShell();
  const s = state.me.shop;
  const st = s.settings;
  const q = new URLSearchParams(location.hash.split("?")[1] || "");
  if (q.get("ig") === "connected") toast("Instagram connected");
  if (q.get("ig") === "error") toast("Instagram: " + (q.get("reason") || "couldn't connect"), true);
  if (q.get("ig")) history.replaceState(null, "", "#settings");
  const f = (name, label, opts = {}) => {
    const v = st[name] ?? "";
    const input = opts.area
      ? `<textarea name="${name}" placeholder="${esc(opts.ph || "")}" ${opts.rows ? `rows="${opts.rows}"` : ""}>${esc(v)}</textarea>`
      : `<input name="${name}" ${opts.type ? `type="${opts.type}" min="0"` : ""} value="${esc(v)}" placeholder="${esc(opts.ph || "")}">`;
    return `<label class="${opts.full ? "full" : ""}">${label}${input}${opts.hint ? `<span class="hint">${opts.hint}</span>` : ""}</label>`;
  };
  const canGoLive = s.instagram.connected && state.me.ai;
  view.innerHTML = `
    <div class="page-head"><h1 class="grow">Settings</h1></div>
    <div class="settings">
      <section class="card pad"><div class="row">
        <div class="grow"><h2>Assistant</h2><p class="muted small" style="margin:4px 0 0">${s.bot_enabled ? "Replying to your Instagram DMs." : canGoLive ? "Off. Turn it on to start replying to DMs." : "Connect Instagram first" + (state.me.ai ? "." : ", and add an AI key to the server.")}</p></div>
        <label class="switch"><input type="checkbox" id="bot" ${s.bot_enabled ? "checked" : ""} ${canGoLive || s.bot_enabled ? "" : "disabled"}><span></span></label></div>
      </section>

      <section class="card pad"><h2>Instagram</h2>
        ${s.instagram.connected
          ? `<div class="row" style="margin-top:10px"><span class="pill on">Connected</span><b class="grow">@${esc(s.instagram.username)}</b><button class="btn danger sm" id="ig-off">Disconnect</button></div>
             <p class="muted small">Connection renews automatically${s.instagram.expires_at ? ` (current one valid until ${new Date(s.instagram.expires_at).toLocaleDateString("en-IN")})` : ""}.</p>`
          : state.me.instagram_available
            ? `<p class="muted small">Needs an Instagram professional account (Business or Creator). You'll sign in on Instagram and allow Shopkeep to read and reply to messages.</p><button class="btn primary" id="ig-on">Connect Instagram</button>`
            : `<p class="muted small">Instagram isn't set up on this server yet. The server owner needs to add IG_APP_ID, IG_APP_SECRET and PUBLIC_URL (see SETUP-INSTAGRAM.md).</p>`}
      </section>

      <form class="card pad" id="shopform">
        <h2>Shop details</h2><p class="muted small" style="margin:4px 0 0">The assistant answers only from what's written here and in Products.</p>
        <div class="form-grid">
          <label>Shop name<input name="__name" value="${esc(s.name)}" required></label>
          ${f("handle", "Instagram handle", { ph: "activewear.33" })}
          ${f("location", "City / area", { ph: "Coimbatore, Tamil Nadu" })}
          ${f("phone", "Shop phone", { ph: "+91 …" })}
          ${f("about", "About the shop", { area: true, full: true, ph: "What you sell, what you're known for" })}
          ${f("address", "Store address", { full: true, ph: "Leave empty if online only" })}
          ${f("staff_hours", "Team hours", { ph: "9 AM – 9 PM", hint: "When a person is around to take over" })}
          <label>Order number prefix<input name="__prefix" value="${esc(s.order_prefix)}" maxlength="8"><span class="hint">Orders look like ${esc(s.order_prefix)}-1001</span></label>
        </div>
        <h2 style="margin-top:22px">Delivery &amp; payment</h2>
        <div class="form-grid">
          ${f("delivery_time", "Delivery time", { ph: "2–3 days in Tamil Nadu, 4–6 days elsewhere" })}
          ${f("delivery_fee", "Delivery fee (₹)", { type: "number" })}
          ${f("free_delivery_above", "Free delivery above (₹)", { type: "number", hint: "0 = never free" })}
          ${f("cod_fee", "COD fee (₹)", { type: "number" })}
          <div class="full"><label>Payment methods</label><div class="checks">
            <label><input type="checkbox" name="pay_upi" ${st.payments.upi ? "checked" : ""}> UPI (paid before shipping)</label>
            <label><input type="checkbox" name="pay_cod" ${st.payments.cod ? "checked" : ""}> Cash on delivery</label></div></div>
          ${f("upi_id", "UPI ID for manual payments", { ph: "shopname@okaxis", hint: "Used only if Razorpay isn't connected below" })}
          ${f("returns_policy", "Returns / exchange", { area: true, ph: "Size exchange within 7 days if unused, with tags" })}
        </div>
        <h2 style="margin-top:22px">What the assistant should know</h2>
        <div class="form-grid">
          ${f("offers", "Current offers", { area: true, full: true, ph: "e.g. 3 jerseys for ₹1499 till Sunday" })}
          ${f("bulk_orders", "Bulk / custom orders", { area: true, full: true, ph: "e.g. Team kits from 10 pieces, ₹450–650 per set, 7–10 days. Leave empty if you don't take them.", hint: "If filled in, the assistant collects these enquiries for you" })}
          ${f("faq", "Other answers", { area: true, full: true, rows: 5, ph: "Anything customers often ask: fabric, sizing advice, store timings, how long printing takes…" })}
          ${f("holding_message", "Message when the assistant can't answer", { full: true, ph: "Thanks for your message! Our team will get back to you soon 🙏" })}
          ${f("human_pause_hours", "Stay quiet after a person replies (hours)", { type: "number", hint: "When your team replies in a chat, the assistant waits this long before replying there again" })}
          ${f("debounce_seconds", "Wait for more messages (seconds)", { type: "number", hint: "Customers often send 2–3 messages in a row; the assistant answers them together" })}
        </div>
        <div class="dlg-foot"><button class="btn primary">Save</button></div>
      </form>

      <section class="card pad" id="pay"><h2>Razorpay (automatic UPI confirmation)</h2>
        ${s.payments ? `<div class="row" style="margin-top:10px"><span class="pill on">Connected</span><span class="grow mono">${esc(s.payments.key_id)}</span>${s.payments.test_mode ? `<span class="pill needs">Test mode</span>` : ""}<button class="btn danger sm" id="rzp-off">Remove</button></div>` : ""}
        <ol class="how small">
          <li>In Razorpay, open <b>Account &amp; Settings → API Keys</b> and generate a key (test keys start with <span class="mono">rzp_test_</span>).</li>
          <li>Open <b>Webhooks → Add new webhook</b>, paste this URL, pick a secret, and tick <b>payment_link.paid</b>:
            <div class="copy"><input readonly value="${esc(s.urls.razorpay_webhook)}"><button type="button" class="btn sm" id="copyhook">Copy</button></div></li>
          <li>Paste the key ID, key secret and webhook secret here.</li>
        </ol>
        <form id="rzpform" class="form-grid">
          <label>Key ID<input name="key_id" placeholder="rzp_test_…" required value="${esc(s.payments?.key_id || "")}"></label>
          <label>Key secret<input name="key_secret" type="password" required autocomplete="off"></label>
          <label>Webhook secret<input name="webhook_secret" type="password" required autocomplete="off"></label>
          <div style="align-self:end"><button class="btn primary">${s.payments ? "Update keys" : "Save keys"}</button></div>
        </form>
      </section>
    </div>`;

  $("#bot").onchange = guard(async (e) => {
    try {
      await api("/shop", { method: "PUT", body: { bot_enabled: e.target.checked } });
      toast(e.target.checked ? "Assistant is on" : "Assistant is off");
    } catch (err) {
      e.target.checked = !e.target.checked;
      throw err;
    }
    render();
  });
  if ($("#ig-on")) $("#ig-on").onclick = guard(async () => (location.href = (await api("/instagram/connect", { method: "POST" })).url));
  if ($("#ig-off")) $("#ig-off").onclick = guard(async () => {
    if (!(await confirmDlg("Disconnect Instagram?", "The assistant stops replying until you connect again."))) return;
    await api("/instagram/disconnect", { method: "POST" });
    render();
  });
  if ($("#rzp-off")) $("#rzp-off").onclick = guard(async () => {
    if (!(await confirmDlg("Remove Razorpay keys?", "UPI orders will use your UPI ID instead, and the team confirms payments by hand."))) return;
    await api("/payments/razorpay", { method: "DELETE" });
    render();
  });
  $("#copyhook").onclick = () => navigator.clipboard.writeText(s.urls.razorpay_webhook).then(() => toast("Copied"));
  $("#shopform").onsubmit = guard(async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const out = {};
    for (const [k, v] of fd) if (!k.startsWith("__") && !k.startsWith("pay_")) out[k] = v;
    out.payments = { upi: fd.get("pay_upi") === "on", cod: fd.get("pay_cod") === "on" };
    if (!out.payments.upi && !out.payments.cod) throw new Error("Pick at least one payment method");
    await api("/shop", { method: "PUT", body: { name: fd.get("__name"), order_prefix: fd.get("__prefix"), settings: out } });
    toast("Saved");
    render();
  });
  $("#rzpform").onsubmit = guard(async (e) => {
    e.preventDefault();
    await api("/payments/razorpay", { method: "PUT", body: Object.fromEntries(new FormData(e.target)) });
    toast("Razorpay connected");
    render();
  });
}

// ── small dialogs ─────────────────────────────────────────────
function confirmDlg(title, text) {
  return new Promise((resolve) => {
    const d = $("#dialog");
    d.innerHTML = `<div class="dlg"><h2>${esc(title)}</h2><p class="muted">${esc(text)}</p><div class="dlg-foot"><button class="btn" id="no">Back</button><button class="btn primary" id="yes">Yes</button></div></div>`;
    $("#no", d).onclick = () => (d.close(), resolve(false));
    $("#yes", d).onclick = () => (d.close(), resolve(true));
    d.onclose = () => resolve(false);
    d.showModal();
  });
}
function ask(title, text, placeholder) {
  return new Promise((resolve) => {
    const d = $("#dialog");
    d.innerHTML = `<form class="dlg" id="askf"><h2>${esc(title)}</h2><p class="muted">${esc(text)}</p><input id="askv" style="width:100%" placeholder="${esc(placeholder)}"><div class="dlg-foot"><button type="button" class="btn" id="no">Back</button><button class="btn primary">Done</button></div></form>`;
    let done = false;
    $("#no", d).onclick = () => d.close();
    $("#askf", d).onsubmit = (e) => {
      e.preventDefault();
      done = true;
      const v = $("#askv", d).value.trim();
      d.close();
      resolve(v);
    };
    d.onclose = () => !done && resolve(null);
    d.showModal();
    $("#askv", d).focus();
  });
}

const SCREENS = { home, inbox, orders, products, leads, test, settings };
start();
