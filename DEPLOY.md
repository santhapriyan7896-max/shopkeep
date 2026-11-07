# Putting Shopkeep online

There are two ways, and you can use both:

| | **Render** (recommended) | **GitHub Pages** |
|---|---|---|
| What runs | Everything: website, demo, dashboard, **Live AI (Gemini)**, India Post lookup | Website, demo (offline mode), dashboard |
| Cost | Free tier (sleeps after 15 min idle, wakes in ~30 s) | Free |
| Needs | A Render account + your Gemini key | A **public** GitHub repo (free plan) |
| URL | `https://shopkeep.onrender.com` (or your domain) | `https://<username>.github.io/<repo>/` |

## Before anything: keys

- API keys live only in `.env` on your PC and in the host's **Environment** settings. `.env` is in `.gitignore`, so git will never upload it.
- If a key is ever pasted somewhere public, delete it in Google AI Studio / ElevenLabs and create a new one.

## Option A – Render (full product with Live AI)

1. Push this folder to GitHub (see the bottom of this page).
2. Go to **render.com** → sign in with GitHub → **New → Blueprint** → pick the repo. Render reads `render.yaml`.
3. When asked for `GEMINI_API_KEY`, paste your key. Click **Apply**.
4. Wait for the build (2–3 min). Open the URL Render shows you:
   - `/`: Shopkeep website
   - `/demo.html`: the live demo (tick **Live AI** in the ••• panel)
   - `/dashboard.html`: owner dashboard
   - `/pitch.html`: the launch film, playing live
5. Optional: Settings → Custom Domains → add e.g. `shopkeep.in`.

Protection already built in: 15 chat messages per minute per visitor (change with `CHAT_LIMIT_PER_MIN`), 1,000 characters per message, 30 pincode lookups per minute, memory limits on chats, and security headers.

**Free tier note:** the service sleeps when nobody visits for 15 minutes. The first visit after that takes ~30 s. For a real shop going live, use the $7/month plan so it never sleeps.

Other hosts: the `Dockerfile` works on Railway, Fly.io, Google Cloud Run or any VPS:
```bash
docker build -t shopkeep .
docker run -p 3033:3033 -e GEMINI_API_KEY=your-key shopkeep
```

## Option B – GitHub Pages (website + offline demo, no server)

1. The repo must be **public** (GitHub Pages on private repos needs a paid plan).
2. Repo → **Settings → Pages → Source: GitHub Actions**.
3. Repo → **Actions → "Deploy static site to GitHub Pages" → Run workflow**.
4. Your site appears at `https://<username>.github.io/<repo>/`.

On Pages the demo runs its built-in offline assistant (all scripted conversations work); Live AI and the India Post button need the Render server.

## Push to GitHub

```bash
cd "D:\New folder\activewear33-demo"
git remote add origin https://github.com/<username>/shopkeep.git
git push -u origin main
```
Windows will open a GitHub sign-in window the first time.

Every push runs the tests automatically (`.github/workflows/ci.yml`).

## Before showing it to real shops

- [ ] Real prices and stock in `catalog.js` (the current ones are samples)
- [ ] Your contact on the website: `index.html` → "Book a demo" link (now `hello@example.com`)
- [ ] Pricing on the website (`index.html` → `#pricing`, now a sample "From ₹2,999/month")
- [ ] Check the name "Shopkeep" is free to use (domain + trademark) before you launch publicly
