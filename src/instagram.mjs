// Connecting a shop's Instagram professional account, and sending / receiving DMs.
//
// Two ways Meta lets an app connect, picked by the server's settings:
//
//  "unified"   (Instagram API with Unified Login — what new Meta apps get)
//     Login:   facebook.com/dialog/oauth with config_id. The shop signs in with Facebook
//              or Instagram and picks its business portfolio + Instagram account.
//     Token:   code → business system-user token (no expiry by default) that covers the
//              shared Instagram account(s). Everything goes to graph.facebook.com with the
//              Instagram account id in the path.
//     Env:     META_APP_ID, META_APP_SECRET (App settings → Basic), META_CONFIG_ID.
//
//  "instagram" (Instagram API with Instagram Login — older apps only)
//     Login:   instagram.com/oauth/authorize → short token → 60-day token (refreshed).
//     Calls:   graph.instagram.com.
//     Env:     IG_APP_ID, IG_APP_SECRET.
//
// Either way, DMs arrive at /webhooks/instagram signed with the app secret, and replies
// are only allowed within 24 h of the customer's last message.

const MAX_TEXT = 1000; // Instagram's limit per message
const IG_LOGIN_SCOPES = ["instagram_business_basic", "instagram_business_manage_messages"];

export function makeInstagram({ mode = "unified", appId, appSecret, configId, redirectUri, version = "v27.0", fetchImpl = fetch, retryDelayMs = 2500 }) {
  const unified = mode === "unified";
  const graph = unified ? `https://graph.facebook.com/${version}` : `https://graph.instagram.com/${version}`;
  const configured = !!(appId && appSecret && redirectUri && (!unified || configId));

  async function call(url, opts = {}) {
    const r = await fetchImpl(url, { ...opts, signal: AbortSignal.timeout(15000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) {
      const msg = (j.error && (j.error.message || j.error.error_user_msg)) || j.error_message || r.statusText;
      const e = new Error(`Instagram: ${msg}`);
      e.status = r.status;
      e.code = j.error && j.error.code;
      throw e;
    }
    return j;
  }
  const q = (o) => new URLSearchParams(o).toString();

  function authUrl(state) {
    if (unified)
      return `https://www.facebook.com/dialog/oauth?${q({
        client_id: appId,
        config_id: configId,
        redirect_uri: redirectUri,
        response_type: "code",
        override_default_response_type: "true",
        state,
      })}`;
    return `https://www.instagram.com/oauth/authorize?${q({
      enable_fb_login: "0",
      force_authentication: "1",
      client_id: appId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: IG_LOGIN_SCOPES.join(","),
      state,
    })}`;
  }

  // code → { token, expiresAt (null = never), igUserId, username, otherAccounts }
  async function connect(code) {
    code = String(code).replace(/#_$/, "");
    if (unified) {
      const t = await call(`${graph}/oauth/access_token?${q({ client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code })}`);
      if (!t.access_token) throw new Error("Instagram: no access token in the response");
      const data = await findAccounts(t.access_token);
      const acct = data[0];
      // Ask Meta to send this account's DMs to our webhook.
      await call(`${graph}/${acct.id}/subscribed_apps?${q({ subscribed_fields: "messages", access_token: t.access_token })}`, { method: "POST" });
      return {
        token: t.access_token,
        expiresAt: t.expires_in ? new Date(Date.now() + t.expires_in * 1000) : null,
        igUserId: String(acct.id),
        username: acct.username || "",
        otherAccounts: data.slice(1).map((a) => a.username || a.id),
      };
    }
    const form = new URLSearchParams({ client_id: appId, client_secret: appSecret, grant_type: "authorization_code", redirect_uri: redirectUri, code });
    const short = await call("https://api.instagram.com/oauth/access_token", { method: "POST", body: form });
    const shortToken = short.access_token || (short.data && short.data[0] && short.data[0].access_token);
    if (!shortToken) throw new Error("Instagram: no access token in the response");
    const long = await call(`https://graph.instagram.com/access_token?${q({ grant_type: "ig_exchange_token", client_secret: appSecret, access_token: shortToken })}`);
    const me = await call(`${graph}/me?${q({ fields: "user_id,username", access_token: long.access_token })}`);
    await call(`${graph}/me/subscribed_apps?${q({ subscribed_fields: "messages", access_token: long.access_token })}`, { method: "POST" });
    return {
      token: long.access_token,
      expiresAt: new Date(Date.now() + (long.expires_in || 60 * 86400) * 1000),
      igUserId: String(me.user_id || me.id),
      username: me.username || "",
      otherAccounts: [],
    };
  }

  // Which Instagram account(s) the shop shared during Unified login. Meta's documented
  // call (/me/assigned_instagram_accounts) can come back empty, so two fallbacks:
  // the token's granted permissions (debug_token lists the account ids per permission),
  // then Instagram accounts linked to Facebook Pages. `notes` (no secrets) explain a failure.
  async function findAccounts(token) {
    const found = new Map(); // id → username
    const notes = [];
    const attempt = async (label, fn) => {
      if (found.size) return;
      try {
        await fn();
      } catch (err) {
        notes.push(`${label}: ${err.message}`);
      }
    };
    // Meta's documented call. Asked up to 3 times, in case the account is attached to the
    // connection a moment after the shop is sent back to us.
    for (let i = 0; i < 3 && !found.size; i++) {
      if (i) await new Promise((r) => setTimeout(r, retryDelayMs));
      await attempt(`assigned_instagram_accounts#${i + 1}`, async () => {
        const { data = [] } = await call(`${graph}/me/assigned_instagram_accounts?${q({ fields: "id,username", access_token: token })}`);
        notes.push(`assigned_instagram_accounts#${i + 1}: ${data.length}`);
        for (const a of data) found.set(String(a.id), a.username || "");
      });
    }
    // Who the token belongs to (for the log, and to look in the business portfolio).
    let business = null;
    await attempt("me", async () => {
      const me = await call(`${graph}/me?${q({ fields: "id,name,client_business_id", access_token: token })}`);
      business = me.client_business_id || null;
      notes.push(`token user ${me.id || "?"} (${me.name || "no name"}), business ${business || "none"}`);
    });
    await attempt("debug_token", async () => {
      const d = await call(`${graph}/debug_token?${q({ input_token: token, access_token: `${appId}|${appSecret}` })}`);
      const info = d.data || {};
      const scopes = info.granular_scopes || [];
      notes.push(`token type ${info.type || "?"}, valid ${info.is_valid}, expires ${info.expires_at || "never"}, profile ${info.profile_id || "-"}`);
      notes.push(`granted: ${scopes.map((s) => `${s.scope}(${(s.target_ids || []).length})`).join(", ") || "none"}`);
      const order = ["instagram_basic", "instagram_manage_messages"];
      for (const name of order) for (const s of scopes) if (s.scope === name) for (const id of s.target_ids || []) if (!found.has(String(id))) found.set(String(id), "");
    });
    // Not in Meta's Unified docs, tried as a last resort: the portfolio's Instagram accounts.
    for (const edge of ["owned_instagram_accounts", "instagram_accounts"])
      await attempt(edge, async () => {
        if (!business) return;
        const { data = [] } = await call(`${graph}/${business}/${edge}?${q({ fields: "id,username", access_token: token })}`);
        notes.push(`${edge}: ${data.length}`);
        for (const a of data) found.set(String(a.id), a.username || "");
      });
    await attempt("me/accounts", async () => {
      const { data = [] } = await call(`${graph}/me/accounts?${q({ fields: "instagram_business_account{id,username}", access_token: token })}`);
      notes.push(`pages: ${data.length}`);
      for (const p of data) if (p.instagram_business_account) found.set(String(p.instagram_business_account.id), p.instagram_business_account.username || "");
    });
    for (const [id, username] of found)
      if (!username)
        try {
          found.set(id, (await call(`${graph}/${id}?${q({ fields: "username", access_token: token })}`)).username || "");
        } catch (err) {
          notes.push(`username for ${id}: ${err.message}`);
        }
    if (!found.size) {
      await call(`${graph}/me/adaccounts?${q({ fields: "id", access_token: token })}`).then(
        (r) => notes.push(`ad accounts: ${(r.data || []).length}`),
        (err) => notes.push(`ad accounts: ${err.message}`),
      );
      const e = new Error("Meta didn't share an Instagram account with Shopkeep. Connect again and make sure your Instagram account is selected.");
      e.details = notes;
      throw e;
    }
    return [...found].map(([id, username]) => ({ id, username }));
  }

  // Instagram-login tokens last 60 days and are refreshed. Unified tokens don't expire
  // unless the configuration says so; if one does, the shop has to connect again.
  async function refresh(token) {
    if (unified) throw new Error("This connection has an expiry date. Connect Instagram again in Settings.");
    const j = await call(`https://graph.instagram.com/refresh_access_token?${q({ grant_type: "ig_refresh_token", access_token: token })}`);
    return { token: j.access_token, expiresAt: new Date(Date.now() + (j.expires_in || 60 * 86400) * 1000) };
  }

  // Customer's name / username. Best effort: Meta may refuse, and that's fine.
  async function profile({ token }, igsid) {
    try {
      return await call(`${graph}/${igsid}?${q({ fields: "name,username", access_token: token })}`);
    } catch {
      return {};
    }
  }

  async function send({ token, igUserId }, recipientId, message) {
    const j = await call(`${graph}/${unified ? igUserId : "me"}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ recipient: { id: recipientId }, message }),
    });
    return j.message_id || null;
  }

  // Returns the message ids, one per chunk sent.
  async function sendText(acct, recipientId, text) {
    const ids = [];
    for (const chunk of splitText(text)) ids.push(await send(acct, recipientId, { text: chunk }));
    return ids;
  }

  // A message with a tappable link button (e.g. "Pay ₹719"). If Meta refuses the button
  // format, the link goes out as plain text instead, so the customer can still pay.
  async function sendButton(acct, recipientId, text, title, url) {
    try {
      return [
        await send(acct, recipientId, {
          attachment: { type: "template", payload: { template_type: "button", text: text.slice(0, 640), buttons: [{ type: "web_url", url, title: title.slice(0, 20) }] } },
        }),
      ];
    } catch (err) {
      if (err.status >= 500 || err.name === "TimeoutError") throw err;
      return sendText(acct, recipientId, `${text}

${title}: ${url}`);
    }
  }

  return { mode, configured, authUrl, connect, refresh, profile, sendText, sendButton };
}

function splitText(text) {
  const out = [];
  let rest = String(text);
  while (rest.length > MAX_TEXT) {
    let cut = rest.lastIndexOf("\n", MAX_TEXT);
    if (cut < MAX_TEXT / 2) cut = rest.lastIndexOf(" ", MAX_TEXT);
    if (cut < MAX_TEXT / 2) cut = MAX_TEXT;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

// Turns a webhook body into a flat list of events:
//   { igAccountId, senderId, recipientId, mid, text, attachments, isEcho, timestamp }
// Handles both the "messaging" shape (real traffic) and the "changes" shape (the
// "Test" button in the Meta dashboard).
export function parseWebhook(body) {
  const events = [];
  if (!body || (body.object !== "instagram" && body.object !== "page")) return events;
  for (const entry of body.entry || []) {
    const items = [...(entry.messaging || [])];
    for (const ch of entry.changes || []) if (ch.field === "messages" && ch.value) items.push(ch.value);
    for (const m of items) {
      if (!m.message || m.message.is_deleted || !m.sender) continue; // reads, reactions, deletions
      events.push({
        igAccountId: String(entry.id),
        senderId: String(m.sender.id),
        recipientId: String(m.recipient && m.recipient.id),
        mid: m.message.mid || null,
        text: m.message.text || "",
        attachments: (m.message.attachments || []).map((a) => ({ type: a.type, url: (a.payload && a.payload.url) || null, title: (a.payload && a.payload.title) || null })),
        isEcho: !!m.message.is_echo,
        timestamp: Number(m.timestamp) || Date.now(),
      });
    }
  }
  return events;
}
