// Offline demo assistant for Activewear33.
// Answers like the shop's own staff would in DMs: short lines, plain words,
// light Tanglish when the customer writes that way, almost no emoji.
// It never claims to be a person — if asked, it says it's the after-hours auto-reply.
// Works in the browser and in Node (for tests). No internet or API key needed.

(function () {
  const C = globalThis.AW33_CATALOG;
  if (!C) throw new Error("catalog.js must be loaded before bot.js");

  const rupee = (n) => "₹" + Number(n).toLocaleString("en-IN");
  const byId = Object.fromEntries(C.products.map((p) => [p.id, p]));
  const SIZE_ORDER = ["S", "M", "L", "XL", "XXL", "3XL", "4XL"];

  // How many products share each keyword (shared keywords like "lakers" are weak).
  const keyCount = {};
  for (const p of C.products) for (const k of p.keys) keyCount[k] = (keyCount[k] || 0) + 1;

  // ── text helpers ───────────────────────────────────────────
  function normalize(raw) {
    return (raw || "")
      .toLowerCase()
      .replace(/[’‘`]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/([a-z])'([a-z])/g, "$1$2") // i'm -> im
      .replace(/([a-z])-([a-z])/g, "$1 $2") // dry-fit -> dry fit
      .replace(/\s+/g, " ")
      .trim();
  }
  const has = (t, re) => re.test(t);
  const wordRe = (w) => new RegExp("(^|[^a-z0-9])" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?=$|[^a-z0-9])");
  const cap = (x) => (x ? x[0].toUpperCase() + x.slice(1) : x);

  const TANGLISH = /\b(anna|da|iruka|irukka|iruku|irukku|irukaa|evlo|evvalo|evvalavu|venum|vennum|vendum|pannanum|pannunga|panunga|sollunga|enna|eppo|kedaikuma|kidaikuma|machan|nanba|thambi|enaku|enakku|ah|ahh|ga|edhu|endha)\b/;

  // ── entity extraction ──────────────────────────────────────
  function findProducts(t) {
    const strong = new Set();
    const weak = new Set();
    for (const p of C.products) {
      for (const k of p.keys) {
        if (wordRe(k).test(t)) (keyCount[k] > 1 ? weak : strong).add(p.id);
      }
    }
    return strong.size ? [...strong] : [...weak];
  }

  function findCategory(t) {
    for (const [id, cat] of Object.entries(C.categories)) {
      if (cat.words.some((w) => wordRe(w).test(t))) return id;
    }
    return null;
  }

  function findSize(t, product) {
    if (product && product.shoe) {
      const m = t.match(/\buk\s?(\d{1,2}(?:\.5)?)/) || t.match(/\bsize\s?(\d{1,2}(?:\.5)?)/) || t.match(/^(\d{1,2}(?:\.5)?)$/);
      return m ? "UK " + m[1] : null;
    }
    if (/\b(4xl|xxxxl)\b/.test(t)) return "4XL";
    if (/\b(3xl|xxxl)\b/.test(t)) return "3XL";
    if (/\b(xxl|2xl|double xl)\b/.test(t)) return "XXL";
    if (/\b(xl|extra large)\b/.test(t)) return "XL";
    if (/\b(xs|extra small)\b/.test(t)) return "S";
    if (/\b(l|large)\b/.test(t)) return "L";
    if (/\b(m|medium)\b/.test(t)) return "M";
    if (/\b(s|small)\b/.test(t)) return "S";
    return null;
  }

  function findBody(raw) {
    const t = (raw || "").toLowerCase();
    let cm = null;
    let kg = null;
    const ft = t.match(/(\d)\s*(?:'|’|ft|feet|foot)\s*(\d{1,2})?/);
    if (ft) cm = Math.round(Number(ft[1]) * 30.48 + Number(ft[2] || 0) * 2.54);
    const cmM = t.match(/(\d{3})\s*cm/);
    if (cmM) cm = Number(cmM[1]);
    const kgM = t.match(/(\d{2,3})\s*(?:kg|kgs|kilo)/);
    if (kgM) kg = Number(kgM[1]);
    return { cm, kg };
  }

  function recommendSize({ cm, kg }) {
    const order = ["S", "M", "L", "XL", "XXL"];
    let i;
    if (kg) i = kg <= 55 ? 0 : kg <= 65 ? 1 : kg <= 76 ? 2 : kg <= 86 ? 3 : 4;
    else if (cm) i = cm < 165 ? 0 : cm < 172 ? 1 : cm < 180 ? 2 : 3;
    else return null;
    if (cm && cm >= 185 && i < 4) i++;
    return order[i];
  }

  function findVersion(t, product) {
    if (!product || !product.versions) return null;
    const v = Object.keys(product.versions);
    if (v.includes("player") && /\b(player|authentic|match)\b/.test(t)) return "player";
    if (v.includes("fan") && /\b(fan|normal|regular)\b/.test(t)) return "fan";
    if (v.includes("set") && /\b(set|shorts|full kit)\b/.test(t)) return "set";
    if (v.includes("jersey") && /\b(jersey only|only jersey|just (the )?jersey)\b/.test(t)) return "jersey";
    return null;
  }

  // ── product helpers ────────────────────────────────────────
  const VERSION_LABELS = { fan: "fan version", player: "player version", set: "set with shorts", jersey: "jersey only" };
  const versionLabel = (v) => VERSION_LABELS[v] || v || "";
  const priceOf = (p, v) => (p.versions ? p.versions[v] ?? Math.min(...Object.values(p.versions)) : p.price);
  const fromPrice = (p) => (p.versions ? Math.min(...Object.values(p.versions)) : p.price);
  const inStock = (p) => Object.entries(p.sizes).filter(([, n]) => n > 0).map(([s]) => s);
  const soldOut = (p) => Object.entries(p.sizes).filter(([, n]) => n === 0).map(([s]) => s);

  function sizesText(p) {
    const avail = inStock(p);
    const all = Object.keys(p.sizes);
    if (avail.length >= 3 && avail.length === all.length) return `${avail[0]} to ${avail[avail.length - 1]}`;
    return avail.join(", ");
  }

  function cityInfo(t) {
    const S = C.shop.shipping;
    if (/\b(coimbatore|kovai|cbe|pappanaickenpalayam|pn palayam|rs puram|gandhipuram|peelamedu|saibaba colony)\b/.test(t)) return { city: "Coimbatore", eta: S.local };
    const tn = t.match(/\b(chennai|madurai|trichy|tiruchirappalli|salem|erode|tirupur|tiruppur|vellore|thanjavur|karur|namakkal|dindigul|pollachi|ooty|hosur|tirunelveli|nagercoil)\b/);
    if (tn) return { city: cap(tn[1]), eta: S.state };
    const ind = t.match(/\b(bangalore|bengaluru|kochi|kerala|hyderabad|mumbai|delhi|pune|kolkata|mysore|palakkad|trivandrum)\b/);
    if (ind) return { city: cap(ind[1]), eta: S.india };
    return null;
  }

  // ── state ──────────────────────────────────────────────────
  function newState(opts = {}) {
    return {
      product: null, candidates: [], version: null, size: null, print: null,
      awaiting: null, stage: null, order: {}, team: {}, shown: {},
      tanglish: false, addr: "", orderSeq: opts.orderSeq || 1042, views: {}, greeted: false,
    };
  }

  function resetProduct(s, id) {
    if (s.product !== id) {
      s.product = id;
      s.version = null;
      s.print = null;
      // Keep the size when it fits: customers say "M" once and expect it to carry over.
      const p = byId[id];
      const sizes = Object.keys(p.sizes);
      if (sizes.length === 1) s.size = sizes[0];
      else if (s.size && !(s.size in p.sizes)) s.size = null;
    }
    s.candidates = [];
    s.views[id] = (s.views[id] || 0) + 1;
  }

  // ── intent tests ───────────────────────────────────────────
  const QTY_RE = /\b(\d{1,3})\s+(?:[a-z]+\s+){0,2}(jerseys?|kits?|sets?|players|pcs|pieces|nos|members|t ?shirts|people)\b/;
  const I = {
    complaint: /\b(damaged|torn|defect|defective|wrong (size|item|product|jersey|colou?r)|got (the )?wrong|received wrong|not received|didnt receive|havent received|never received|complaint|cheat|cheated|fake product|worst|refund|still not (came|come|received|delivered)|late delivery|missing)\b/,
    tracking: /\b(where is my order|order status|track(ing)?|when will (my order|it) (come|arrive|reach)|my order)\b/,
    human: /\b(talk to|speak to|call me|real person|owner|manager|customer care|someone from)\b/,
    botQ: /\b(are you (a )?(bot|robot|human|real|person|ai)|is this (a )?(bot|ai|automated|auto reply)|bot ah|robot ah)\b/,
    team: /\b(team order|team kit|team kits|team jersey|team jerseys|our team|college team|school team|club order|tournament|academy|corporate|company (tshirts|t shirts|jerseys)|bulk|custom (kit|kits|jersey|jerseys|design)|own design|our logo|sublimation)\b/,
    store: /\b(shop|store|showroom|location|address|where are you|visit|come (and|to|over|directly)|direct(ly)? (come|visit)|offline|try (it|them|on)|timing|timings|open (now|today|tomorrow)|opening)\b/,
    sizeHelp: /\b(which size|what size|size (help|guide|chart)|my size|fit me|will fit|size suggest)\b/,
    cod: /\b(cod|cash on delivery|cash)\b/,
    delivery: /\b(deliver|delivery|shipping|ship|courier|how many days|when will i get|reach|days)\b/,
    exchange: /\b(exchange|return|replace|replacement)\b/,
    offers: /\b(offer|offers|discount|sale|deal|deals|combo|diwali)\b/,
    contact: /\b(phone|number to call|contact|call you|mobile|whatsapp)\b/,
    price: /\b(price|prices|rate|cost|how much|evlo|evvalo|evvalavu|amount|rs)\b|₹|\?\?/,
    avail: /\b(available|availability|stock|iruka|irukka|iruku|irukku|irukaa|have|kedaikuma|kidaikuma)\b/,
    order: /\b(order|buy|book|booking|confirm|venum|vendum|vennum|pannanum|i want|want it|ill take|take it|need it|send it|place (the )?order|proceed)\b/,
    yes: /^(yes|yeah|yep|yup|ok|okay|ok da|sure|done|s|ss|haan|aama|seri|sari|confirm)\b/,
    no: /^(no|nope|not now|later|vendam|venam)\b/,
    print: /\b(name and number|name & number|name number|print|printing|customi[sz]e)\b/,
    colours: /\b(colou?rs?|other colou?r)\b/,
    greeting: /^(hi+|hello|hey|hai|vanakkam|good (morning|evening|night|afternoon)|helo)\b[!. ]*(anna|bro|sir|da)?[!. ]*$/,
    thanks: /^(thanks|thank you|thx|tq|ty|nandri|super|great|cool)\b/,
  };

  // ── reply builder ──────────────────────────────────────────
  function reply(state, input) {
    const s = state;
    const out = [];
    const events = [];
    const raw = (input && input.text) || "";
    const t = normalize(raw);
    if (TANGLISH.test(t)) s.tanglish = true;
    const addrM = t.match(/\b(anna|bro|sir|machan)\b/);
    if (addrM) s.addr = addrM[1] === "machan" ? "bro" : addrM[1];
    const tg = s.tanglish;
    const a = s.addr ? " " + s.addr : "";
    const say = (text) => out.push({ text });
    const done = () => ({ messages: out, events });

    if (input && input.sharedProductId && byId[input.sharedProductId]) resetProduct(s, input.sharedProductId);

    // Honest about being automated.
    if (has(t, I.botQ)) {
      say(`This is Activewear33's after-hours auto reply 🙂 I can help with price, sizes and orders.`);
      say(`Our team is online from 9 AM for anything else.`);
      return done();
    }

    // 1) Complaints / tracking / "talk to someone" → the team.
    if (has(t, I.complaint) || has(t, I.tracking) || has(t, I.human)) {
      const urgent = has(t, I.complaint);
      s.stage = null;
      s.awaiting = null;
      if (urgent) {
        say(tg ? `Sorry${a} 🙏 Team ku inform panniten, morning first thing contact pannuvanga.` : `Sorry for the trouble 🙏 I've informed our team, they'll contact you first thing in the morning.`);
        say(tg ? `Product photo and order number anuppunga.` : `Please send a photo of the product and your order number.`);
      } else {
        say(tg ? `Team ku solliten${a}, morning update pannuvanga.` : `I've passed this to our team, they'll update you in the morning.`);
      }
      events.push({ type: "handoff", priority: urgent ? "urgent" : "normal", summary: raw.slice(0, 140) });
      return done();
    }

    // 2) Continue a flow we're in the middle of.
    if (s.stage && s.stage.startsWith("order_")) {
      if (continueOrder(s, raw, t, say, events)) return done();
    }
    if (s.stage && s.stage.startsWith("team_")) {
      continueTeam(s, raw, t, say, events);
      return done();
    }
    if (s.awaiting === "print") {
      const m = raw.match(/([A-Za-z][A-Za-z .]{1,14}?)\s*[#-]?\s*(\d{1,2})\b/);
      if (m) {
        s.print = `${m[1].trim().toUpperCase()} ${m[2]}`;
        s.awaiting = null;
        say(tg ? `Ok, ${s.print} print panniduvom.` : `Ok, ${s.print} on the back.`);
        askNext(s, say);
        return done();
      }
    }

    // 3) Team / custom kit enquiry.
    const qtyMatch = t.match(QTY_RE);
    if (has(t, I.team) || (qtyMatch && Number(qtyMatch[1]) >= C.teamwear.minQty)) {
      startTeam(s, raw, t, say, events);
      return done();
    }

    // 4) Pull out everything the customer told us.
    const found = findProducts(t);
    const category = findCategory(t);
    if (found.length === 1) resetProduct(s, found[0]);
    else if (found.length > 1) {
      if (s.product && found.includes(s.product) && !wordRe("or").test(t)) resetProduct(s, s.product);
      else s.candidates = found;
    }
    const p = s.candidates.length > 1 || !s.product ? null : byId[s.product];
    const size = findSize(t, p || (found.length ? byId[found[0]] : null));
    if (size) s.size = size;
    if (p) {
      const v = findVersion(t, p);
      if (v) s.version = v;
    }
    const body = findBody(raw);
    const rec = body.cm || body.kg ? recommendSize(body) : null;
    if (rec && !(p && p.shoe)) s.size = rec;
    const sizeAdvice = () => {
      const who = `${body.cm ? fmtHeight(body.cm) : ""}${body.cm && body.kg ? " and " : ""}${body.kg ? body.kg + " kg" : ""}`;
      say(tg ? `${who} ku ${rec} correct ah irukum${a}.` : `For ${who}, ${rec} will fit you well.`);
    };

    // 5) Answer.
    let answered = false;

    if (I.greeting.test(t) && !found.length && !category) {
      say(tg || s.addr ? `Hi${a}! Thanks for reaching out to Activewear33 😊` : `Hi! Thanks for reaching out to Activewear33 😊`);
      say(tg ? `Product name illa screenshot anuppunga, price and size solren.` : `Send the product name or a screenshot, I'll tell you the price and sizes.`);
      return done();
    }

    if (I.thanks.test(t) && !found.length) {
      say(tg ? `Thank you${a} 🙏` : `Welcome 😊`);
      return done();
    }

    // Several products named ("Ferrari or Mercedes") → compare and ask.
    if (s.candidates.length > 1) {
      const list = s.candidates.map((id) => byId[id]);
      if (rec) sizeAdvice();
      const two = list.length === 2;
      const lines = list.map((x) => `${x.short} (${x.colour.toLowerCase()}) – ${x.versions ? "from " : ""}${rupee(fromPrice(x))}`);
      say(`${two ? (tg ? `Rendum iruku${a}` : "Both available") : "Available:"}\n${lines.join("\n")}`);
      say(tg ? `Edhu venum?${s.size ? "" : " Size um sollunga."}` : `Which one do you like?${s.size ? "" : " And your size?"}`);
      for (const x of list) {
        s.views[x.id] = (s.views[x.id] || 0) + 1;
        s.shown[x.id] = true;
      }
      return done();
    }

    // Category only ("F1 jersey") → list that category.
    if (!p && category) {
      const list = C.products.filter((x) => x.category === category);
      const lines = list.map((x) => `${x.short} – ${x.versions ? "from " : ""}${rupee(fromPrice(x))}`);
      const sameSizes = list.every((x) => sizesText(x) === sizesText(list[0]));
      say(`${C.categories[category].label} available now:\n${lines.join("\n")}`);
      say(`${sameSizes && !list[0].shoe ? `Sizes ${sizesText(list[0])}. ` : ""}${tg ? "Edhu venum?" : "Which one?"}`);
      return done();
    }

    // Store visit / location.
    if (has(t, I.store) && !has(t, I.delivery)) {
      say(`Shop address: ${C.shop.address}\n(${C.shop.landmark})\nTimings: ${C.shop.storeHours.replace(", all days", "")}\nPh: ${C.shop.phone}`);
      say(`Location: ${C.shop.mapsUrl}`);
      if (p) {
        // They're coming in person: price + stock + "kept aside", no sales push.
        s.shown[p.id] = true;
        if (s.size && p.sizes[s.size] > 0) {
          say(`${p.short} – ${rupee(fromPrice(p))}. ${stockLine(p, s.size, tg, a)}`);
          say(tg ? `Vaanga${a}! ${s.size} eduthu vekka solren 👍` : `Come anytime, I'll ask the team to keep ${s.size} aside for you 👍`);
        } else {
          say(`${p.short} – ${rupee(fromPrice(p))}. Sizes: ${sizesText(p)}`);
          say(tg ? `Size sollunga, eduthu vekka solren.` : `Tell me your size, I'll ask the team to keep one aside.`);
        }
        return done();
      }
      answered = true;
    }

    // Size help.
    if (rec && !(p && p.shoe)) {
      sizeAdvice();
      if (p && p.versions && p.versions.player)
        say(tg ? `Player version slim fit, loose venum na ${nextSize(rec)} edunga.` : `Player version is slim fit, take ${nextSize(rec)} if you like it loose.`);
      answered = true;
    } else if (has(t, I.sizeHelp) && !size) {
      if (p && p.shoe) say(`Take your normal shoe size (UK). If you're between sizes, go half a size up.`);
      else say(tg ? `Height and weight sollunga, correct size solren.` : `Send your height and weight, I'll suggest the right size.`);
      return done();
    }

    // Product details / price / stock.
    if (p) {
      const firstTime = !s.shown[p.id];
      const wantsDetails = firstTime || has(t, I.price) || (input && input.sharedProductId);
      if (wantsDetails) {
        productDetails(p, say, tg);
        s.shown[p.id] = true;
        answered = true;
      }
      if (size || (rec && !p.shoe) || (found.length === 1 && s.size && p.sizes[s.size] !== undefined)) {
        say(stockLine(p, s.size, tg, a));
        answered = true;
      } else if (has(t, I.avail) && !wantsDetails) {
        say(tg ? `${sizesText(p)} iruku.` : `${sizesText(p)} available.`);
        answered = true;
      }
      if (has(t, I.colours)) {
        say(`${p.short} comes in ${p.colour.toLowerCase()}.`);
        answered = true;
      }
      if (has(t, I.print) && p.print) {
        s.awaiting = "print";
        say(tg ? `Name, number print ${rupee(C.shop.printPrice)} extra. Enna name, number?` : `Name and number printing is ${rupee(C.shop.printPrice)} extra. What name and number?`);
        return done();
      }
    }

    // Policies.
    if (has(t, I.cod)) {
      say(tg ? `COD iruku${a}, ${rupee(C.shop.codFee)} extra. UPI um ok.` : `COD available, ${rupee(C.shop.codFee)} extra. UPI also ok.`);
      answered = true;
    }
    if (has(t, I.delivery)) {
      const c = cityInfo(t);
      const S = C.shop.shipping;
      const fee = tg ? `${rupee(S.freeAbove)} mela free delivery, illana ${rupee(S.charge)}.` : `Free delivery above ${rupee(S.freeAbove)}, otherwise ${rupee(S.charge)}.`;
      if (c) say(tg ? `${c.city} ku ${c.eta} la varum. ${fee}` : `${c.city} – ${c.eta}. ${fee}`);
      else say(`Coimbatore – ${S.local}\nTamil Nadu – ${S.state}\nOther states – ${S.india}\n${fee}`);
      answered = true;
    }
    if (has(t, I.exchange)) {
      say(`Yes, ${C.shop.exchange}.`);
      answered = true;
    }
    if (has(t, I.offers)) {
      say(`Diwali offer going on:\n${C.shop.offers.join("\n")}`);
      answered = true;
    }
    if (has(t, I.contact) && !p) {
      say(`Ph: ${C.shop.phone} (${C.shop.staffHours}). You can also ask here anytime.`);
      answered = true;
    }

    // Wants to buy.
    const wantsOrder = has(t, I.order) || (s.awaiting === "confirm_book" && I.yes.test(t));
    if (s.awaiting === "confirm_book" && I.no.test(t)) {
      s.awaiting = null;
      say(tg ? `Seri${a}, eppo venumnalum message pannunga 👍` : `No problem. Message anytime 👍`);
      return done();
    }
    if (wantsOrder && p) {
      if (missing(s, p)) askNext(s, say);
      else {
        s.stage = "order_details";
        s.awaiting = null;
        say(tg ? `Sure${a} 👍 Name, phone number, full address with pincode anuppunga.` : `Sure 👍 Please send your name, phone number and full address with pincode.`);
      }
      return done();
    }

    if (p && (answered || findVersion(t, p) || size || found.length === 1)) {
      askNext(s, say);
      return done();
    }
    if (answered) return done();

    // Nothing matched.
    if (has(t, I.price) || has(t, I.avail)) say(tg ? `Endha product${a}? Name illa screenshot anuppunga.` : `Which product? Send the name or a screenshot.`);
    else say(tg ? `Puriyala${a} 🙂 Product name illa screenshot anuppunga. Vera edhavathu na morning team reply pannuvanga.` : `Sorry, didn't get that. Can you send the product name or a screenshot? For anything else, our team will reply in the morning.`);
    return done();
  }

  function productDetails(p, say, tg) {
    if (p.versions) {
      const lines = Object.entries(p.versions).map(([v, pr]) => `${cap(versionLabel(v))} – ${rupee(pr)}`);
      say(`${p.name}\n${lines.join("\n")}`);
    } else {
      say(`${p.name} – ${rupee(p.price)}`);
    }
    const extra = [];
    if (Object.keys(p.sizes).length > 1) extra.push(`Sizes: ${sizesText(p)}${soldOut(p).length ? ` (${soldOut(p).join(", ")} sold out)` : ""}`);
    if (p.print) extra.push(tg ? `Name, number print venum na ${rupee(C.shop.printPrice)} extra` : `Name & number printing ${rupee(C.shop.printPrice)} extra`);
    if (p.note) extra.push(p.note);
    if (p.versions && (p.category === "club" || p.category === "country")) extra.push(`Diwali combo offer if you take 3–4 jerseys`);
    if (extra.length) say(extra.join("\n"));
  }

  function stockLine(p, size, tg, a) {
    const n = p.sizes[size];
    const avail = inStock(p).join(", ");
    if (size === "One size") return n > 0 ? (tg ? `Stock iruku${a} 👍` : `Available 👍`) : `Sorry, sold out right now.`;
    if (n === undefined) return `Sorry, ${size} is not there in this one. ${avail} available.`;
    if (n === 0) return tg ? `Sorry${a}, ${size} sold out. ${avail} iruku.` : `Sorry, ${size} is sold out in this one. ${avail} available.`;
    const unit = p.shoe ? (n === 1 ? "pair" : "pairs") : "left";
    if (n <= 2) return tg ? `${size} iruku, but only ${n}${p.shoe ? " " + unit : ""} left.` : `${size} available, only ${n} ${p.shoe ? unit + " " : ""}left.`;
    return tg ? `${size} iruku${a} 👍` : `${size} available 👍`;
  }

  function nextSize(sz) {
    return SIZE_ORDER[Math.min(SIZE_ORDER.indexOf(sz) + 1, SIZE_ORDER.length - 1)];
  }
  function fmtHeight(cm) {
    const inches = Math.round(cm / 2.54);
    return `${Math.floor(inches / 12)}'${inches % 12}"`;
  }
  function missing(s, p) {
    if (!s.size || !p.sizes[s.size]) return "size";
    if (p.versions && !s.version) return "version";
    return null;
  }

  // Ask the one next question that moves the sale forward.
  function askNext(s, say) {
    const p = byId[s.product];
    if (!p) return;
    const tg = s.tanglish;
    const m = missing(s, p);
    if (m === "size") {
      say(p.shoe ? (tg ? "Enna UK size?" : "Which UK size?") : tg ? "Enna size venum?" : "Which size do you need?");
      s.awaiting = "size";
    } else if (m === "version") {
      const opts = Object.entries(p.versions).map(([v, pr]) => `${versionLabel(v)} ${rupee(pr)}`);
      let q;
      if (tg) q = opts.length === 2 ? `${cap(opts[0])} ah, ${opts[1]} ah?` : `${cap(opts.join(", "))} – edhu venum?`;
      else q = opts.length === 2 ? `${cap(opts[0])} or ${opts[1]}?` : `${cap(opts.slice(0, -1).join(", "))}, or ${opts.at(-1)}?`;
      say(q);
      s.awaiting = "version";
    } else {
      const total = priceOf(p, s.version) + (s.print ? C.shop.printPrice : 0);
      const what = `${p.name}, ${s.size === "One size" ? "" : "size " + s.size}${s.version ? ", " + versionLabel(s.version) : ""}${s.print ? ", " + s.print : ""}`.replace(/, $/, "");
      say(`${what} – ${rupee(total)}\n${tg ? "Book pannatuma?" : "Shall I book it?"}`);
      s.awaiting = "confirm_book";
    }
  }

  // ── order flow ─────────────────────────────────────────────
  // Steps: details → (phone fix) → (pincode / address fix) → (door no.) → payment.
  // UPI: order waits for payment, then confirms itself. COD: goes to the team for review.
  function continueOrder(s, raw, t, say, events) {
    const V = globalThis.AW33Validate;
    const tg = s.tanglish;
    const o = s.order;

    if (s.stage === "order_details") {
      if (/\?$/.test(t) && raw.length < 60) return false; // a question — answer it normally
      const ph = V.checkPhone(raw);
      const name = raw.split(/[,\n]/)[0].replace(/^(my name is|name[:\s]*|i am|im)\s*/i, "").trim();
      s.order = { name: /\d/.test(name) ? "" : name.slice(0, 40), phone: ph.ok ? ph.phone : null, address: raw.trim() };
      return nextOrderStep(s, say, ph);
    }
    if (s.stage === "order_phone") {
      const ph = V.checkPhone(raw);
      if (ph.ok) o.phone = ph.phone;
      return nextOrderStep(s, say, ph);
    }
    if (s.stage === "order_pincode") {
      const m = raw.match(/\d[\d\s]{4,7}\d/);
      if (m) o.address = o.address.replace(/\b\d{3}\s?\d{3}\b/g, "").trim().replace(/,$/, "") + ", " + m[0].replace(/\s/g, "");
      return nextOrderStep(s, say);
    }
    if (s.stage === "order_door") {
      o.address = raw.trim() + ", " + o.address;
      o.doorAsked = true;
      return nextOrderStep(s, say);
    }
    if (s.stage === "order_payment") {
      let pay = null;
      if (/\b(cod|cash)\b/.test(t)) pay = "COD";
      else if (/\b(upi|gpay|g pay|google pay|phonepe|phone pe|paytm|bhim|online|prepaid|card)\b/.test(t)) pay = "UPI";
      if (!pay) {
        say("COD or UPI?");
        return true;
      }
      placeOrder(s, pay, say, events, tg);
      return true;
    }
    return false;
  }

  // Ask for whatever is still missing or wrong; otherwise move to payment.
  function nextOrderStep(s, say, phoneCheck) {
    const V = globalThis.AW33Validate;
    const tg = s.tanglish;
    const o = s.order;
    if (!o.phone) {
      s.stage = "order_phone";
      if (phoneCheck && !phoneCheck.missing)
        say(tg ? `Number correct ah illa (${phoneCheck.reason}). 10 digit mobile number anuppunga.` : `That number ${phoneCheck.reason}. Please send a 10 digit mobile number (starting with 6, 7, 8 or 9).`);
      else say(tg ? `10 digit mobile number anuppunga.` : `Please send your 10 digit mobile number.`);
      return true;
    }
    const chk = V.checkAddress(o.address, { phone: o.phone, name: o.name });
    o.check = chk;
    if (!chk.pinOk) {
      s.stage = "order_pincode";
      say(chk.pincode ? (tg ? `Pincode ${chk.pincode} correct ah illa. Check panni anuppunga?` : `Pincode ${chk.pincode} doesn't look right. Can you check and send it again?`) : tg ? "Pincode sollunga?" : "Pincode please?");
      return true;
    }
    if (chk.cityMatch === false && !o.cityAsked) {
      o.cityAsked = true;
      s.stage = "order_pincode";
      say(tg ? `Pincode ${chk.pincode} ${chk.area || chk.state} la iruku, but address la ${chk.city} nu iruku. Correct pincode anuppunga?` : `Pincode ${chk.pincode} is in ${chk.area || chk.state}, but the address says ${chk.city}. Can you send the correct pincode?`);
      return true;
    }
    if (!chk.hasDoor && !o.doorAsked) {
      s.stage = "order_door";
      say(tg ? `Door number / house number um anuppunga, courier ku venum.` : `Please add your door / house number, the courier needs it.`);
      return true;
    }
    o.pincode = chk.pincode;
    s.stage = "order_payment";
    say(tg ? `Address ok 👍 COD ah, UPI ah?` : `Got it 👍 COD or UPI?`);
    return true;
  }

  function placeOrder(s, pay, say, events, tg) {
    const p = byId[s.product];
    const a = s.addr ? " " + s.addr : "";
    const S = C.shop.shipping;
    const o = s.order;
    const item = priceOf(p, s.version) + (s.print ? C.shop.printPrice : 0);
    const ship = item >= S.freeAbove ? 0 : S.charge;
    const cod = pay === "COD" ? C.shop.codFee : 0;
    const total = item + ship + cod;
    const id = "AW33-" + s.orderSeq++;
    const pin = o.pincode || "";
    const eta = pin.startsWith("641") || pin.startsWith("642") ? `${S.local} (Coimbatore)` : /^6[0-4]/.test(pin) ? S.state : S.india;
    // Clean delivery address: drop the name and any phone-number-looking parts
    const address = o.address.split(",").map((x) => x.trim()).filter((x) => x && x !== o.name && !/^(sorry\s*)?\+?[\d\s-]{8,}$/i.test(x)).join(", ");
    const what = `${p.name} – ${s.size}${s.version ? ", " + versionLabel(s.version) : ""}${s.print ? ", " + s.print : ""}`;
    const sum = ship || cod ? `${rupee(item)}${ship ? ` + ${rupee(ship)} delivery` : ""}${cod ? ` + ${rupee(cod)} COD` : ""} = ${rupee(total)}` : `${rupee(total)} (free delivery)`;

    if (pay === "UPI") {
      say(`Order ${id}\n${what}\n${sum}`);
      say(tg ? `Keezha irukura link la pay pannunga, payment aana udane order confirm aagidum 👇` : `Pay using the link below – your order is confirmed as soon as the payment goes through 👇`);
    } else {
      say(`Order placed ✅ ${id}\n${what}\n${sum} (pay on delivery)\nDelivery: ${eta}`);
      say(tg ? `COD orders ah team verify panni morning confirm pannuvanga. Thank you${a}!` : `For COD orders our team verifies the details and confirms by morning. Thank you!`);
    }
    events.push({
      type: "order", id, product: p.name, productId: p.id, size: s.size,
      version: s.version ? versionLabel(s.version) : null, print: s.print,
      item, delivery: ship, codFee: cod, amount: total, payment: pay, eta,
      status: pay === "UPI" ? "awaiting_payment" : "review",
      name: o.name, phone: o.phone, address, pincode: o.pincode, check: o.check,
    });
    s.stage = null;
    s.awaiting = null;
    s.print = null;
  }

  // ── team / custom kit flow ─────────────────────────────────
  const SPORTS = ["football", "cricket", "basketball", "volleyball", "kabaddi", "hockey", "throwball", "badminton", "running", "futsal"];

  function readTeamBits(s, raw, t) {
    const tm = s.team;
    const sp = SPORTS.find((x) => wordRe(x).test(t));
    if (sp && !tm.sport) tm.sport = cap(sp);
    const q = t.match(QTY_RE);
    if (q && !tm.qty && Number(q[1]) >= 2) tm.qty = Number(q[1]);
    if (!tm.design) {
      if (/\b(own design|our design|our logo|with logo|logo|custom design)\b/.test(t)) tm.design = "own design with logo";
      else if (/\b(club style|replica|like (real madrid|barcelona|barca|argentina|csk|india))\b/.test(t)) tm.design = "club style design";
      else if (/\b(design help|need design|you design|no design)\b/.test(t)) tm.design = "needs design help";
    }
    if (tm.names === undefined) {
      if (/\b(with|plus|and|\+)\s*(names?|name and number|names and numbers|numbers)\b|\bnames? (and|&) numbers?\b/.test(t)) tm.names = true;
      else if (s.stage === "team_names" && /^(no|without|plain|venam|vendam)/.test(t)) tm.names = false;
      else if (s.stage === "team_names" && /^(yes|yeah|yep|ok|sure|s|need|with|venum|aama)/.test(t)) tm.names = true;
    }
    if (!tm.deadline) {
      const d = raw.match(/\b(?:by|before|on|within)\s+([^,.!?\n]{2,25})/i);
      if (d && !/\b(team|college|school|club)\b/i.test(d[1])) tm.deadline = d[1].trim();
      else {
        const w = t.match(/\b(urgent|asap|this week|next week|1 week|2 weeks|one week|two weeks|not urgent)\b/);
        if (w) tm.deadline = w[1];
      }
    }
  }

  function startTeam(s, raw, t, say, events) {
    const tg = s.tanglish;
    const a = s.addr ? " " + s.addr : "";
    s.team = {};
    s.stage = "team_sport";
    readTeamBits(s, raw, t);
    say(tg ? `Yes${a}, custom team kits pannuvom – logo, names, numbers ellam 👍` : `Yes, we do custom team kits – your logo, names and numbers 👍`);
    askTeam(s, say, events, true);
  }

  function continueTeam(s, raw, t, say, events) {
    const tm = s.team;
    const stage = s.stage;
    readTeamBits(s, raw, t);
    if (stage === "team_sport" && !tm.sport) tm.sport = cap(raw.trim().slice(0, 30));
    if (stage === "team_qty" && !tm.qty) {
      const n = t.match(/\d+/);
      if (n) tm.qty = Number(n[0]);
    }
    if (stage === "team_design" && !tm.design) tm.design = raw.trim().slice(0, 50).toLowerCase();
    if (stage === "team_names" && tm.names === undefined) tm.names = !/^(no|without)/.test(t);
    if (stage === "team_deadline" && !tm.deadline) tm.deadline = raw.trim().slice(0, 30);
    if (stage === "team_contact" && !tm.contact) tm.contact = raw.trim().slice(0, 80);
    askTeam(s, say, events, false);
  }

  function askTeam(s, say, events, first) {
    const tm = s.team;
    const tg = s.tanglish;
    const lead = first ? (tg ? "Konjam details sollunga – " : "Few details please – ") : "";
    const ask = (q) => say(lead + (first ? q[0].toLowerCase() + q.slice(1) : q));
    if (!tm.sport) {
      s.stage = "team_sport";
      return ask(tg ? "Endha sport?" : "Which sport?");
    }
    if (!tm.qty) {
      s.stage = "team_qty";
      return ask(tg ? "Evlo sets venum?" : "How many sets?");
    }
    if (!tm.design) {
      s.stage = "team_design";
      return ask("Your own design with logo, or a club style design?");
    }
    if (tm.names === undefined) {
      s.stage = "team_names";
      return ask("Names and numbers on the back? It's free for team orders.");
    }
    if (!tm.deadline) {
      s.stage = "team_deadline";
      return ask(tg ? "Eppo venum?" : "When do you need it by?");
    }
    if (!tm.contact) {
      s.stage = "team_contact";
      return ask("Team name and a contact person name?");
    }
    const W = C.teamwear;
    const lo = tm.qty * W.perSetLow;
    const hi = tm.qty * W.perSetHigh;
    say(
      [
        "Noted 👍",
        `${tm.sport} – ${tm.qty} sets`,
        `${cap(tm.design)}${tm.names ? ", names & numbers" : ""}`,
        `Needed by ${tm.deadline}`,
        `Approx ${rupee(lo)} – ${rupee(hi)} (${rupee(W.perSetLow)}–${W.perSetHigh} per set, depends on fabric)`,
      ].join("\n")
    );
    say(tg ? `Naalaiku morning team call panni design and final price solluvanga.` : `Our team will call you tomorrow morning with the design and final price.`);
    events.push({ type: "lead", ...tm, estimateLow: lo, estimateHigh: hi });
    s.stage = null;
    s.team = {};
  }

  globalThis.AW33Bot = { newState, reply, normalize, findProducts, findSize, recommendSize, catalog: C };
})();
