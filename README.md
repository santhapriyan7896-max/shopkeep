# Shopkeep — the sales assistant for shops that sell in DMs

**Shopkeep** (made by Team Coge) answers Instagram DMs 24/7, takes orders and UPI payments, checks phone numbers and addresses, and reports to the owner on WhatsApp. First shop: **@activewear.33** (Coimbatore).

| Page | URL (with `npm start` running) |
|---|---|
| **The owner app (the real product)** | http://localhost:3033/app/ |
| Product website (home page) | http://localhost:3033 |
| Live demo (two phones) | http://localhost:3033/demo.html |
| Owner dashboard | http://localhost:3033/dashboard.html |
| Launch film (plays itself) | http://localhost:3033/pitch.html |

Design language (film + site): charcoal `#161617`, rounded cards `#232426`, medium-weight sentence-case type, one green accent `#2ED47A`, logo `shopkeep-logo.svg`.

## The product: owner app + Instagram

`/app/` is the real tool. A shop signs up, adds its products and policies, connects its Instagram professional account and switches the assistant on. From then on:

- **Every DM is answered** by the AI from the shop's own catalog and policies, in the customer's language. It waits a few seconds so 2–3 messages in a row get one answer.
- **Orders**: it collects size, name, phone and address, checks them (10-digit mobile, real pincode matching the city, door number, stock), and books the order.
- **UPI** orders get a Razorpay payment link button in the DM; the signed Razorpay webhook confirms the order and DMs "Payment received ✅". Without Razorpay, the shop's UPI ID is sent and the team marks it paid.
- **COD** orders wait in **Orders → COD review**; confirming, shipping (with tracking) or cancelling DMs the customer. Cancelling puts the stock back.
- **Hand-offs**: complaints, refunds and anything it can't answer are flagged in the Inbox ("Needs you"). When someone from the shop replies (in the Inbox or the Instagram app), the assistant stays out of that chat for a while.
- **Bulk / custom orders** are collected as Enquiries.
- **Test chat** lets the owner talk to their assistant before going live.

Run it locally with `npm start` and open http://localhost:3033/app/. Without `DATABASE_URL` it keeps its data in `.data/` (a real Postgres running inside Node), so you can try everything without any account. Going live (Supabase, Meta app, Razorpay, App Review): **SETUP-INSTAGRAM.md**.

## The demo

Two phones side by side:

- **Left – the customer's Instagram DM at 1 AM.** Replies come instantly, in the shop's own short style (light Tanglish when the customer writes that way).
- **Right – the owner's WhatsApp.** New orders, team-kit enquiries and complaints arrive as alerts overnight, then a "Good morning" summary at 9 AM.

## Run it

```bash
cd "D:\New folder\activewear33-demo"
npm start
```

Then open **http://localhost:3033** for the website, or **http://localhost:3033/demo.html** for the demo. (Opening `demo.html` by double-click also works, in offline mode only.)

## Controls (hidden for recording)

Click the faint **•••** in the bottom-right corner, or use the keyboard (click the page background first):

| Key | Does |
|---|---|
| **P** | Play the full demo (UPI order paid → COD order → team kit → complaint → 9 AM summary) |
| **M** | Send the 9 AM morning summary on WhatsApp |
| **R** | Reset both phones |
| **H** | Show / hide the controls panel |

You can also just type in the Instagram phone as a customer, or tap the blue camera button to share one of their posts.

**Live AI** (tick it in the controls panel): lets the owner type *anything*. Needs a Claude API key: copy `.env.example` to `.env`, paste the key, restart `npm start`. Uses `claude-opus-5-5` by default; set `AW33_MODEL=claude-haiku-5-5` for production-level costs.

## Payments, COD review and the owner dashboard

- **UPI:** the customer gets a "Pay ₹…" card in the chat → a checkout window opens inside Instagram → after payment the order **confirms automatically** and the customer gets "Payment received ✅".
- **COD:** the order goes to **Needs review**. The owner gets a WhatsApp alert with a dashboard link. Tapping **Confirm** on the dashboard DMs the customer automatically.
- **Checks before any order:** 10-digit mobile number (rejects 9 digits, numbers not starting 6–9, 9999999999…), valid pincode, pincode matches the city written, door number present. The customer is asked to fix just the wrong part.
- **Owner dashboard:** `http://localhost:3033/dashboard.html` (or "Owner dashboard ↗" in the controls). Orders, Team enquiries and Messages tabs, plus a **Verify with India Post** button per order. Open it in a second window next to the phones; it updates live.

How to set all this up for real (payment gateway, courier check, WhatsApp YES-confirmation): see **SETUP-REAL.md**.

## Pitch video

