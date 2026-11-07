// Runs the data layer through the same "postgres" driver used in production (Supabase),
// talking to an in-memory Postgres over the network protocol. The other tests use PGlite
// directly, which didn't catch JSON being saved as text by the real driver.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { openDb } from "../src/db.mjs";
import * as repo from "../src/repo.mjs";

let pg, server, db;
before(async () => {
  pg = await PGlite.create();
  const port = 55000 + Math.floor(Math.random() * 5000);
  server = new PGLiteSocketServer({ db: pg, port, host: "127.0.0.1" });
  await server.start();
  process.env.DB_POOL = "1"; // the test server takes one connection at a time
  db = await openDb({ url: `postgres://postgres@127.0.0.1:${port}/postgres` });
});
after(async () => {
  await db.close();
  await server.stop();
  await pg.close();
});

test("JSON columns come back as objects through the production driver", async () => {
  assert.equal(db.kind, "postgres");
  const { shop } = await repo.createAccount(db, { email: "d@x.test", passwordHash: "x", name: "D", shopName: "Driver Shop" });
  assert.equal(typeof shop.settings, "object");
  assert.equal(shop.settings.payments.upi, true);

  const s2 = await repo.updateShop(db, shop.id, { settings: { ...shop.settings, delivery_fee: 70 } });
  assert.equal(s2.settings.delivery_fee, 70);

  const p = await repo.saveProduct(db, shop.id, null, { name: "Ferrari F1 Jersey", prices: { fan: 599, player: 899 }, sizes: { S: 5, M: 5 }, keywords: "ferrari, f1", post_urls: ["https://instagram.com/p/X/"] });
  assert.deepEqual(p.prices, { fan: 599, player: 899 });
  assert.deepEqual(p.sizes, { S: 5, M: 5 });
  assert.deepEqual(p.keywords, ["ferrari", "f1"]);

  const conv = await repo.upsertConversation(db, shop.id, "test", "c1");
  const m = await repo.addMessage(db, { shopId: shop.id, conversationId: conv.id, direction: "in", sender: "customer", text: "hi", attachments: [{ type: "share", url: "u" }] });
  assert.deepEqual(m.attachments, [{ type: "share", url: "u" }]);

  const o = await repo.createOrder(db, shop.id, { conversationId: conv.id, productId: p.id, productName: p.name, version: "fan", size: "M", quantity: 1, personalization: null, itemTotal: 599, deliveryFee: 70, codFee: 0, total: 669, payment: "UPI", status: "awaiting_payment", customerName: "A", phone: "9876543210", address: "1 St", pincode: "641001", checks: { ok: true, flags: [] } });
  assert.deepEqual(o.checks, { ok: true, flags: [] });
  assert.equal(o.history.length, 1);
  assert.equal((await repo.getProduct(db, shop.id, p.id)).sizes.M, 4, "stock update works on real Postgres");
  const moved = await repo.moveOrder(db, shop.id, o.id, { to: "paid", from: ["awaiting_payment"], note: "Paid" });
  assert.equal(moved.history.length, 2);
  assert.equal(moved.history[1].text, "Paid");

  const lead = await repo.addLead(db, shop.id, conv.id, { summary: "25 kits" });
  assert.equal(lead.data.summary, "25 kits");
});

test("the repair migration fixes rows an earlier version saved as text", async () => {
  const { shop } = await repo.createAccount(db, { email: "r@x.test", passwordHash: "x", name: "R", shopName: "Repair" });
  // Save the way the buggy version did.
  await db.query("update shops set settings = $2::jsonb where id = $1", [shop.id, JSON.stringify({ handle: "old" })]);
  const prod = await db.one("insert into products (shop_id, name, prices, sizes) values ($1, 'P', $2::jsonb, $3::jsonb) returning id", [shop.id, JSON.stringify({ standard: 500 }), JSON.stringify({ L: 3 })]);
  assert.equal(typeof (await repo.getShop(db, shop.id)).settings, "string", "reproduces the bug");

  const fs = await import("node:fs/promises");
  await db.exec(await fs.readFile(new URL("../sql/002_fix_json_saved_as_text.sql", import.meta.url), "utf8"));
  assert.deepEqual((await repo.getShop(db, shop.id)).settings, { handle: "old" });
  const fixed = await repo.getProduct(db, shop.id, prod.id);
  assert.deepEqual(fixed.prices, { standard: 500 });
  assert.deepEqual(fixed.sizes, { L: 3 });
});
