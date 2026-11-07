// Passwords, login sessions, signed state values and encryption of stored secrets
// (Instagram tokens, Razorpay keys). Everything is derived from one APP_SECRET.

import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt);

export function makeCrypto(appSecret) {
  if (!appSecret || appSecret.length < 32) throw new Error("APP_SECRET must be at least 32 characters");
  const derive = (label) => crypto.createHmac("sha256", appSecret).update(label).digest();
  const signKey = derive("shopkeep:sign");
  const encKey = derive("shopkeep:encrypt");

  const b64u = (buf) => Buffer.from(buf).toString("base64url");
  const mac = (data) => b64u(crypto.createHmac("sha256", signKey).update(data).digest());

  // Signed, expiring token: payload.signature. Used for the login cookie and the
  // Instagram OAuth "state" value.
  function sign(payload, ttlSeconds) {
    const body = b64u(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds }));
    return `${body}.${mac(body)}`;
  }
  function verify(token) {
    const [body, sig] = String(token || "").split(".");
    if (!body || !sig) return null;
    const want = Buffer.from(mac(body));
    const got = Buffer.from(sig);
    if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
    try {
      const data = JSON.parse(Buffer.from(body, "base64url").toString());
      return data.exp > Date.now() / 1000 ? data : null;
    } catch {
      return null;
    }
  }

  // AES-256-GCM. Output: iv.tag.ciphertext (base64url).
  function encrypt(text) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv("aes-256-gcm", encKey, iv);
    const data = Buffer.concat([c.update(String(text), "utf8"), c.final()]);
    return [iv, c.getAuthTag(), data].map(b64u).join(".");
  }
  function decrypt(value) {
    const [iv, tag, data] = String(value).split(".").map((p) => Buffer.from(p, "base64url"));
    const d = crypto.createDecipheriv("aes-256-gcm", encKey, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(data), d.final()]).toString("utf8");
  }

  return { sign, verify, encrypt, decrypt };
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(String(password), salt, 64);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function checkPassword(password, stored) {
  const [kind, salt, hash] = String(stored || "").split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const want = Buffer.from(hash, "base64");
  const got = await scrypt(String(password), Buffer.from(salt, "base64"), want.length);
  return crypto.timingSafeEqual(want, got);
}

// HMAC-SHA256 hex of a raw request body, compared in constant time.
// Instagram sends "sha256=<hex>", Razorpay sends "<hex>".
export function hmacMatches(rawBody, secret, header) {
  if (!secret || !header) return false;
  const given = String(header).replace(/^sha256=/, "");
  const want = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  return given.length === want.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(want));
}
