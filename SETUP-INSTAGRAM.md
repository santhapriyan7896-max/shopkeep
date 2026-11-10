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
| `META_APP_ID`, `META_APP_SECRET`, `META_CONFIG_ID` | From step 3. `IG_VERIFY_TOKEN` is any long random text (Render generates it) |

`PUBLIC_URL` is filled in automatically on Render. Set it yourself if you use a custom domain (e.g. `https://app.shopkeep.in`).

## 3. Meta app for Instagram, 20 minutes

New Meta apps use **"API setup with Unified login"** (Meta's dashboard says "API setup with Instagram login is not available for newer apps"). Shopkeep uses that by default. You need a Facebook account for developers.facebook.com, an app owned by a **business portfolio**, and the shop's Instagram **professional** account (Business or Creator). No Facebook Page needed.

1. **developers.facebook.com → My Apps → Create app.** Use case: **"Manage messaging & content on Instagram"**. Connect it to your business portfolio (Team Coge) when asked.
2. **App settings → Basic**: copy **App ID** → `META_APP_ID` and **App secret** → `META_APP_SECRET` (the Facebook app ID and secret, not an "Instagram app ID").
3. **Use cases → Manage messaging & content on Instagram → Customize → API setup with Unified login**:
   - **1. Configure your app → Create new configuration.** Name it "Shopkeep". Token expiry: **Never**. Asset: Instagram account. Permissions: `instagram_basic` and `instagram_manage_messages` are required; untick ads / publishing / comments if Meta lets you (fewer permissions = easier App Review). Save, then copy the **Configuration ID** → `META_CONFIG_ID`.
   - **Redirect URL** on the same page: `https://YOUR-SERVER/auth/instagram/callback` → **Save**.
   - **Configure webhooks**: callback URL `https://YOUR-SERVER/webhooks/instagram`, verify token = the value of `IG_VERIFY_TOKEN` in Render. Open the site once first (the free Render plan sleeps), click **Verify and save**, then subscribe to **messages**.
4. **App roles → Roles → Instagram testers**: add the shop's Instagram account and a second Instagram account you'll use as a "customer". Accept both invites on instagram.com (**Settings → Website permissions → Apps and websites → Tester invites**).
5. On the shop's Instagram account: **Settings → Messages and story replies → Message controls → Connected tools → Allow access to messages: on.**

Now in Shopkeep: **Settings → Connect Instagram** → sign in with Facebook or Instagram → pick your business portfolio and the Instagram account → allow. Send a DM from the second account. It shows up in the Inbox, and once the assistant is switched on it replies.

Older apps that still show "API setup with Instagram login" can use that instead: set `IG_APP_ID` / `IG_APP_SECRET` (the Instagram app ID and secret) and leave the `META_*` values empty.

### Before real customers: App Review

Step-by-step with paste-ready text: **APP-REVIEW.md**.

While the Meta app is in development mode, only accounts with a role on the app (step 4) work. To reply to everyone:

1. **App settings → Basic**: privacy policy URL `https://YOUR-SERVER/privacy.html`, data deletion instructions URL (same page), app icon, category.
2. **Business verification** for your business (Team Coge) in Meta Business Settings.
3. **App Review → Permissions**: request **Advanced Access** for `instagram_basic` and `instagram_manage_messages`. Meta asks for a screen recording: connecting Instagram in Shopkeep, a DM arriving, the assistant replying, and a reply from the Inbox.
4. Switch the app to **Live**.

Review usually takes a few days and sometimes asks for changes, so start early.

### Instagram's rules the app already follows

- Replies only within **24 hours** of the customer's last message (the Inbox shows when the window has closed).
- When someone from the shop replies (in the Instagram app or the Inbox), the assistant stays out of that chat for a while (Settings → "Stay quiet after a person replies").
- Unified-login connections don't expire (with expiry "Never"). They stop if the shop removes Shopkeep in Meta Business Settings → Integrations; the shop then connects again. (Instagram-login tokens last 60 days and are renewed automatically.)

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
