// Razorpay Payment Links. Each shop uses its own Razorpay account (keys entered in
// Settings). Test-mode keys (rzp_test_…) work without KYC.
//
// UPI order → createLink() → link sent in the DM → customer pays →
// Razorpay calls /webhooks/razorpay/<shopId> with "payment_link.paid" → we check the
// signature with that shop's webhook secret → order confirmed.

export function makeRazorpay({ fetchImpl = fetch } = {}) {
  async function createLink({ keyId, keySecret }, { amount, orderNumber, description, customerName, phone, expireMinutes = 24 * 60, notes = {} }) {
    const r = await fetchImpl("https://api.razorpay.com/v1/payment_links", {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${keyId}:${keySecret}`).toString("base64"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: Math.round(amount * 100), // paise
        currency: "INR",
        accept_partial: false,
        reference_id: orderNumber,
        description: String(description).slice(0, 2048),
        customer: { name: customerName, contact: phone ? `+91${phone}` : undefined },
        notify: { sms: false, email: false }, // the link goes out in the Instagram DM
        reminder_enable: false,
        expire_by: Math.floor(Date.now() / 1000) + Math.max(16, expireMinutes) * 60,
        notes,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Razorpay: ${(j.error && j.error.description) || r.statusText}`);
    return { id: j.id, url: j.short_url };
  }

  // Webhook body → { linkId, paymentId, amount, reference } for a paid link, else null.
  function parsePaid(body) {
    if (!body || body.event !== "payment_link.paid") return null;
    const link = body.payload && body.payload.payment_link && body.payload.payment_link.entity;
    const pay = body.payload && body.payload.payment && body.payload.payment.entity;
    if (!link) return null;
    return { linkId: link.id, reference: link.reference_id, paymentId: pay ? pay.id : null, amount: (link.amount_paid || link.amount || 0) / 100 };
  }

  return { createLink, parsePaid };
}
