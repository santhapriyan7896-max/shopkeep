# Shopkeep — the sales assistant for shops that sell in DMs

**Shopkeep** (made by Team Coge) answers Instagram DMs 24/7, takes orders and UPI payments, checks phone numbers and addresses, and reports to the owner on WhatsApp. First shop: **@activewear.33** (Coimbatore).

| Page | URL (with `npm start` running) |
|---|---|
| Product website (home page) | http://localhost:3033 |
| Live demo (two phones) | http://localhost:3033/demo.html |
| Owner dashboard | http://localhost:3033/dashboard.html |
| Launch film (plays itself) | http://localhost:3033/pitch.html |

Design language (film + site): charcoal `#161617`, rounded cards `#232426`, medium-weight sentence-case type, one green accent `#2ED47A`, logo `shopkeep-logo.svg`.

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
| `catalog.js` | Products, prices, stock, shop info. **Edit this** |
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
| `tests/` | `npm test` checks the assistant; `npm run transcript` prints every scenario |

This is a demo. It does not connect to Instagram or send any messages. The real build connects through Meta's official Instagram Messaging API after the shop links its account.
