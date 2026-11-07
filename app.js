// Two-phone demo: customer's Instagram DM (left) + owner's WhatsApp alerts (right).
// Orders go into the shared store (store.js) so the owner dashboard sees them live.
//  - UPI: a pay link appears in the chat → checkout sheet → paid → order confirms itself.
//  - COD: order goes to "Needs review"; when the owner confirms it on the dashboard,
//         the customer gets a confirmation message here.
(function () {
  const C = globalThis.AW33_CATALOG;
  const Bot = globalThis.AW33Bot;
  const Store = globalThis.AW33Store;
  const SCENARIOS = globalThis.AW33_SCENARIOS;
  const FULL = globalThis.AW33_FULL_DEMO;
  const byId = Object.fromEntries(C.products.map((p) => [p.id, p]));
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rupee = (n) => "₹" + Number(n).toLocaleString("en-IN");
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const DASH_URL = location.protocol.startsWith("http") ? `${location.origin}/dashboard.html` : "dashboard.html";

  const els = {
    ig: $("igMsgs"), wa: $("waMsgs"), input: $("input"), send: $("sendBtn"), compose: document.querySelector(".ig-compose"),
    share: $("shareBtn"), sheet: $("sheet"), grid: $("postGrid"), attach: $("attach"), attachThumb: $("attachThumb"),
    attachName: $("attachName"), attachClear: $("attachClear"), ctl: $("ctl"), ctlToggle: $("ctlToggle"),
    list: $("scenarioList"), playAll: $("playAll"), morning: $("morningBtn"), reset: $("resetBtn"),
    fast: $("fast"), live: $("liveToggle"), liveLabel: $("liveLabel"), toast: $("toast"),
    pay: $("paysheet"), payBody: $("payBody"), payClose: $("payClose"),
  };

  let bot = Bot.newState({ orderSeq: Store.nextOrderNo() });
  let stats = newStats();
  let minutes = 72; // 1:12 AM
  let lastStamp = -999;
  let mode = "offline";
  let sessionId = newSession();
  let attachment = null;
  let busy = false;
  let running = false;
  let stopRequested = false;
  let payingOrder = null;
  let payResolve = null;
  const knownStatus = {}; // order id → last status we told the customer about
  let timing = { typing: null, pause: null }; // set by the pitch film
  const emit = (name, detail) => window.dispatchEvent(new CustomEvent("aw33:" + name, { detail }));

  function newStats() {
    return { msgs: 0, views: {} };
  }
  function newSession() {
    return "s" + Math.random().toString(36).slice(2, 10);
  }

  // ── time ────────────────────────────────────────────────
  function clock(m) {
    const h24 = Math.floor(m / 60) % 24;
    const mm = String(m % 60).padStart(2, "0");
    const h = h24 % 12 || 12;
    return { short: `${h}:${mm}`, long: `${h}:${mm} ${h24 < 12 ? "AM" : "PM"}` };
  }
  function setClock(m) {
    minutes = m;
    document.querySelectorAll(".js-clock").forEach((e) => (e.textContent = clock(minutes).short));
  }

  // ── text ────────────────────────────────────────────────
  function fmt(text) {
    return esc(text)
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/(https?:\/\/[^\s<]+|dashboard\.html)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
      .replace(/\n/g, "<br>");
  }
  function toast(t) {
    els.toast.textContent = t;
    els.toast.classList.add("on");
    clearTimeout(toast.t);
    toast.t = setTimeout(() => els.toast.classList.remove("on"), 2200);
  }
  const avatar = '<span class="avatar"><b>AW</b><small>33</small></span>';
  function posterBg(p) {
    return p.image
      ? `background-image:url('${p.image}')`
      : `background-image:linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,.55)), linear-gradient(150deg, ${p.colors[0]}, ${p.colors[1]})`;
  }

  // ── Instagram side ──────────────────────────────────────
  function scrollIG() {
    els.ig.scrollTop = els.ig.scrollHeight;
  }
  function igIntro() {
    els.ig.innerHTML = `<div class="ig-intro">${avatar}
      <h3>Activewear33 | Sportswear</h3><p>activewear.33 · Instagram</p><p>8,885 followers · 70 posts</p>
      <span class="btn">View profile</span></div>`;
    lastStamp = -999;
  }
  function stampIfNeeded() {
    if (minutes - lastStamp >= 10) {
      const d = document.createElement("div");
      d.className = "stamp";
      d.textContent = clock(minutes).long;
      els.ig.appendChild(d);
    }
    lastStamp = minutes;
  }
  function addShared(p) {
    const d = document.createElement("div");
    d.className = "shared";
    d.innerHTML = `<div class="top">${avatar}activewear.33</div>
      <div class="img" style="${posterBg(p)}"><svg class="reel" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="#fff" stroke-width="2"/><path d="M3 8.5h18M9 3l3 5.5M14.5 3l3 5.5" stroke="#fff" stroke-width="2"/><path d="m10 12 4.5 2.6L10 17.2Z" fill="#fff"/></svg>
      ${p.image ? "" : `<span class="poster">${esc(p.short)}</span>`}</div>
      <div class="cap"><b>activewear.33</b>${esc(p.name)} · DM for size and price</div>`;
    els.ig.appendChild(d);
  }
  function addOut(text) {
    emit("msg", { dir: "out" });
    const row = document.createElement("div");
    row.className = "msg out";
    row.innerHTML = `<div class="bubble">${fmt(text)}</div>`;
    els.ig.appendChild(row);
  }
  function addInNode(inner) {
    const prev = els.ig.lastElementChild;
    if (prev && prev.classList.contains("in")) prev.classList.remove("tail");
    const row = document.createElement("div");
    row.className = "msg in tail";
    row.innerHTML = avatar;
    row.appendChild(inner);
    els.ig.appendChild(row);
    scrollIG();
    return row;
  }
  function addIn(text) {
    emit("msg", { dir: "in" });
    const b = document.createElement("div");
    b.className = "bubble";
    b.innerHTML = fmt(text);
    return addInNode(b);
  }
  function addPayLink(order) {
    const b = document.createElement("button");
    b.className = "paylink";
    b.dataset.order = order.id;
    b.innerHTML = `<div class="pl-top"><b>Pay ${rupee(order.amount)} · Activewear33</b><span>UPI payment for order ${esc(order.id)}</span></div><span class="pl-btn">Tap to pay</span>`;
    b.onclick = () => openPay(order.id);
    emit("msg", { dir: "in" });
    addInNode(b);
  }
  function markPayLinkPaid(id) {
    els.ig.querySelectorAll(`.paylink[data-order="${id}"]`).forEach((b) => {
      b.classList.add("paid");
      b.querySelector(".pl-btn").textContent = "Paid ✓";
      b.onclick = null;
    });
  }
  function showTyping() {
    const prev = els.ig.lastElementChild;
    if (prev && prev.classList.contains("in")) prev.classList.remove("tail");
    const row = document.createElement("div");
    row.className = "msg in tail";
    row.innerHTML = `${avatar}<div class="typing"><i></i><i></i><i></i></div>`;
    els.ig.appendChild(row);
    scrollIG();
    return () => {
      row.remove();
      const last = els.ig.lastElementChild;
      if (last && last.classList.contains("in")) last.classList.add("tail");
    };
  }
  function markSeen() {
    els.ig.querySelectorAll(".seen").forEach((e) => e.remove());
    const d = document.createElement("div");
    d.className = "seen";
    d.textContent = "Seen";
    els.ig.appendChild(d);
    scrollIG();
    return () => d.remove();
  }
  async function botSays(lines) {
    for (const text of lines) {
      const hide = showTyping();
      await sleep(Math.min(500 + text.length * 6, 1200));
      hide();
      addIn(text);
    }
  }

  // ── WhatsApp side ───────────────────────────────────────
  function scrollWA() {
    els.wa.scrollTop = els.wa.scrollHeight;
  }
  function waReset() {
    els.wa.innerHTML = "";
    const day = document.createElement("div");
    day.className = "wa-day";
    day.textContent = "Today";
    els.wa.appendChild(day);
    waSend("Night mode on 🌙\nI'll answer Instagram DMs till 9 AM and send you new orders, team enquiries and anything urgent here.", "", "10:30 PM");
  }
  function waSend(text, cls = "", time) {
    const d = document.createElement("div");
    d.className = "wa-bubble " + cls;
    d.innerHTML = `${fmt(text)}<span class="t">${time || clock(minutes).long}</span>`;
    els.wa.appendChild(d);
    scrollWA();
    emit("wa", { text, cls });
  }
  const phoneFmt = (p) => (p && p.length === 10 ? `${p.slice(0, 5)} ${p.slice(5)}` : p || "");
  function checkLine(o) {
    const c = o.check;
    if (!c) return "";
    if (c.ok) return `Address ✓ pincode ${c.pincode} matches ${c.area || c.state}`;
    return `Address ⚠ ${c.flags.join("; ")}`;
  }
  function orderLines(o) {
    return [
      `${o.product} – ${o.size}${o.version ? ", " + o.version : ""}${o.print ? ", " + o.print : ""}`,
      `${o.name || "Customer"} · ${phoneFmt(o.phone)}`,
      o.address,
    ].filter(Boolean);
  }

  // ── events from the assistant ───────────────────────────
  async function handleEvents(events) {
    for (const e of events) {
      if (e.type === "view" && e.productId) stats.views[e.productId] = (stats.views[e.productId] || 0) + 1;
      if (e.type === "order") {
        const order = { ...e, sessionId, placedAt: clock(minutes).long };
        delete order.type;
        Store.addOrder({ ...order, historyText: `Order placed on Instagram at ${order.placedAt} (${order.payment})` });
        knownStatus[order.id] = order.status;
        if (order.status === "awaiting_payment") {
          addPayLink(order);
        } else {
          waSend([`🛒 COD order to review – ${order.id}`, ...orderLines(order), `${rupee(order.amount)} · pay on delivery`, checkLine(order), `Review: ${DASH_URL}`].filter(Boolean).join("\n"));
        }
      }
      if (e.type === "lead") {
        Store.addLead({ ...e, sessionId });
        waSend(
          [`⭐ Team kit enquiry`, e.contact, `${e.sport} – ${e.qty} sets, ${e.design}${e.names ? ", names & numbers" : ""}`, `Needed by ${e.deadline} · approx ${rupee(e.estimateLow)}–${Number(e.estimateHigh).toLocaleString("en-IN")}`, `Call them in the morning`].join("\n"),
          "lead"
        );
      }
      if (e.type === "handoff") {
        Store.addMessage({ ...e, sessionId, at: clock(minutes).long });
        waSend(e.priority === "urgent" ? `⚠️ Complaint – reply first thing\n“${e.summary}”` : `📩 Needs your reply\n“${e.summary}”`, e.priority === "urgent" ? "urgent" : "");
      }
    }
  }

  // ── checkout sheet ──────────────────────────────────────
  const APPS = [
    { name: "Google Pay", short: "G", color: "#1a73e8" },
    { name: "PhonePe", short: "Pe", color: "#5f259f" },
    { name: "Paytm", short: "P", color: "#00b9f1" },
    { name: "BHIM UPI", short: "B", color: "#f47c20" },
  ];
  function openPay(orderId) {
    const o = Store.load().orders.find((x) => x.id === orderId);
    if (!o) return;
    if (o.paid) return toast("Already paid");
    payingOrder = o;
    els.payBody.innerHTML = `
      <div class="pay-merchant">${avatar}<div><b>Activewear33</b><span>Coimbatore · verified merchant</span></div></div>
      <div class="pay-amount">${rupee(o.amount)}</div>
      <div class="pay-item">Order ${esc(o.id)}<br>${esc(o.product)} – ${esc(o.size)}${o.version ? ", " + esc(o.version) : ""}${o.print ? ", " + esc(o.print) : ""}<br>Deliver to ${esc(o.name || "")}, ${esc(o.pincode || "")}</div>
      <div class="pay-h">Pay with UPI app</div>
      ${APPS.map((a) => `<button class="pay-app" data-app="${a.name}"><i style="background:${a.color}">${a.short}</i>${a.name}<span class="arrow">›</span></button>`).join("")}
      <div class="pay-foot">Demo checkout – no money is charged</div>`;
    els.payBody.querySelectorAll(".pay-app").forEach((b) => (b.onclick = () => payWith(b.dataset.app)));
    els.pay.classList.add("on");
    emit("pay", { stage: "open", id: o.id });
  }
  function closePay() {
    els.pay.classList.remove("on");
    payingOrder = null;
  }
  async function payWith(app) {
    const o = payingOrder;
    if (!o) return;
    els.payBody.innerHTML = `<div class="pay-wait"><div class="spinner"></div><b>Waiting for payment</b><p>Approve ${rupee(o.amount)} in ${esc(app)}</p></div>`;
    await sleep(2200);
    const utr = String(Math.floor(1e11 + Math.random() * 9e11));
    els.payBody.innerHTML = `<div class="pay-done"><div class="tick">✓</div><h4>Payment successful</h4><p>${rupee(o.amount)} paid to Activewear33</p><p>Order ${esc(o.id)} confirmed</p><div class="utr">UPI ref ${utr.replace(/(\d{4})(?=\d)/g, "$1 ")}</div><p style="margin-top:22px;color:#9ca3af;font-size:12px">Returning to Instagram…</p></div>`;
    Store.updateOrder(o.id, { status: "confirmed", paid: true, utr, paidVia: app, paidAt: clock(minutes).long }, `Paid ${rupee(o.amount)} via ${app} · UPI ref ${utr} · confirmed automatically`);
    knownStatus[o.id] = "confirmed";
    emit("pay", { stage: "paid", id: o.id });
    await sleep(2000);
    closePay();
    markPayLinkPaid(o.id);
    setClock(minutes + 1);
    const tg = bot.tanglish;
    await botSays([
      tg ? `Payment vandhuduchu ✅ Order ${o.id} confirmed.` : `Payment received ✅ Order ${o.id} is confirmed.`,
      tg ? `Delivery ${o.eta}. Dispatch aana udane tracking link anupuvom.` : `Delivery in ${o.eta}. We'll send the tracking link once it's dispatched.`,
    ]);
    waSend([`💰 Paid order – ${o.id}`, ...orderLines(o), `${rupee(o.amount)} · UPI (${app}) · ref ${utr}`, checkLine(o), `Confirmed automatically – ready to pack`].filter(Boolean).join("\n"));
    if (payResolve) payResolve();
  }

  // Owner acted on the dashboard (other tab) → tell the customer.
  Store.subscribe(async (data, from) => {
    if (from !== "remote") return;
    for (const o of data.orders) {
      if (o.sessionId !== sessionId || knownStatus[o.id] === o.status) continue;
      const before = knownStatus[o.id];
      knownStatus[o.id] = o.status;
      const tg = bot.tanglish;
      const first = (o.name || "").split(" ")[0];
      if (o.status === "confirmed" && before === "review") {
        await botSays([
          tg ? `Hi ${first}, unga order ${o.id} confirm aagiduchu ✅` : `Hi ${first}, your order ${o.id} is confirmed ✅`,
          tg ? `Delivery ${o.eta}. ${rupee(o.amount)} delivery appo kudunga.` : `Delivery in ${o.eta}. Please keep ${rupee(o.amount)} ready on delivery.`,
        ]);
      } else if (o.status === "dispatched") {
        await botSays([tg ? `Unga order ${o.id} dispatch aagiduchu 🚚` : `Your order ${o.id} has been dispatched 🚚`]);
      } else if (o.status === "cancelled") {
        await botSays([tg ? `Sorry ${first}, order ${o.id} confirm panna mudiyala. Team ungala call pannuvanga.` : `Sorry ${first}, we couldn't confirm order ${o.id}. Our team will call you.`]);
      }
    }
  });

  function morningSummary() {
    for (const [k, n] of Object.entries(bot.views)) stats.views[k] = (stats.views[k] || 0) + n;
    bot.views = {};
    setClock(9 * 60);
    const d = Store.load();
    const paid = d.orders.filter((o) => o.paid);
    const review = d.orders.filter((o) => o.status === "review");
    const unpaid = d.orders.filter((o) => o.status === "awaiting_payment");
    const top = Object.entries(stats.views).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => byId[id]?.short).filter(Boolean);
    const lines = ["Good morning ☀️", "Last night (10:30 PM – 9 AM):", `• ${stats.msgs} customer messages answered`];
    lines.push(`• ${paid.length} paid order${paid.length === 1 ? "" : "s"}${paid.length ? " – " + rupee(paid.reduce((s, o) => s + o.amount, 0)) + " received" : ""}`);
    if (review.length) lines.push(`• ${review.length} COD order${review.length === 1 ? "" : "s"} to review – ${rupee(review.reduce((s, o) => s + o.amount, 0))}`);
    if (unpaid.length) lines.push(`• ${unpaid.length} waiting for payment`);
    if (d.leads.length) lines.push(`• ${d.leads.length} team kit enquir${d.leads.length === 1 ? "y" : "ies"} – call ${d.leads.map((l) => String(l.contact).split(",").pop().trim()).join(", ")}`);
    const open = d.messages.filter((m) => m.status === "open");
    if (open.length) lines.push(`• ${open.length} message${open.length === 1 ? "" : "s"} waiting for you`);
    if (top.length) lines.push(`Most asked: ${top.join(", ")}`);
    lines.push(`Dashboard: ${DASH_URL}`);
    waSend(lines.join("\n"));
  }

  // ── sending ─────────────────────────────────────────────
  async function send(rawText, shareId) {
    const text = (rawText || "").trim();
    shareId = shareId || (attachment && attachment.id);
    if (busy || (!text && !shareId)) return;
    busy = true;
    setAttachment(null);
    els.input.value = "";
    els.compose.classList.remove("typing-on");
    setClock(minutes + 1);
    stampIfNeeded();
    els.ig.querySelectorAll(".seen").forEach((e) => e.remove());
    if (shareId && byId[shareId]) addShared(byId[shareId]);
    if (text) addOut(text);
    scrollIG();
    stats.msgs++;

    const reply =
      mode === "live"
        ? fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId, text, sharedProductId: shareId || null, nextOrderNo: Store.nextOrderNo() }),
          }).then(async (r) => {
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(j.error || r.statusText);
            return j;
          })
        : Promise.resolve(Bot.reply(bot, { text, sharedProductId: shareId }));

    await sleep(500);
    const unseen = markSeen();
    await sleep(350);
    unseen();
    let hide = showTyping();
    let result;
    try {
      [result] = await Promise.all([reply, sleep(700 + Math.random() * 500)]);
    } catch (err) {
      hide();
      toast("Live AI error: " + err.message);
      busy = false;
      return;
    }
    const msgs = result.messages || [];
    for (let i = 0; i < msgs.length; i++) {
      if (i > 0) {
        hide = showTyping();
        await sleep(Math.min(300 + msgs[i].text.length * 6, 1100));
      }
      hide();
      addIn(msgs[i].text);
    }
    if (!msgs.length) hide();
    await handleEvents(result.events || []);
    busy = false;
  }

  // ── conversations ───────────────────────────────────────
  function newCustomer(first) {
    for (const [k, n] of Object.entries(bot.views)) stats.views[k] = (stats.views[k] || 0) + n;
    bot = Bot.newState({ orderSeq: Store.nextOrderNo() });
    sessionId = newSession();
    setAttachment(null);
    closePay();
    if (!first) setClock(minutes + 4 + Math.floor(Math.random() * 9));
    igIntro();
  }

  async function typeInto(text) {
    els.input.value = "";
    const delay = timing.typing ?? (els.fast.checked ? 10 : 42);
    for (const ch of text) {
      if (stopRequested) return;
      els.input.value += ch;
      els.compose.classList.add("typing-on");
      await sleep(delay + Math.random() * delay * 0.6);
    }
    await sleep(300);
  }

  async function runPayStep(app) {
    const link = [...els.ig.querySelectorAll(".paylink:not(.paid)")].pop();
    if (!link) return;
    await sleep(600);
    openPay(link.dataset.order);
    await sleep(1500);
    const done = new Promise((r) => (payResolve = r));
    payWith(app);
    await done;
    payResolve = null;
  }

  async function runScenario(sc, fresh = true) {
    if (fresh) newCustomer(false);
    await sleep(500);
    for (const [index, step] of sc.steps.entries()) {
      if (stopRequested) return;
      emit("step", { scenario: sc.id, index, step });
      if (step.pay) {
        await runPayStep(step.pay);
        await sleep(1200);
        continue;
      }
      if (step.share) {
        setAttachment(byId[step.share]);
        await sleep(700);
      }
      await typeInto(step.text);
      if (stopRequested) return;
      await send(step.text, step.share);
      await sleep(timing.pause ?? (els.fast.checked ? 500 : 1500));
    }
  }

  async function run(fn) {
    if (running) {
      stopRequested = true;
      return;
    }
    running = true;
    stopRequested = false;
    els.playAll.firstChild.textContent = "Stop ";
    try {
      await fn();
    } finally {
      running = false;
      stopRequested = false;
      els.playAll.firstChild.textContent = "Play full demo ";
    }
  }
  const playFull = () =>
    run(async () => {
      for (const id of FULL) {
        if (stopRequested) return;
        await runScenario(SCENARIOS.find((s) => s.id === id));
        await sleep(1200);
      }
      if (!stopRequested) {
        await sleep(800);
        morningSummary();
      }
    });

  function resetAll() {
    if (running) return;
    Store.clear();
    stats = newStats();
    setClock(72);
    waReset();
    newCustomer(true);
  }

  // ── share sheet ─────────────────────────────────────────
  function setAttachment(p) {
    attachment = p || null;
    els.attach.classList.toggle("on", !!p);
    if (p) {
      els.attachThumb.setAttribute("style", posterBg(p));
      els.attachName.textContent = p.name;
    }
  }
  function buildGrid() {
    els.grid.innerHTML = "";
    for (const p of C.products) {
      const b = document.createElement("button");
      b.className = "tile";
      b.setAttribute("style", posterBg(p));
      b.innerHTML = p.image ? "" : `<span>${esc(p.short)}</span>`;
      b.onclick = () => {
        setAttachment(p);
        els.sheet.classList.remove("on");
        els.input.focus();
      };
      els.grid.appendChild(b);
    }
  }

  // ── live AI ─────────────────────────────────────────────
  async function detectLive() {
    if (!location.protocol.startsWith("http")) return;
    try {
      const s = await (await fetch("/api/status")).json();
      if (s.live) {
        els.live.disabled = false;
        els.liveLabel.textContent = `Live AI (${s.model})`;
      }
    } catch {
      /* offline only */
    }
  }

  // ── wire up ─────────────────────────────────────────────
  function init() {
    if (new URLSearchParams(location.search).get("theme") === "dark") document.body.classList.add("film"); // embedded on the dark landing page
    for (const sc of SCENARIOS) {
      const b = document.createElement("button");
      b.textContent = sc.label;
      b.onclick = () => run(() => runScenario(sc));
      els.list.appendChild(b);
    }
    els.playAll.onclick = playFull;
    els.morning.onclick = morningSummary;
    els.reset.onclick = resetAll;
    els.ctlToggle.onclick = () => els.ctl.classList.toggle("on");
    els.send.onclick = () => send(els.input.value);
    els.input.addEventListener("input", () => els.compose.classList.toggle("typing-on", !!els.input.value));
    els.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") send(els.input.value);
      if (e.key === "Escape") els.input.blur();
    });
    els.share.onclick = () => els.sheet.classList.toggle("on");
    els.attachClear.onclick = () => setAttachment(null);
    els.payClose.onclick = closePay;
    els.live.onchange = () => {
      mode = els.live.checked ? "live" : "offline";
      newCustomer(false);
      toast(mode === "live" ? "Live AI on – type anything" : "Offline demo");
    };
    document.addEventListener("keydown", (e) => {
      if (document.activeElement === els.input || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "h") els.ctl.classList.toggle("on");
      if (k === "p") playFull();
      if (k === "m") morningSummary();
      if (k === "r") resetAll();
      if (k === "escape") {
        els.sheet.classList.remove("on");
        closePay();
      }
    });

    buildGrid();
    resetAll();
    detectLive();
  }
  init();

  // Small API for the pitch film (pitch.html) to drive the demo.
  window.AW33Demo = {
    run: (id) => run(() => runScenario(SCENARIOS.find((s) => s.id === id))),
    reset: resetAll,
    morning: morningSummary,
    setTiming: (t) => Object.assign(timing, t),
    session: () => sessionId,
    filmMode() {
      els.ctlToggle.style.display = "none";
      document.body.classList.add("film"); // dark product-film backdrop
      // Zoom the phones ~22% so chat text is readable in a 1080p video.
      const z = 1.22;
      document.documentElement.style.zoom = String(z);
      const st = document.querySelector(".stage");
      st.style.height = innerHeight / z + "px";
      st.style.setProperty("--h", Math.min(830, innerHeight / z - 50) + "px");
      els.ctl.classList.remove("on");
    },
  };
})();