Files in `video/`:
- `activewear33-pitch-eric.mp4`: **the final video**, with score, sound effects and the ElevenLabs "Eric" voice-over
  (needs `ELEVENLABS_API_KEY` in `.env`; lines are cached, so re-mixing doesn't spend credits again. `node make-audio.mjs --robot` makes a free robot-voice draft instead)
- `activewear33-pitch-music-only.mp4`: score + sound effects, no voice (record your own over it)
- `activewear33-pitch-silent.mp4`: picture only
- `VOICEOVER.md`: the script, scene by scene

Rebuild after changing the demo, the film (`pitch.js`) or the voice lines (top of `make-audio.mjs`). Keep `npm start` running in another terminal:
```bash
node record-video.mjs
node make-audio.mjs
```
`record-video.mjs` records the picture and logs every scene and sound cue. `make-audio.mjs` composes the score, builds the sound effects on those cues, voices the draft and mixes everything. All sound is generated in code, so there are no copyright issues.

## Before you show the owner (important)

Products, sizes, offers, address and phone come from their own Instagram posts. **Every price and stock number is a sample**, because their posts never show prices. Open `catalog.js` and fix:

- [ ] Prices (`versions` / `price`) for the products you'll demo
- [ ] Store hours, COD fee, delivery fee, exchange policy (marked `SAMPLE`)
- [ ] Team-kit price range (`teamwear`)
- [ ] Optional: save 5–10 screenshots of their posts to `images/` and add `image: "images/xyz.jpg"` to those products so shared posts show the real photo

A wrong price in front of the owner hurts more than a placeholder, so if you're not sure, say "sample prices" out loud.

## Recording the video

1. Browser full screen (F11). Both phones should fit.
2. Press **R**, then **P**. Don't touch anything until the 9 AM summary arrives on WhatsApp.
3. Untick "Fast typing" in the controls first. Normal speed looks like a real person typing.

## Pitch flow (in person, 10 minutes)

1. **Their problem, in their own words.** Show their story: *"We will not be able to reply during midnight hours."* Also: their posts all say "DM for price", so every interested follower *has* to message them.
2. **Your test DM.** Show your "F1 jersey / Ferrari or Mercedes" message and how long the reply took.
3. **Demo.** Press P. While it plays, point at the WhatsApp phone: *"This is what you'd see on your phone."* End on the 9 AM summary.
4. **Let them type.** In Live AI mode, ask the owner to type something a real customer sent them yesterday.
5. **Offer.** 14-day free pilot on their real account. Then setup fee + monthly.

## Files

| File | What it is |
|---|---|
| `app/` | **The owner app** (Home, Inbox, Orders, Products, Enquiries, Test chat, Settings) |
| `src/app.mjs` | Owner app API, login, Instagram connect, Instagram + Razorpay webhooks, live updates |
| `src/inbox.mjs` | Message pipeline: receive DM → AI reply → send, payment links, staff takeover |
| `src/agent.mjs` | The assistant's prompt (built per shop) and its tools: orders, leads, hand-offs |
| `src/ai.mjs` | Claude or Gemini |
| `src/instagram.mjs`, `src/razorpay.mjs` | Instagram API and Razorpay Payment Links |
| `src/db.mjs`, `src/repo.mjs`, `sql/` | Database (Supabase Postgres, or built-in locally) and all queries |
| `privacy.html` | Privacy policy (Meta needs one for App Review) |
| `catalog.js` | Demo only: products, prices, stock, shop info for the two-phone demo |
| `bot.js` | Offline assistant logic |
| `scenarios.js` | The ready-made customer conversations |
| `demo.html`, `style.css`, `app.js` | The demo: two phones (Instagram + WhatsApp) |
| `server.mjs` | Local server + Live AI (Claude) with order / team-lead / hand-off tools |
| `validate.js` | Phone + address checks |
| `store.js` | Shared order book (chat ↔ dashboard) |
| `dashboard.html`, `dashboard.css`, `dashboard.js` | Owner dashboard |
| `pitch.html`, `pitch.css`, `pitch.js` | The self-playing Shopkeep launch film |
| `index.html`, `landing.css` | Shopkeep product website, the home page (live demo embedded) |
| `shopkeep-logo.svg` | Shopkeep logo mark |
| `gemini.mjs` | Gemini as the Live AI brain (GEMINI_API_KEY in .env) |
| `record-video.mjs` | Records the film (picture + cue log) |
| `make-audio.mjs` | Score, sound effects, robot voice draft, final mix |
| `tests/` | `npm test`: the demo assistant, plus the real product end to end (accounts, Instagram, payments) with fake AI / Instagram / Razorpay |

The two-phone demo (`demo.html`) is scripted and never touches Instagram. The owner app (`/app/`) is the real thing: it connects through Meta's official Instagram API once a shop links its account.
