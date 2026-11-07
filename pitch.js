// Shopkeep launch film: a ~2 minute self-playing video at 1920×1080.
// Drives the real demo (demo.html + dashboard.html) and adds product-site style
// scenes, captions and tap marks. Record with record-video.mjs, add sound with make-audio.mjs.
//
// Closing card details – edit here, or pass ?phone=... in the URL for a contact line.
const PITCH = {
  product: "Shopkeep",
  team: "Team Coge",
  shop: "Activewear33",
  contact: "",
};

(function () {
  const q = new URLSearchParams(location.search);
  if (q.get("phone")) PITCH.contact = q.get("phone");

  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const stage = $("stage");
  const phonesFrame = $("phones");
  const dashFrame = $("dash");
  const C = globalThis.AW33_CATALOG;
  let P; // phones window (AW33Demo lives here)
  let D; // dashboard window

  // Sound cues + scene marks, logged with their time so the sound track matches the picture.
  const film0 = { t: 0 };
  window.__cues = [];
  window.__marks = [];
  const now = () => +((performance.now() - film0.t) / 1000).toFixed(3);
  const cue = (kind) => film0.t && window.__cues.push({ t: now(), kind });
  const mark = (key, label) => window.__marks.push({ t: now(), key, label: label || key });

  function fit() {
    stage.style.setProperty("--s", Math.min(innerWidth / 1920, innerHeight / 1080));
  }
  addEventListener("resize", fit);
  fit();

  const LOGO = `<img class="mark rise" src="shopkeep-logo.svg" alt="" />`;
  const ICON = {
    chat: '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#2ED47A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v11H9l-5 4z"/><path d="M8 10h8M8 13h5"/></svg>',
    cart: '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#2ED47A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h2l2.5 11h11L21 7H6.2"/><circle cx="9" cy="19.5" r="1.4"/><circle cx="17" cy="19.5" r="1.4"/></svg>',
    pin: '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#2ED47A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><path d="m9.5 9.8 1.8 1.8 3.3-3.6"/></svg>',
    bell: '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#2ED47A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/></svg>',
  };

  // ── full-frame scenes ────────────────────────────────────
  const scene = $("scene");
  async function showScene(html, { stagger = 420, sound = "whoosh" } = {}) {
    if (sound) cue(sound);
    scene.innerHTML = html;
    scene.classList.add("on");
    await sleep(300);
    for (const el of scene.querySelectorAll(".rise")) {
      el.classList.add("in");
      await sleep(stagger);
    }
  }
  async function hideScene() {
    cue("whooshOut");
    scene.classList.remove("on");
    await sleep(700);
  }
  const split = (label, title, sub, visual) => `<div class="split">
      <div class="copy">${label ? `<span class="label rise">${label}</span>` : ""}<h1 class="rise">${title}</h1>${sub ? `<p class="rise">${sub}</p>` : ""}</div>
      <div class="visual rise">${visual}</div>
    </div>`;

  // ── captions beside the product ──────────────────────────
  async function caption(id, label, text) {
    const el = $(id);
    if (!text) {
      el.classList.remove("on");
      return;
    }
    if (el.classList.contains("on")) {
      el.classList.add("swap");
      await sleep(280);
    }
    el.querySelector(".label").textContent = label || "";
    el.querySelector(".label").style.display = label ? "" : "none";
    el.querySelector("p").innerHTML = text;
    el.classList.remove("swap");
    el.classList.add("on");
  }
  const left = (l, t) => caption("capLeft", l, t);
  const right = (l, t) => caption("capRight", l, t);
  const dashCap = (l, t) => caption("dashCap", l, t);

  // ── tap marks ────────────────────────────────────────────
  function tapAt(x, y) {
    cue("tap");
    const t = $("tap");
    t.style.left = x + "px";
    t.style.top = y + "px";
    t.classList.remove("go");
    void t.offsetWidth;
    t.classList.add("go");
  }
  // element inside an iframe → stage pixels (frame offset + its scale, plus any CSS zoom inside)
  function tapEl(el, { scale = 1, x = 0, y = 0 } = {}) {
    if (!el) return;
    const r = el.getBoundingClientRect();
    const z = parseFloat(el.ownerDocument.documentElement.style.zoom) || 1;
    const reportsZoomed = Math.abs(r.width - el.offsetWidth * z) < 2 && z !== 1;
    const k = scale * (reportsZoomed ? 1 : z);
    tapAt(x + (r.left + r.width / 2) * k, y + (r.top + r.height / 2) * k);
  }
  const DASH = { scale: 1.24, x: 600, y: 150 };

  // ── captions that follow the demo ────────────────────────
  const STEP_CAPTIONS = {
    reel: {
      0: ["1:13 AM", "A customer shares your reel and asks “Price??”"],
      1: ["Seconds later", "Price, sizes and offers, answered instantly"],
      2: ["In their language", "Replies in Tanglish when the customer does"],
      4: ["More per order", "Suggests name & number printing (+₹150)"],
      6: ["Checked", "Phone number and pincode verified before booking"],
      8: ["UPI", "The payment link opens right inside Instagram"],
    },
    team: {
      0: ["A few minutes later", "A college team asks for 15 custom jerseys"],
      1: ["Qualified", "Asks the right questions: design, names, deadline"],
      3: ["Priority lead", "Gives an estimate and sends the lead to you"],
    },
  };
  function onStep(e) {
    mark(`step:${e.detail.scenario}:${e.detail.index}`);
    const c = (STEP_CAPTIONS[e.detail.scenario] || {})[e.detail.index];
    if (c) left(c[0], c[1]);
    if (e.detail.step && e.detail.step.pay) setTimeout(() => tapEl([...P.document.querySelectorAll(".paylink")].pop()), 450);
  }
  function onPay(e) {
    cue(e.detail.stage === "paid" ? "success" : "sheet");
    if (e.detail.stage === "open") setTimeout(() => tapEl(P.document.querySelector(".pay-app")), 1300);
    if (e.detail.stage === "paid") left("Paid", "Order confirmed automatically. Nobody had to wake up.");
  }
  function onWa(e) {
    cue("ding");
    const t = e.detail.text || "";
    if (t.startsWith("💰")) right("Your WhatsApp", "Paid order alert, with the full address");
    else if (e.detail.cls === "lead") right("Your WhatsApp", "Team enquiry, ready to call in the morning");
    else if (t.startsWith("🛒")) right("Your WhatsApp", "COD orders come to you for review");
    else if (t.startsWith("⚠️")) right("Your WhatsApp", "Complaints come straight to you");
    else if (t.startsWith("Good morning")) right("Your WhatsApp", "Last night's orders, payments and leads in one message");
  }

  // ── the film ─────────────────────────────────────────────
  async function film() {
    film0.t = performance.now();
    window.__filmStartEpoch = Date.now();
    P.AW33Demo.filmMode();
    P.AW33Demo.reset();
    P.AW33Demo.setTiming({ typing: 15, pause: 800 });
    P.addEventListener("aw33:step", onStep);
    P.addEventListener("aw33:pay", onPay);
    P.addEventListener("aw33:wa", onWa);
    P.addEventListener("aw33:msg", (e) => cue(e.detail.dir === "out" ? "send" : "recv"));

    // 1 · The problem
    mark("intro", "11:47 PM, someone wants to buy");
    await showScene(
      split(
        "Coimbatore · 11:47 PM",
        "Someone wants to buy a jersey from you.",
        "They're in your DMs right now.",
        `<div class="lock"><div class="time rise">11:47</div><div class="date rise">Friday, 7 November</div>
          <div class="note rise"><i class="ic"></i><div><b>karthik_07</b><span>Price?? 🔥 Ferrari F1 jersey</span></div><small>now</small></div>
          <div class="note rise"><i class="ic"></i><div><b>riya.fit</b><span>L size iruka?</span></div><small>2m</small></div>
          <div class="note rise"><i class="ic"></i><div><b>arun_fc</b><span>15 team jerseys venum, rate?</span></div><small>9m</small></div></div>`
      ),
      { sound: "swell", stagger: 300 }
    );
    await sleep(1300);

    mark("story", "Their own story: no replies at midnight");
    await showScene(
      split(
        "Your Instagram story",
        "You posted this.",
        "Because the messages don't stop at night.",
        `<div class="story rise"><div class="bars"><i></i><i></i><i></i><i></i></div>
          <div class="who"><span class="av"><b>AW</b><small>33</small></span>activewear.33 <span>10h</span></div>
          <div class="txt"><u>Important Notice</u>We have been receiving a high volume of enquiries even after midnight.<br><br>Please note, we will not be able to reply during midnight hours.<br><br>Our team will respond to all your messages between 9:00 AM – 10:30 PM only.</div></div>`
      )
    );
    await sleep(3700);

    mark("posts", "70 posts, no prices");
    const tiles = ["fb-realmadrid", "f1-ferrari", "cl-predator", "ct-argentina", "nba-jordan", "fb-barcelona", "f1-mercedes", "tr-aw33-jacket", "ct-india"]
      .map((id) => C.products.find((p) => p.id === id))
      .map((p) => `<div class="post" style="background:linear-gradient(180deg,rgba(0,0,0,0) 45%,rgba(0,0,0,.55)),linear-gradient(150deg,${p.colors[0]},${p.colors[1]})"><em>DM for price</em><b>${p.short}</b></div>`)
      .join("");
    await showScene(split("@activewear.33", "70 posts. Not one shows a price.", "So everyone who's interested has to DM you, day and night.", `<div class="posts rise">${tiles}</div>`), {
      sound: "impact",
    });
    await sleep(3500);

    mark("lost", "By 9 AM they've bought elsewhere");
    await showScene(
      split(
        "9:15 AM",
        "By morning, many have bought somewhere else.",
        "Every late reply is an order that went to another page.",
        `<div class="thread">
          <div class="t rise">11:47 PM</div>
          <div class="row them rise"><div class="bub">Price??</div></div>
          <div class="row them rise"><div class="bub">Hello?</div></div>
          <div class="t rise">8:02 AM</div>
          <div class="row them rise"><div class="bub">nvm, got it from another page 👍</div></div>
          <div class="t rise">9:15 AM</div>
          <div class="row me rise"><div class="bub">Hi! Ferrari jersey is ₹899 😊</div></div>
          <div class="seen rise">Seen</div></div>`
      ),
      { stagger: 260 }
    );
    await sleep(1600);

    mark("whatif", "Meet Shopkeep");
    await showScene(
      `<div class="hero">${LOGO}<h1 class="rise">Meet ${PITCH.product}.</h1><p class="rise">It replies to every DM in seconds. Even at 1 AM.</p></div>`,
      { sound: "riser", stagger: 500 }
    );
    await sleep(3200);
    await hideScene();

    // 2 · A customer buys at 1 AM (UPI, confirmed automatically)
    $("brandbar").classList.add("on");
    mark("demo", "Shared reel, Price??, Tanglish reply, UPI payment");
    cue("impact");
    await P.AW33Demo.run("reel");
    await sleep(2200);

    // 3 · A team-kit enquiry becomes a lead
    right();
    mark("team", "Team kit enquiry becomes a lead");
    await P.AW33Demo.run("team");
    await sleep(2200);

    // 4 · Morning summary
    mark("morning", "9 AM WhatsApp summary");
    cue("swell");
    left("9:00 AM", "You wake up to one summary");
    P.AW33Demo.morning();
    await sleep(4500);
    left();
    right();

    // 5 · The dashboard
    seedCodOrder();
    await sleep(300);
    mark("dashboard", "COD order checked and confirmed");
    cue("whoosh");
    phonesFrame.style.transition = "opacity .7s";
    phonesFrame.style.opacity = "0";
    $("dashWrap").classList.add("on");
    await sleep(800);
    await dashCap("Your dashboard", "Every order, payment and enquiry in one place");
    await sleep(3200);
    const row = D.document.querySelector("tr.row");
    tapEl(row.querySelector("td"), DASH);
    await sleep(350);
    row.click();
    await dashCap("COD orders", "Phone number and address already checked");
    await sleep(3000);
    const verify = D.document.querySelector('[data-act="post"]');
    if (verify) {
      tapEl(verify, DASH);
      await sleep(350);
      verify.click();
      await dashCap("India Post", "Pincode verified in one click");
      await sleep(3000);
    }
    const confirmBtn = D.document.querySelector('[data-act="confirm"]');
    tapEl(confirmBtn, DASH);
    await sleep(350);
    confirmBtn.click();
    cue("success");
    await dashCap("One tap", "Confirmed. The customer is told on Instagram.");
    await sleep(3400);
    dashCap();

    // 6 · What it does → what it is → who made it
    mark("close", "What it does");
    await showScene(
      `<div class="features"><h2 class="rise">What ${PITCH.product} does for ${PITCH.shop}</h2><div class="grid4">
        <div class="feat rise"><div class="ico">${ICON.chat}</div><h3>Replies in seconds</h3><p>Prices, sizes and offers, 24/7, in your customers' own language.</p></div>
        <div class="feat rise"><div class="ico">${ICON.cart}</div><h3>Takes orders and UPI</h3><p>Payment links inside Instagram. Paid orders confirm themselves.</p></div>
        <div class="feat rise"><div class="ico">${ICON.pin}</div><h3>Checks every address</h3><p>10-digit numbers and real pincodes, verified with India Post.</p></div>
        <div class="feat rise"><div class="ico">${ICON.bell}</div><h3>Sends you what matters</h3><p>COD reviews, team-kit leads and complaints, on your WhatsApp.</p></div>
      </div></div>`,
      { stagger: 380 }
    );
    await sleep(3600);
    mark("product", "What it is");
    await showScene(
      `<div class="hero">${LOGO}<h1 class="rise">${PITCH.product}</h1><p class="rise">The sales assistant for shops that sell in DMs.</p>
        <div class="pills rise"><span class="pill">Works in Instagram</span><span class="pill">Reports on WhatsApp</span><span class="pill go">Built for ${PITCH.shop}</span></div></div>`,
      { stagger: 450 }
    );
    await sleep(3600);
    mark("brand", "Made by Team Coge");
    await showScene(
      `<div class="hero">${LOGO}<h1 class="rise" style="font-size:88px">${PITCH.product}</h1><div class="made rise">Made by <b>${PITCH.team}</b></div>${
        PITCH.contact ? `<div class="made rise">${PITCH.contact}</div>` : ""
      }</div>`,
      { sound: "impact", stagger: 450 }
    );
    await sleep(5200);
    mark("end", "End");
    window.__filmDone = true;
  }

  // A COD order from earlier in the night, for the dashboard scene.
  function seedCodOrder() {
    const V = D.AW33Validate;
    const address = "12 Gandhi St, RS Puram, Coimbatore 641002";
    D.AW33Store.addOrder({
      id: "AW33-" + D.AW33Store.nextOrderNo(),
      product: "Ferrari F1 Jersey", productId: "f1-ferrari", size: "M", version: null, print: null,
      item: 899, delivery: 70, codFee: 50, amount: 1019, payment: "COD", status: "review",
      eta: "same / next day (Coimbatore)", name: "Karthik", phone: "9876543210", address, pincode: "641002",
      check: V.checkAddress(address, { phone: "9876543210", name: "Karthik" }),
      historyText: "Order placed on Instagram at 1:41 AM (COD)",
    });
  }

  // ── start ────────────────────────────────────────────────
  function ready(frame) {
    return new Promise((res) => {
      const ok = () => frame.contentWindow && frame.contentWindow.document.readyState === "complete";
      if (ok()) return res();
      frame.addEventListener("load", () => res(), { once: true });
    });
  }
  let started = false;
  async function start() {
    if (started) return;
    started = true;
    await Promise.all([ready(phonesFrame), ready(dashFrame)]);
    P = phonesFrame.contentWindow;
    D = dashFrame.contentWindow;
    $("start").classList.add("hide");
    await film();
  }
  window.startFilm = start;
  $("start").addEventListener("click", start);
  if (q.get("auto") === "1") setTimeout(start, 800);
})();
