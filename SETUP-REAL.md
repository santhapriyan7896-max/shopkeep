# Going live: payments, COD review, address verification, dashboard

The demo already has the full flow. This page covers what to connect when Activewear33 signs up.

## 1. UPI payments that confirm the order by themselves

**What the demo does:** customer picks UPI → "Pay ₹…" card → checkout → paid → order confirms, customer gets "Payment received", owner gets a WhatsApp alert.

**For real, use a payment gateway's Payment Links API** (Razorpay, Cashfree or PhonePe PG all offer one):

1. Customer chooses UPI → your server creates a payment link with the amount, `reference_id` = the order number (e.g. `AW33-1042`), and a 30–60 min expiry.
2. Send the link in the Instagram DM (as a button or a plain link).
3. The gateway calls your server's **webhook** when the payment succeeds (for Razorpay it's the `payment_link.paid` event).
4. Your server **checks the webhook signature**, marks the order `confirmed`, DMs the customer "Payment received ✅", and sends the owner a WhatsApp alert.

Rules:
- Only trust the signed webhook (or the gateway's API) to say "paid", never the customer's screenshot or the browser.
- Not paid in 30 min → one reminder DM. Not paid in 24 h → auto-cancel.
- The shop needs its own gateway account (KYC: PAN, bank account; GST if registered). Fees are usually around 2% per transaction on standard plans, and UPI is often cheaper, but check the gateway's current pricing.
- Instagram only allows business replies within **24 hours** of the customer's last message. Payment confirmations almost always fall inside that window.

## 2. COD orders → team review

**What the demo does:** COD orders go to **Needs review** on the dashboard, and the owner gets a WhatsApp alert with a link. When the owner taps **Confirm**, the customer is DM'd automatically.

**Recommended for real:**
- Send an automatic WhatsApp message: *"Reply YES to confirm your COD order AW33-1042 (₹719)"*. This needs a WhatsApp Business **utility template** (approved by Meta). A YES reply proves the number is real and the order is genuine. This is the biggest cut to fake orders and RTO (returned parcels).
- Auto-flag for a closer look: address warnings, first-time customer with a high amount, or a pincode where the courier doesn't allow COD.

## 3. Address verification: four layers

| Layer | What it catches | Status |
|---|---|---|
| **Format checks** | 10-digit mobile (6–9 start, +91/0 handled, fakes like 9999999999 rejected); 6-digit pincode; door/house number present; city matches pincode | ✅ Built (`validate.js`) |
| **India Post lookup** | Pincode really exists; gives post offices, district and state | ✅ Built: "Verify with India Post" button on the dashboard (`/api/pincode/:pin`) |
| **Courier serviceability** | Courier actually delivers there, whether COD is allowed, delivery days | Connect your courier's API: Shiprocket, Delhivery, or whichever courier the shop uses |
| **Customer confirms** | Typos in street/area; fake orders | WhatsApp "Reply YES" (above). For tricky addresses ask for a WhatsApp location pin |

Notes:
- The India Post API (`api.postalpincode.in`) is free and needs no key, but it's a public service without uptime guarantees. The server caches results, and the dashboard falls back to the offline prefix check if it's down.
- Optional: Google Maps Geocoding / Places API can confirm a street exists. It's paid beyond the free monthly credit, and usually not needed for a shop this size.
- Run the courier check **before** offering COD, so you never accept COD for a pincode that can't take it.

## 4. The owner dashboard for real

The demo keeps orders in the browser (localStorage) so it works offline. For the real thing:

- **Server + database:** host `server.mjs` (small VPS, Render, Railway…) and store orders in Postgres (e.g. Supabase). For a very small start, a Google Sheet works too.
- **Login:** the owner and staff sign in (Google sign-in or password + OTP). Staff can confirm orders, but only the owner sees revenue.
- **Phone-friendly:** the dashboard layout already switches to cards on a phone.
- **Alerts:** WhatsApp Cloud API template messages to the owner's number for new COD orders, paid orders, team enquiries and complaints, plus the 9 AM summary.
- **Instagram connection:** Meta's Instagram Messaging API (webhook for incoming DMs, Send API for replies) after the shop connects its account. App Review is needed before it can reply to real customers.

## Monthly running cost (small shop, rough)

| Item | Cost |
|---|---|
| Hosting + database | ₹0–500 (free tiers are enough at the start) |
| AI replies (Claude Haiku 5.5) | ~₹300–800 |
| India Post lookups | Free |
| WhatsApp alerts to the owner | Small per-message cost for template messages (check Meta's current India rates) |
| Payment gateway | % per transaction, paid from sales |
