// Instagram API with Instagram Login (no Facebook Page needed).
//
// Connect flow:  owner clicks "Connect Instagram" → instagram.com/oauth/authorize →
//   our /auth/instagram/callback gets a code → short-lived token → 60-day token →
//   /me gives the professional account id that webhooks use → subscribe to "messages".
// Messages arrive at /webhooks/instagram (signed with the app secret).
// Replies go out through POST /me/messages. Instagram only allows replies within 24 h
// of the customer's last message.

export const IG_SCOPES = ["instagram_business_basic", "instagram_business_manage_messages"];
const MAX_TEXT = 1000; // Instagram's limit per message

export function makeInstagram({ appId, appSecret, redirectUri, version = "v24.0", fetchImpl = fetch }) {
  const graph = `https://graph.instagram.com/${version}`;
  const configured = !!(appId && appSecret && redirectUri);

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

  function authUrl(state) {
    const p = new URLSearchParams({
      enable_fb_login: "0",
      force_authentication: "1",
      client_id: appId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: IG_SCOPES.join(","),
      state,
    });
    return `https://www.instagram.com/oauth/authorize?${p}`;
  }

  // code → { token, expiresAt, igUserId, username }
  async function connect(code) {
    const form = new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code: String(code).replace(/#_$/, ""),
    });
    const short = await call("https://api.instagram.com/oauth/access_token", { method: "POST", body: form });
    const shortToken = short.access_token || (short.data && short.data[0] && short.data[0].access_token);
    if (!shortToken) throw new Error("Instagram: no access token in the response");
    const long = await call(
      `https://graph.instagram.com/access_token?${new URLSearchParams({ grant_type: "ig_exchange_token", client_secret: appSecret, access_token: shortToken })}`,
    );
    const me = await call(`${graph}/me?${new URLSearchParams({ fields: "user_id,username", access_token: long.access_token })}`);
    // Ask Instagram to send this account's DMs to our webhook.
    await call(`${graph}/me/subscribed_apps?${new URLSearchParams({ subscribed_fields: "messages", access_token: long.access_token })}`, { method: "POST" });
    return {
      token: long.access_token,
      expiresAt: new Date(Date.now() + (long.expires_in || 60 * 86400) * 1000),
      igUserId: String(me.user_id || me.id),
      username: me.username || "",
    };
  }

  // Long-lived tokens last 60 days and can be refreshed once they're a day old.
  async function refresh(token) {
    const j = await call(`https://graph.instagram.com/refresh_access_token?${new URLSearchParams({ grant_type: "ig_refresh_token", access_token: token })}`);
    return { token: j.access_token, expiresAt: new Date(Date.now() + (j.expires_in || 60 * 86400) * 1000) };
  }

  async function profile(token, igsid) {
    try {
      return await call(`${graph}/${igsid}?${new URLSearchParams({ fields: "name,username", access_token: token })}`);
    } catch {
      return {};
    }
  }

  async function send(token, recipientId, message) {
    const j = await call(`${graph}/me/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ recipient: { id: recipientId }, message }),
    });
    return j.message_id || null;
  }

  // Returns the message ids, one per chunk sent.
  async function sendText(token, recipientId, text) {
    const ids = [];
    for (const chunk of splitText(text)) ids.push(await send(token, recipientId, { text: chunk }));
    return ids;
  }

  // A message with a tappable link button (e.g. "Pay ₹719").
  async function sendButton(token, recipientId, text, title, url) {
    const id = await send(token, recipientId, {
      attachment: {
        type: "template",
        payload: { template_type: "button", text: text.slice(0, 640), buttons: [{ type: "web_url", url, title: title.slice(0, 20) }] },
      },
    });
    return [id];
  }

  return { configured, authUrl, connect, refresh, profile, sendText, sendButton };
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
