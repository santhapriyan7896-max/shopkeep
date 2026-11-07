// Checks the offline assistant end to end. Run: npm test
import test from "node:test";
import assert from "node:assert/strict";
import "../catalog.js";
import "../validate.js";
import "../bot.js";
import "../scenarios.js";

const B = globalThis.AW33Bot;
function talk(lines) {
  const s = B.newState();
  const all = [];
  for (const l of lines) {
    const r = B.reply(s, typeof l === "string" ? { text: l } : l);
    all.push(r);
  }
  return { s, all, last: all.at(-1), text: all.flatMap((r) => r.messages.map((m) => m.text)).join("\n") };
}

test("every demo scenario runs without errors and says something each turn", () => {
  for (const sc of globalThis.AW33_SCENARIOS) {
    const { all } = talk(sc.steps.filter((st) => st.text).map((st) => ({ text: st.text, sharedProductId: st.share })));
    all.forEach((r, i) => assert.ok(r.messages.length > 0, `${sc.id} step ${i} had no reply`));
  }
});

test("F1 scenario books an order with the right total", () => {
  const sc = globalThis.AW33_SCENARIOS.find((s) => s.id === "f1");
  const { all } = talk(sc.steps.map((s) => s.text));
  const order = all.flatMap((r) => r.events).find((e) => e.type === "order");
  assert.equal(order.productId, "f1-ferrari");
  assert.equal(order.size, "M");
  assert.equal(order.amount, 899 + 70 + 50); // item + delivery + COD
});

test("team order becomes a priority lead with an estimate", () => {
  const sc = globalThis.AW33_SCENARIOS.find((s) => s.id === "team");
  const { all } = talk(sc.steps.map((s) => s.text));
  const lead = all.flatMap((r) => r.events).find((e) => e.type === "lead");
  assert.equal(lead.qty, 15);
  assert.equal(lead.sport, "Football");
  assert.equal(lead.names, true);
});

test("complaints go to a person as urgent", () => {
  const { last } = talk(["received wrong size, need exchange"]);
  assert.equal(last.events[0].type, "handoff");
  assert.equal(last.events[0].priority, "urgent");
});

test("sold-out size is called out", () => {
  const { text } = talk(["liverpool xxl available?"]);
  assert.match(text, /XXL is sold out/);
});

test("shoe sizes, half sizes and delivery questions", () => {
  const { s, text } = talk(["predator size 9.5 delivery to chennai?"]);
  assert.equal(s.size, "UK 9.5");
  assert.match(text, /Chennai – 2–3 days/);
});

test("replies stay plain: no markdown, no salesy filler, at most one emoji per message", () => {
  for (const sc of globalThis.AW33_SCENARIOS) {
    const { all } = talk(sc.steps.filter((st) => st.text).map((st) => ({ text: st.text, sharedProductId: st.share })));
    for (const m of all.flatMap((r) => r.messages)) {
      assert.doesNotMatch(m.text, /\*\*|Great choice|Absolutely|happy to help| — /, `${sc.id}: ${m.text}`);
      const emoji = m.text.match(/\p{Extended_Pictographic}/gu) || [];
      assert.ok(emoji.length <= 1, `${sc.id} has ${emoji.length} emoji: ${m.text}`);
    }
  }
});

test("Tanglish customers get Tanglish back", () => {
  const { text } = talk(["anna csk iruka", "argentina jersey XL iruka"]);
  assert.match(text, /iruku anna/);
});

test("asked if it's a bot, it says so", () => {
  const { text } = talk(["are you a bot?"]);
  assert.match(text, /auto reply/);
});

test("'anywhere in India' does not open the India jersey", () => {
  const { s } = talk(["do you deliver anywhere in india?"]);
  assert.equal(s.product, null);
});

// ── phone, address and payment rules ──────────────────────
const V = globalThis.AW33Validate;

test("10-digit phone checker", () => {
  for (const ok of ["9876543210", "+91 98765 43210", "098765 43210", "91-98765-43210", "6000000001"]) assert.ok(V.checkPhone(ok).ok, ok);
  assert.match(V.checkPhone("987654321").reason, /9 digits/);
  assert.match(V.checkPhone("5876543210").reason, /starts with 5/);
  assert.match(V.checkPhone("9999999999").reason, /dummy/);
  assert.ok(V.checkPhone("no number, 641002").missing);
});

test("address checker: pincode, city match, door number", () => {
  assert.ok(V.checkAddress("12 Gandhi St, RS Puram, Coimbatore 641002").ok);
  const wrongCity = V.checkAddress("5 MG Road, Bangalore 641002");
  assert.equal(wrongCity.cityMatch, false);
  assert.ok(V.checkAddress("7 Main road, Coimbatore 041002").flags.some((f) => /start with 0/.test(f)));
  assert.equal(V.checkAddress("Gandhipuram, Coimbatore 641012").hasDoor, false);
});

test("bad phone and wrong pincode are asked again before payment", () => {
  const sc = globalThis.AW33_SCENARIOS.find((s) => s.id === "checks");
  const { all } = talk(sc.steps.filter((s) => s.text).map((s) => s.text));
  assert.match(all[2].messages[0].text, /9 digits/);
  assert.match(all[3].messages[0].text, /but the address says Bangalore/);
  const order = all.flatMap((r) => r.events).find((e) => e.type === "order");
  assert.equal(order.phone, "9876512345");
  assert.equal(order.pincode, "560038");
});

test("UPI waits for payment, COD goes to review", () => {
  const upi = globalThis.AW33_SCENARIOS.find((s) => s.id === "reel");
  const u = talk(upi.steps.filter((s) => s.text).map((s) => ({ text: s.text, sharedProductId: s.share })));
  assert.equal(u.all.flatMap((r) => r.events).find((e) => e.type === "order").status, "awaiting_payment");
  const cod = globalThis.AW33_SCENARIOS.find((s) => s.id === "f1");
  const c = talk(cod.steps.map((s) => s.text));
  assert.equal(c.all.flatMap((r) => r.events).find((e) => e.type === "order").status, "review");
});
