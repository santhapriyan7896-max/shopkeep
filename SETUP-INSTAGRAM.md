# Going live: Supabase, Instagram, Razorpay

What you set up once (as the Shopkeep operator), and what each shop does in the app.

```
Customer DM ──► Instagram ──► /webhooks/instagram ──► Shopkeep ──► AI reply ──► Instagram
                                                         │
UPI order ──► Razorpay payment link ──► customer pays ──► /webhooks/razorpay/<shop> ──► order confirmed
```

## 1. Database (Supabase), 5 minutes

1. In your Supabase project: **Connect** (top bar) → **Session pooler** → copy the connection string.
2. Replace `[YOUR-PASSWORD]` with the database password (forgot it? **Project Settings → Database → Reset database password**).
3. Put it in Render → your service → **Environment** as `DATABASE_URL`.

The server creates its tables on first start (`sql/001_init.sql`). Row level security is on for every table with no public policies, so Supabase's public API keys can't read anything; only the server can.

## 2. Server settings on Render

Under **Environment**, besides `DATABASE_URL`:

| Variable | Value |
|---|---|
| `APP_SECRET` | A long random string (Render's "Generate" button). **Never change it** once shops are connected: it encrypts their Instagram tokens and Razorpay keys. |
| `GEMINI_API_KEY` or `ANTHROPIC_API_KEY` | The AI that writes replies |
| `SIGNUP_CODE` | An invite code you give to shops, so strangers can't create accounts and spend your AI credits |
| `IG_APP_ID`, `IG_APP_SECRET`, `IG_VERIFY_TOKEN` | From step 3 |

`PUBLIC_URL` is filled in automatically on Render. Set it yourself if you use a custom domain (e.g. `https://app.shopkeep.in`).

## 3. Meta app for Instagram, 20 minutes

You need a Facebook account (for developers.facebook.com) and the shop's Instagram **professional** account (Business or Creator). No Facebook Page needed.

1. **developers.facebook.com → My Apps → Create app.** Use case: **"Manage messaging & content on Instagram"**. App type Business.
2. In the app: **Instagram → API setup with Instagram login**.
   - Copy **Instagram app ID** → `IG_APP_ID` and **Instagram app secret** → `IG_APP_SECRET`.
3. **Set up Instagram business login → Business login settings → OAuth redirect URIs**, add:
   `https://YOUR-SERVER/auth/instagram/callback`
4. **Configure webhooks**:
   - Callback URL: `https://YOUR-SERVER/webhooks/instagram`
   - Verify token: the same text as `IG_VERIFY_TOKEN`
   - Click **Verify and save** (the server must already be running with these variables), then subscribe to the **messages** field.
5. **App roles → Roles → Instagram testers**: add the shop's Instagram account and a second Instagram account you'll use as a "customer". Accept both invites in Instagram (**Settings → Website permissions → Apps and websites → Tester invites**).
6. On the shop's Instagram account: **Settings → Messages and story replies → Message controls → Connected tools → Allow access to messages: on.**

Now in Shopkeep: **Settings → Connect Instagram** → sign in as the shop → allow. Send a DM from the second account. It shows up in the Inbox, and once the assistant is switched on it replies.

### Before real customers: App Review

While the Meta app is in development mode, only accounts with a role on the app (step 5) work. To reply to everyone:

1. **App settings → Basic**: privacy policy URL `https://YOUR-SERVER/privacy.html`, data deletion instructions URL (same page), app icon, category.
2. **Business verification** for your business (Team Coge) in Meta Business Settings.
3. **App Review → Permissions**: request **Advanced Access** for `instagram_business_basic` and `instagram_business_manage_messages`. Meta asks for a screen recording: connecting Instagram in Shopkeep, a DM arriving, the assistant replying, and a reply from the Inbox.
4. Switch the app to **Live**.

Review usually takes a few days and sometimes asks for changes, so start early.

### Instagram's rules the app already follows

- Replies only within **24 hours** of the customer's last message (the Inbox shows when the window has closed).
- When someone from the shop replies (in the Instagram app or the Inbox), the assistant stays out of that chat for a while (Settings → "Stay quiet after a person replies").
- Tokens last 60 days; the server renews them automatically and alerts the shop if renewing fails.

## 4. Razorpay (each shop, in the app)

Each shop connects **its own** Razorpay account so money goes straight to them: **Settings → Razorpay**. The page shows the exact webhook URL to paste in Razorpay and which event to tick (`payment_link.paid`). Test keys (`rzp_test_…`) work without KYC; switch to live keys after Razorpay activates the account.

Without Razorpay, UPI orders show the shop's UPI ID and the team marks them paid on the Orders page.

## 5. Checklist before a shop goes live

- [ ] Products with real prices and stock, shop details and policies filled in
- [ ] Ten or so realistic conversations tried in **Test chat**
- [ ] Instagram connected, a test DM answered
- [ ] One test payment through Razorpay test mode confirmed the order
- [ ] Test orders cancelled
- [ ] Assistant switched on
