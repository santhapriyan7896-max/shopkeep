# Shopkeep

A sales assistant for small shops that sell through Instagram DMs. It answers every DM from the shop's own catalogue, takes the order, sends a UPI payment link, checks the delivery address, and gives the owner a morning summary on WhatsApp.

Live site and demo: https://shopkeep-j2d1.onrender.com

## What it does

- **Answers DMs.** Price, sizes, stock, COD, delivery time, store address. It replies in the customer's language (English or light Tanglish) and waits a few seconds so two or three messages in a row get one answer.
- **Takes orders.** Collects size, name, phone and address, then books the order through a tool call.
- **Collects payment.** UPI orders get a Razorpay payment link inside the chat. A signed Razorpay webhook confirms the order and DMs the customer. COD orders wait for the owner to confirm.
- **Checks addresses.** 10-digit mobile starting 6-9, a real pincode, the city matching the pincode, a door number. The customer is asked to fix only the part that's wrong.
- **Hands off.** Complaints, refunds and anything it can't answer go to the owner's inbox. When someone from the shop replies, the assistant stays out of that chat.
- **Owner app.** Inbox, orders, products, bulk-order enquiries, and a test chat to try the assistant before going live.

## How it's built

```
Instagram DM ──> webhook (src/app.mjs)
                   │
                   ▼
             src/inbox.mjs ──> src/agent.mjs ──> LLM (src/ai.mjs: Gemini or Claude)
                   │                 │
                   │                 └─ tools: book order, save lead, hand off to owner
                   ▼
             src/repo.mjs ──> Postgres (Supabase in production, PGlite locally)
                   │
                   ▼
   reply via Instagram API (src/instagram.mjs), payment link via Razorpay (src/razorpay.mjs)
```

- **Runtime:** Node.js 22, no framework
- **AI:** Gemini or Claude, with function calling for orders, leads and hand-offs. The system prompt is built per shop from its catalogue and policies.
- **Database:** Postgres. Supabase in production; locally it runs PGlite (Postgres inside Node), so you can try everything without an account.
- **Deploy:** Dockerfile + `render.yaml` for Render

## Run it

```bash
npm install
cp .env.example .env   # add GEMINI_API_KEY (or a Claude key)
npm start              # http://localhost:3033
```

| Page | Path |
|---|---|
| Owner app | `/app/` |
| Product site | `/` |
| Two-phone demo (customer DM + owner WhatsApp) | `/demo.html` |

Without `DATABASE_URL`, data is kept in `.data/`. Connecting a real Instagram account, Supabase and Razorpay is covered in [SETUP-INSTAGRAM.md](SETUP-INSTAGRAM.md) and [SETUP-REAL.md](SETUP-REAL.md). Deploying is in [DEPLOY.md](DEPLOY.md).

## Tests

```bash
npm test
```

Covers the demo assistant and the real product end to end (accounts, Instagram webhooks, orders, payments) against fake AI, Instagram and Razorpay, plus the Postgres driver.

## Status

Working end to end with a demo sportswear shop. Instagram access is waiting on Meta's app review ([APP-REVIEW.md](APP-REVIEW.md)).

## Code map

| Path | What it is |
|---|---|
| `src/app.mjs` | Owner app API, login, Instagram connect, Instagram and Razorpay webhooks |
| `src/inbox.mjs` | Message pipeline: receive DM, get AI reply, send, payment links, staff takeover |
| `src/agent.mjs` | Per-shop system prompt and the assistant's tools |
| `src/ai.mjs` | Gemini / Claude client |
| `src/instagram.mjs`, `src/razorpay.mjs` | Instagram API and Razorpay Payment Links |
| `src/db.mjs`, `src/repo.mjs`, `sql/` | Database connection, queries and schema |
| `app/` | Owner app frontend |
| `validate.js` | Phone and address checks |
| `demo.html`, `bot.js`, `scenarios.js`, `catalog.js` | Scripted two-phone demo (never touches Instagram) |
| `tests/` | Test suite |

Built by [Santhapriyan B R](https://github.com/santhapriyan7896-max).
