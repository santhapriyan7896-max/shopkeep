// Owner dashboard: orders, team enquiries, messages. Reads/writes the shared store,
// so it updates live while the Instagram demo runs in another tab.
(function () {
  const Store = globalThis.AW33Store;
  const V = globalThis.AW33Validate;
  const $ = (id) => document.getElementById(id);
  const rupee = (n) => "₹" + Number(n || 0).toLocaleString("en-IN");
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const phoneFmt = (p) => (p && p.length === 10 ? `${p.slice(0, 5)} ${p.slice(5)}` : p || "–");
  const timeOf = (iso) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });

  const STATUS = {
    review: "Needs review",
    awaiting_payment: "Awaiting payment",
    confirmed: "Confirmed",
    dispatched: "Dispatched",
    cancelled: "Cancelled",
  };
  let filter = "all";
  let open = null; // expanded order id
  let seen = new Set(Store.load().orders.map((o) => o.id));
  const postCache = {};

  function toast(t) {
    $("toast").textContent = t;
    $("toast").classList.add("on");
    clearTimeout(toast.t);
    toast.t = setTimeout(() => $("toast").classList.remove("on"), 2200);
  }

  // ── tabs ─────────────────────────────────────────────────
  $("tabs").onclick = (e) => {
    const b = e.target.closest("button[data-tab]");
    if (!b) return;
    document.querySelectorAll("#tabs button").forEach((x) => x.classList.toggle("on", x === b));
    for (const t of ["orders", "leads", "messages"]) $("tab-" + t).hidden = t !== b.dataset.tab;
  };

  // ── render ───────────────────────────────────────────────
  function render() {
    const d = Store.load();
    const orders = d.orders;
    const review = orders.filter((o) => o.status === "review");
    const awaiting = orders.filter((o) => o.status === "awaiting_payment");
    const paid = orders.filter((o) => o.paid);
    const confirmed = orders.filter((o) => o.status === "confirmed" || o.status === "dispatched");

    $("cOrders").textContent = orders.length;
    $("cOrders").classList.toggle("alert", review.length > 0);
    $("cLeads").textContent = d.leads.length;
    $("cLeads").classList.toggle("alert", d.leads.some((l) => l.status === "new"));
    $("cMsgs").textContent = d.messages.filter((m) => m.status === "open").length;
    $("cMsgs").classList.toggle("alert", d.messages.some((m) => m.status === "open"));

    $("summary").innerHTML = `
      <div class="sum ${review.length ? "warn" : ""}"><span>COD to review</span><b>${review.length}</b></div>
      <div class="sum"><span>Awaiting payment</span><b>${awaiting.length}</b></div>
      <div class="sum"><span>Confirmed orders</span><b>${confirmed.length}</b></div>
      <div class="sum"><span>Paid online</span><b>${rupee(paid.reduce((s, o) => s + o.amount, 0))}</b></div>`;

    const counts = { all: orders.length };
    for (const k of Object.keys(STATUS)) counts[k] = orders.filter((o) => o.status === k).length;
    $("filters").innerHTML = ["all", ...Object.keys(STATUS)]
      .map((k) => `<button data-f="${k}" class="${filter === k ? "on" : ""}">${k === "all" ? "All" : STATUS[k]} (${counts[k]})</button>`)
      .join("");

    const list = orders.filter((o) => filter === "all" || o.status === filter);
    $("ordersEmpty").hidden = list.length > 0;
    $("orderRows").innerHTML = list.map(orderRow).join("");
    seen = new Set(orders.map((o) => o.id));

    renderLeads(d.leads);
    renderMessages(d.messages);
  }

  function addressCell(o) {
    const c = o.check;
    if (!c) return `<span class="sub">–</span>`;
    const post = o.postCheck;
    if (c.ok && (!post || post.ok)) return `<span class="ok">✓ ${esc(c.pincode)}</span><span class="sub">${esc(c.area || c.state)}${post ? " · India Post ✓" : ""}</span>`;
    const n = c.flags.length + (post && !post.ok ? 1 : 0);
    return `<span class="bad">⚠ ${n} issue${n > 1 ? "s" : ""}</span><span class="sub">${esc((c.flags[0] || post.note || "").slice(0, 46))}</span>`;
  }

  function actions(o) {
    const call = o.phone ? `<a class="btn" href="tel:+91${o.phone}">Call</a>` : "";
    if (o.status === "review") return `<button class="btn primary" data-act="confirm" data-id="${o.id}">Confirm</button><button class="btn danger" data-act="cancel" data-id="${o.id}">Cancel</button>${call}`;
    if (o.status === "awaiting_payment") return `<button class="btn" data-act="remind" data-id="${o.id}">Send reminder</button><button class="btn danger" data-act="cancel" data-id="${o.id}">Cancel</button>`;
    if (o.status === "confirmed") return `<button class="btn primary" data-act="dispatch" data-id="${o.id}">Mark dispatched</button>${call}`;
    return call;
  }

  function orderRow(o) {
    const fresh = !seen.has(o.id) ? " new" : "";
    const payment = o.payment === "UPI" ? (o.paid ? `<span class="ok">UPI · paid</span><span class="sub">${esc(o.paidVia || "")}</span>` : `UPI<span class="sub">not paid yet</span>`) : `COD<span class="sub">collect ${rupee(o.amount)}</span>`;
    const phoneOk = V.checkPhone(o.phone || "").ok;
    const row = `<tr class="row${fresh}" data-id="${o.id}">
      <td><b class="mono">${esc(o.id)}</b><span class="sub">${timeOf(o.createdAt)}</span></td>
      <td>${esc(o.name || "–")}<span class="sub">${phoneFmt(o.phone)} ${phoneOk ? '<span class="ok">✓</span>' : '<span class="bad">⚠ invalid</span>'}</span></td>
      <td>${esc(o.product)}<span class="sub">${esc(o.size)}${o.version ? " · " + esc(o.version) : ""}${o.print ? " · " + esc(o.print) : ""}</span></td>
      <td class="num"><b>${rupee(o.amount)}</b></td>
      <td>${payment}</td>
      <td>${addressCell(o)}</td>
      <td><span class="pill ${o.status}">${STATUS[o.status] || o.status}</span></td>
      <td><div class="acts">${actions(o)}</div></td>
    </tr>`;
    return row + (open === o.id ? detailRow(o) : "");
  }

  function detailRow(o) {
    const c = o.check || { flags: [] };
    const checks = [
      `<li>${V.checkPhone(o.phone || "").ok ? '<span class="ok">✓</span> 10-digit mobile number' : '<span class="bad">⚠</span> Phone number not valid'}</li>`,
      `<li>${c.pinOk ? `<span class="ok">✓</span> Pincode ${esc(c.pincode)} is valid – ${esc(c.area || c.state)}` : '<span class="bad">⚠</span> Pincode missing / invalid'}</li>`,
      c.city ? `<li>${c.cityMatch ? `<span class="ok">✓</span> City (${esc(c.city)}) matches pincode` : `<span class="bad">⚠</span> City (${esc(c.city)}) doesn't match pincode`}</li>` : "",
      `<li>${c.hasDoor ? '<span class="ok">✓</span> Door / house number present' : '<span class="bad">⚠</span> No door / house number'}</li>`,
    ].join("");
    const post = o.postCheck
      ? `<div class="post-result">${o.postCheck.ok ? '<span class="ok">✓</span>' : '<span class="bad">⚠</span>'} ${esc(o.postCheck.note)}</div>`
      : `<div class="post-result"><button class="btn" data-act="post" data-id="${o.id}">Verify with India Post</button></div>`;
    const hist = (o.history || []).map((h) => `<li><time>${timeOf(h.at)}</time>${esc(h.text)}</li>`).join("");
    return `<tr class="detail"><td colspan="8"><div class="detail-grid">
      <div><h4>Deliver to</h4>${esc(o.name || "")}<br>${esc(o.address || "")}<br>Ph: ${phoneFmt(o.phone)}
        <div style="margin-top:10px;display:flex;gap:6px">${o.phone ? `<a class="btn" href="https://wa.me/91${o.phone}" target="_blank" rel="noopener">WhatsApp</a><a class="btn" href="tel:+91${o.phone}">Call</a>` : ""}</div></div>
      <div><h4>Checks</h4><ul class="checks">${checks}</ul>${post}</div>
      <div><h4>Bill</h4>Item ${rupee(o.item)}<br>Delivery ${rupee(o.delivery)}${o.codFee ? `<br>COD fee ${rupee(o.codFee)}` : ""}<br><b>Total ${rupee(o.amount)}</b>${o.utr ? `<br><span class="sub mono">UPI ref ${esc(o.utr)}</span>` : ""}
        <h4 style="margin-top:14px">History</h4><ul class="history">${hist}</ul></div>
    </div></td></tr>`;
  }

  function renderLeads(leads) {
    const opts = ["new", "called", "quote sent", "won", "lost"];
    $("leadList").innerHTML = leads.length
      ? leads
          .map(
            (l) => `<div class="list-item">
          <div><b>${esc(l.contact)}</b><span class="sub">${timeOf(l.createdAt)} · from Instagram</span></div>
          <div>${esc(l.sport)} – ${l.qty} sets<span class="sub">${esc(l.design)}${l.names ? " · names & numbers" : ""} · needed by ${esc(l.deadline)}</span></div>
          <div><b>${rupee(l.estimateLow)} – ${rupee(l.estimateHigh)}</b><span class="sub">estimate</span></div>
          <div><select data-lead="${l.id}">${opts.map((o) => `<option ${l.status === o ? "selected" : ""}>${o}</option>`).join("")}</select></div>
        </div>`
          )
          .join("")
      : `<div class="empty">No team enquiries yet.</div>`;
  }

  function renderMessages(msgs) {
    $("msgList").innerHTML = msgs.length
      ? msgs
          .map(
            (m) => `<div class="list-item">
          <div>${m.priority === "urgent" ? '<span class="tag-urgent">Complaint</span>' : "<b>Needs reply</b>"}<span class="sub">${esc(m.at || timeOf(m.createdAt))}</span></div>
          <div class="quote">“${esc(m.summary)}”</div>
          <div>${m.status === "open" ? '<span class="bad">Open</span>' : '<span class="ok">Resolved</span>'}</div>
          <div>${m.status === "open" ? `<button class="btn" data-act="resolve" data-id="${m.id}">Mark resolved</button>` : ""}</div>
        </div>`
          )
          .join("")
      : `<div class="empty">No messages waiting.</div>`;
  }

  // ── India Post pincode check (through our server) ────────
  async function verifyPost(o) {
    const pin = o.check && o.check.pincode;
    if (!pin) return;
    let result;
    try {
      const r = await fetch(`/api/pincode/${pin}`);
      const j = await r.json();
      if (!j.ok) result = { ok: false, note: j.error || "India Post has no record of this pincode" };
      else {
        const district = j.district;
        const city = o.check.city;
        const match = !city || district.toLowerCase().includes(city.toLowerCase()) || j.offices.some((x) => x.toLowerCase().includes(city.toLowerCase()));
        result = {
          ok: match,
          note: `India Post: ${j.offices.slice(0, 3).join(", ")}${j.offices.length > 3 ? "…" : ""} · ${district} district, ${j.state}${match ? "" : ` – but customer wrote ${city}`}`,
        };
      }
    } catch {
      const c = V.checkPincode(pin);
      result = { ok: c.ok, note: `Couldn't reach India Post (run the demo with npm start). Offline check: ${c.ok ? c.area || c.state : c.reason}` };
    }
    Store.updateOrder(o.id, { postCheck: result }, `Pincode checked with India Post: ${result.ok ? "OK" : "needs attention"}`);
  }

  // ── actions ──────────────────────────────────────────────
  document.addEventListener("click", (e) => {
    const f = e.target.closest("[data-f]");
    if (f) {
      filter = f.dataset.f;
      return render();
    }
    const a = e.target.closest("[data-act]");
    if (a) {
      e.stopPropagation();
      const id = a.dataset.id;
      const o = Store.load().orders.find((x) => x.id === id);
      if (a.dataset.act === "confirm") {
        Store.updateOrder(id, { status: "confirmed" }, "COD order confirmed by owner – customer notified on Instagram");
        toast(`${id} confirmed – customer notified`);
      }
      if (a.dataset.act === "cancel" && confirm(`Cancel order ${id}?`)) {
        Store.updateOrder(id, { status: "cancelled" }, "Cancelled by owner – customer notified");
        toast(`${id} cancelled`);
      }
      if (a.dataset.act === "dispatch") {
        Store.updateOrder(id, { status: "dispatched" }, "Marked as dispatched – customer notified");
        toast(`${id} marked dispatched`);
      }
      if (a.dataset.act === "remind") {
        Store.updateOrder(id, {}, "Payment reminder sent on Instagram");
        toast("Payment reminder sent");
      }
      if (a.dataset.act === "post" && o) {
        a.textContent = "Checking…";
        verifyPost(o);
      }
      if (a.dataset.act === "resolve") Store.updateMessage(id, { status: "resolved" });
      return;
    }
    const row = e.target.closest("tr.row");
    if (row && !e.target.closest("a")) {
      open = open === row.dataset.id ? null : row.dataset.id;
      render();
    }
  });
  document.addEventListener("change", (e) => {
    if (e.target.matches("select[data-lead]")) Store.updateLead(e.target.dataset.lead, { status: e.target.value });
  });
  $("clearBtn").onclick = () => {
    if (confirm("Clear all demo orders, enquiries and messages?")) Store.clear();
  };

  Store.subscribe(() => {
    render();
    $("syncText").textContent = "Updated " + new Date().toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", second: "2-digit" });
  });
  render();
})();
