# Meta App Review for Shopkeep (Instagram)

Until Meta approves the app, only accounts added as **Instagram testers** get replies. This page is everything to fill in, in order. Text in boxes is ready to paste.

Serving just one shop that you manage yourself? You can skip this whole page: see "One shop you run yourself" in SETUP-INSTAGRAM.md.

Server: `https://shopkeep-j2d1.onrender.com` (change if you add a custom domain).

---

## 1. Trim the permissions first (5 min)

Meta reviews every permission the app asks for, and the consent screen currently also asks for **ads** and **content publishing**, which Shopkeep doesn't use. Unneeded permissions are the most common reason for rejection.

**Use cases → Instagram API → Customize → API setup with Unified login → 1. Configure your app** → edit your configuration:

- Keep: `instagram_basic`, `instagram_manage_messages`
- Remove if Meta allows: `ads_management`, `ads_read`, `instagram_content_publish`, `instagram_manage_comments`
- Business assets: Instagram account only (no ad account)

If you create a new configuration instead of editing, copy its new ID into Render as `META_CONFIG_ID`.

## 2. App settings → Basic

| Field | Value |
|---|---|
| App icon | `assets/shopkeep-app-icon-1024.png` (1024×1024) |
| Privacy policy URL | `https://shopkeep-j2d1.onrender.com/privacy.html` |
| User data deletion | "Data deletion instructions URL": `https://shopkeep-j2d1.onrender.com/privacy.html#delete` |
| Terms of service URL (optional) | `https://shopkeep-j2d1.onrender.com/privacy.html` |
| Category | Business and pages (or Messaging) |
| Contact email | santhapriyan7896@gmail.com |


## 3. Business verification

**Meta Business Settings (business.facebook.com) → Security centre → Start verification** for the business that owns the app (Team Coge / Shopkeep). You'll need a business document (e.g. GST certificate, Udyam registration, or a utility bill / bank statement in the business name) and a phone or email on the business's domain or listed on the document. It usually takes 1–5 working days.

## 4. App Review → Permissions and features

Request **Advanced Access** for each permission below. For each, Meta asks "How will your app use this permission?" and wants a screen recording.

### `instagram_basic`

```
Shopkeep is a sales assistant for small shops that sell through Instagram Direct. A shop owner signs in to Shopkeep (https://shopkeep-j2d1.onrender.com/app/), clicks "Connect Instagram" and selects their Instagram professional account in the Facebook Login for Business dialog.

We use instagram_basic only to read the connected account's ID and username, so we can show the owner which account is connected (Settings → "Connected @username") and match incoming message webhooks to the right shop. We don't read or display posts, followers or media.
```

### `instagram_manage_messages`

```
Shopkeep answers the shop's Instagram Direct messages on its behalf, using the shop's own product list, prices, stock and policies that the owner enters in Shopkeep.

When a customer messages the connected account, we receive the message through the messages webhook and reply through the Instagram Messaging API within the 24-hour window: answering price and size questions, taking an order (name, phone, address), and sending a payment link for UPI orders. Complaints, refunds and anything the assistant can't answer are flagged for a person in the shop's Shopkeep Inbox, where the owner can read the conversation and reply manually; when a person replies, the assistant stops replying in that chat.

The owner can also confirm, ship or cancel orders in Shopkeep, which sends the customer a short status message in the same conversation. We never message people who haven't messaged the shop first, and we don't send promotional messages.
```

## 5. Screen recording (one video, ~2–3 min, used for both permissions)

Record the screen in a browser with Shopkeep on one side and Instagram (the customer account, on instagram.com or phone mirror) on the other. Show, in order:

1. **Sign in** to Shopkeep at `/app/` with the reviewer account (section 6).
2. **Settings → Connect Instagram**: the Facebook Login for Business dialog, picking the business and the Instagram account, permissions screen, Confirm, then back on Settings showing **Connected @account**. *(If the "enter your Instagram account ID" box appears, show entering it; that's still the shop granting access.)*
3. **Products**: one product with prices and sizes.
4. **Settings → Assistant on.**
5. From the **customer account**, send: "hi, price of the Ferrari jersey?" → show the reply arriving in Instagram.
6. Continue to an **order** (size, name, phone, address, UPI) → show the order number reply and payment message in Instagram, and the order appearing in Shopkeep **Orders**.
7. **Inbox**: open the conversation in Shopkeep, type a manual reply, show it arriving in Instagram (this shows a person can take over).
8. **Orders**: mark the order shipped → show the customer receiving "Your order … is on the way".

Speak or add captions briefly explaining each step. Keep it in English.

## 6. Reviewer access (the "instructions for reviewers" box)

Create a reviewer account on Shopkeep (use the `SIGNUP_CODE` from Render), give it a product, and connect the same test Instagram account. Then paste:

```
1. Go to https://shopkeep-j2d1.onrender.com/app/ and sign in:
   Email: REVIEWER-EMAIL
   Password: REVIEWER-PASSWORD
2. Settings shows the connected Instagram account. Products shows the sample catalog.
3. To see the messaging flow, send a Direct message to @CONNECTED-ACCOUNT from any Instagram account added as a tester, e.g. "hi, price?". The assistant replies within a few seconds, and the conversation appears in Shopkeep's Inbox.
4. To test as the shop owner, open Inbox, pick the conversation and reply manually; the reply is sent to the customer on Instagram.
5. The server sleeps when idle on our current plan; if the first page load takes up to a minute, please wait and reload.
```

Use a separate email for the reviewer account (not your own), and a password you don't use anywhere else.

## 7. Submit, then go Live

- Submit the review. Meta often replies in 2–7 days, sometimes asking for a clearer video or narrower permissions; fix and resubmit.
- After approval: **App settings → App mode → Live**.
- Then any customer who DMs a connected shop gets replies. Testers are no longer needed.

## Checklist

- [ ] Configuration trimmed to `instagram_basic` + `instagram_manage_messages`
- [ ] Privacy page contact email updated
- [ ] App icon, privacy URL, data deletion URL, category set
- [ ] Business verification submitted
- [ ] Reviewer account created, product added, Instagram connected
- [ ] Screen recording made
- [ ] Both permissions requested with the text above
- [ ] After approval: app switched to Live
- [ ] Before real shops: Render Starter plan, or a keep-awake ping on the free plan
