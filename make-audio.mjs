// Builds the sound for the pitch video and mixes it onto the picture.
//
//   node make-audio.mjs
//
// Reads video/timeline.json (written by record-video.mjs) and creates:
//   video/activewear33-pitch-eric.mp4         – score + sound effects + ElevenLabs voice (needs ELEVENLABS_API_KEY in .env)
//   video/activewear33-pitch-robot-voice.mp4  – same with the Windows robot voice (no key, or --robot)
//   video/activewear33-pitch-music-only.mp4   – score + sound effects, no voice (record your own over it)
//
// Everything is synthesised here – no samples or copyrighted music:
//   • score: dark A-minor pads for the problem, a riser, then a brighter pulse
//     (F–C–G–Am, 96 bpm) for the demo, a big finish on the "Made by" card
//   • effects: whooshes, impacts, message send/receive pops, alert chimes, taps,
//     payment success chime – placed on the exact cues logged during recording
//   • voice: Windows' built-in text-to-speech (draft only), music ducks under it

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const here = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.join(here, ".env"));
} catch {}
const VID = path.join(here, "video");
const BUILD = path.join(VID, ".build");
fs.mkdirSync(BUILD, { recursive: true });

const tl = JSON.parse(fs.readFileSync(path.join(VID, "timeline.json"), "utf8"));
if (!tl.cues) throw new Error("timeline.json is from an older recording – run `node record-video.mjs` first.");
const SR = 44100;
const DUR = tl.duration;
const N = Math.ceil((DUR + 0.5) * SR);
const mark = (k) => {
  const m = tl.marks.find((x) => x.key === k);
  if (!m) throw new Error("missing scene mark " + k);
  return m.t;
};

// ── voice-over lines (anchored to scene marks) ─────────────────────────────────
// Written for the ear: "D M", "U P I", numbers in words, so the robot says them right.
// `say` is written for a natural voice (ElevenLabs); `robot` for Windows text-to-speech,
// which needs letters spaced out ("D M") and numbers in words to say them right.
const VO = [
  { at: "intro", d: 0.3, say: "11:47 PM. Someone wants to buy a jersey from you.", robot: "Eleven forty-seven P M. Someone wants to buy a jersey from you." },
  { at: "story", d: 0.5, say: "You posted this… because the messages don't stop at night.", robot: "You posted this. Because the messages don't stop at night." },
  { at: "posts", d: 0.4, say: "Seventy posts. Not one shows a price. So everyone has to DM you.", robot: "Seventy posts. Not one shows a price. So everyone has to D M you." },
  { at: "lost", d: 0.3, say: "And by morning, many of them have already bought somewhere else.", robot: "And by morning, many of them have already bought somewhere else." },
  { at: "whatif", d: 0.3, say: "So what if every DM got a reply in seconds… even at 1 AM? Meet Shopkeep.", robot: "So what if every D M got a reply in seconds, even at one A M? Meet Shopkeep." },
  { at: "demo", d: 0.6, say: "Here's a customer at 1 AM, sharing your Real Madrid reel and asking, “Price?” They get the price, the sizes, and your Diwali offer straight away. In Tanglish, the way your team talks.", robot: "Here's a customer at one A M, sharing your Real Madrid reel and asking, price? They get the price, sizes, and your Diwali offer straight away. In Tanglish, the way your team talks." },
  { at: "step:reel:3", d: 0.3, say: "It even offers name and number printing. That's a hundred and fifty rupees more on the order. And before booking, it checks the phone number and the pincode.", robot: "It even offers name and number printing. That's a hundred and fifty rupees more on the order. Before booking, it checks the phone number and the pincode." },
  { at: "step:reel:7", d: 0.3, say: "They choose UPI, and pay right inside Instagram. The order confirms itself. Nobody had to wake up. And you get the full order on your WhatsApp.", robot: "They choose U P I, and pay right inside Instagram. The order confirms itself. Nobody had to wake up. And you get the full order on your WhatsApp." },
  { at: "team", d: 0.4, say: "A few minutes later, a college team asks for fifteen custom jerseys. It asks the right questions: design, names, deadline. Gives an estimate, and sends you the lead to call in the morning.", robot: "A few minutes later, a college team asks for fifteen custom jerseys. It asks the right questions. Design, names, deadline. Gives an estimate, and sends you the lead to call in the morning." },
  { at: "morning", d: 0.3, say: "At 9 AM, you get one summary of the whole night.", robot: "At nine A M, you get one summary of the whole night." },
  { at: "dashboard", d: 0.5, say: "Every order sits in one simple dashboard. Cash-on-delivery orders wait for you, with the phone and address already checked. One tap, and the customer is told on Instagram.", robot: "Every order sits in one simple dashboard. Cash on delivery orders wait for you, with the phone and address already checked. One tap, and the customer is told on Instagram." },
  { at: "close", d: 0.4, say: "Replies in seconds. Takes payments. Checks addresses. Sends you what matters.", robot: "Replies in seconds. Takes payments. Checks addresses. Sends you what matters." },
  { at: "product", d: 0.4, say: "That's Shopkeep. The sales assistant for shops that sell in DMs.", robot: "That's Shopkeep. The sales assistant for shops that sell in D Ms." },
];

// ── tools ──────────────────────────────────────────────────────────────────────
let seed = 20261107;
function rnd() {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const noise = () => rnd() * 2 - 1;
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const buf = () => [new Float32Array(N), new Float32Array(N)];
const idx = (t) => Math.max(0, Math.min(N - 1, Math.round(t * SR)));

class Biquad {
  constructor(type = "lp", f = 1000, q = 0.707) {
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
    this.set(type, f, q);
  }
  set(type, f, q) {
    const w = (2 * Math.PI * Math.min(Math.max(f, 20), SR * 0.45)) / SR;
    const c = Math.cos(w), s = Math.sin(w), a = s / (2 * q);
    let b0, b1, b2;
    if (type === "lp") { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; }
    else if (type === "hp") { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; }
    else { b0 = a; b1 = 0; b2 = -a; } // band-pass
    const a0 = 1 + a;
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = (-2 * c) / a0; this.a2 = (1 - a) / a0;
  }
  run(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}
function put(b, i, v, pan = 0) {
  if (i < 0 || i >= N) return;
  b[0][i] += v * Math.sqrt((1 - pan) / 2) * 1.414;
  b[1][i] += v * Math.sqrt((1 + pan) / 2) * 1.414;
}

// Simple stereo reverb (Freeverb-style combs + allpasses)
function reverb(src, dst, wet, size = 0.86, damp = 0.3) {
  for (const [ch, spread] of [[0, 0], [1, 23]]) {
    const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((d) => ({ b: new Float32Array(d + spread), i: 0, f: 0 }));
    const aps = [556, 441, 341, 225].map((d) => ({ b: new Float32Array(d + spread), i: 0 }));
    for (let n = 0; n < N; n++) {
      const x = (src[0][n] + src[1][n]) * 0.015;
      let out = 0;
      for (const c of combs) {
        const y = c.b[c.i];
        c.f = y * (1 - damp) + c.f * damp;
        c.b[c.i] = x + c.f * size;
        c.i = (c.i + 1) % c.b.length;
        out += y;
      }
      for (const a of aps) {
        const y = a.b[a.i];
        a.b[a.i] = out + y * 0.5;
        a.i = (a.i + 1) % a.b.length;
        out = y - out;
      }
      dst[ch][n] += out * wet;
    }
  }
}

function writeWav(file, b, gain = 1) {
  let peak = 1e-9;
  for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(b[0][i]), Math.abs(b[1][i]));
  const g = gain / peak;
  const data = Buffer.alloc(N * 4);
  for (let i = 0; i < N; i++) {
    data.writeInt16LE(Math.round(Math.tanh(b[0][i] * g) * 32000), i * 4);
    data.writeInt16LE(Math.round(Math.tanh(b[1][i] * g) * 32000), i * 4 + 2);
  }
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8); h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22); h.writeUInt32LE(SR, 24);
  h.writeUInt32LE(SR * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, data]));
}

// ── score ──────────────────────────────────────────────────────────────────────
const tDemo = mark("demo"), tWhatIf = mark("whatif"), tMorning = mark("morning"), tDash = mark("dashboard");
const tClose = mark("close"), tBrand = mark("brand");
const BEAT = 60 / 96;
const CH = {
  Am: { n: [57, 60, 64], r: 45 }, F: { n: [53, 57, 60], r: 41 }, Dm: { n: [53, 57, 62], r: 38 }, E: { n: [52, 56, 59], r: 40 },
  C: { n: [52, 55, 60], r: 36 }, G: { n: [55, 59, 62], r: 43 }, Cbig: { n: [48, 55, 60, 64, 67], r: 36 },
};
const chords = [];
// A – the problem: dark, slow
["Am", "F", "Dm", "E"].forEach((c, i) => chords.push({ c, t0: (i * tDemo) / 4, t1: ((i + 1) * tDemo) / 4, sec: "A" }));
// B/C/D – the demo: F C G Am, two bars each, locked to the beat from the demo start
for (let t = tDemo, k = 0; t < tClose - 0.01; k++) {
  const len = 8 * BEAT;
  chords.push({ c: ["F", "C", "G", "Am"][k % 4], t0: t, t1: Math.min(t + len, tClose), sec: t < tMorning ? "B" : t < tDash ? "C" : "D" });
  t += len;
}
// E – the close: F G Am G, then a big C under "Made by"
["F", "G", "Am", "G"].forEach((c, i) => {
  const len = (tBrand - tClose) / 4;
  chords.push({ c, t0: tClose + i * len, t1: tClose + (i + 1) * len, sec: "E" });
});
chords.push({ c: "Cbig", t0: tBrand, t1: DUR - 1.2, sec: "F" });

const pad = buf(), dry = buf(), wetSend = buf(), music = buf();

function padChord(ch, t0, t1, gain) {
  const atk = 1.3, rel = 1.8;
  for (const m of CH[ch].n) {
    for (const [det, pan] of [[-0.09, -0.6], [0, 0], [0.08, 0.6]]) {
      const f = mtof(m + det);
      let ph = rnd();
      const s0 = idx(t0), s1 = idx(t1 + rel);
      for (let i = s0; i < s1; i++) {
        const t = i / SR;
        let env = Math.min(1, (t - t0) / atk);
        if (t > t1) env *= Math.max(0, 1 - (t - t1) / rel);
        ph += f / SR;
        if (ph >= 1) ph -= 1;
        put(pad, i, (2 * ph - 1) * env * env * gain, pan);
      }
    }
  }
}
function sub(root, t0, t1, gain) {
  const f = mtof(root), atk = 0.6, rel = 1.0;
  for (let i = idx(t0); i < idx(t1 + rel); i++) {
    const t = i / SR;
    let env = Math.min(1, (t - t0) / atk);
    if (t > t1) env *= Math.max(0, 1 - (t - t1) / rel);
    put(dry, i, Math.sin(2 * Math.PI * f * t) * env * gain, 0);
  }
}
function pluck(m, t, gain, decay, pan, target = wetSend) {
  const f = mtof(m);
  const s0 = idx(t), s1 = idx(t + decay * 6);
  for (let i = s0; i < s1; i++) {
    const x = (i - s0) / SR;
    const env = Math.min(1, x / 0.004) * Math.exp(-x / decay);
    const w = 2 * Math.PI * f * x;
    const v = (Math.sin(w) + 0.35 * Math.sin(2 * w) * Math.exp(-x * 6) + 0.12 * Math.sin(3 * w) * Math.exp(-x * 10)) * env * gain;
    put(target, i, v, pan);
    put(dry, i, v * 0.6, pan);
  }
}
function kick(t, gain) {
  const s0 = idx(t);
  let ph = 0;
  for (let i = s0; i < s0 + SR * 0.45; i++) {
    const x = (i - s0) / SR;
    ph += (48 + 95 * Math.exp(-x * 28)) / SR;
    put(dry, i, Math.sin(2 * Math.PI * ph) * Math.exp(-x * 7.5) * gain, 0);
  }
}
function hat(t, gain, open = false) {
  const hp = new Biquad("hp", 7500, 0.7), s0 = idx(t), d = open ? 0.25 : 0.05;
  for (let i = s0; i < s0 + SR * d * 3; i++) {
    const x = (i - s0) / SR;
    put(dry, i, hp.run(noise()) * Math.exp(-x / d) * gain, 0.25);
  }
}

for (const ch of chords) {
  const { c, t0, t1, sec } = ch;
  const padGain = { A: 0.05, B: 0.045, C: 0.04, D: 0.04, E: 0.055, F: 0.06 }[sec];
  padChord(c, t0, t1, padGain);
  if (sec === "A") {
    sub(33, t0, t1, 0.05); // low A drone
    for (let t = t0 + 0.6; t < t1 - 0.3; t += 1.55 + rnd() * 0.5) pluck(CH[c].n[Math.floor(rnd() * 3)] + 12, t, 0.07, 0.9, rnd() - 0.5);
  } else {
    sub(CH[c].r, t0, t1, sec === "F" ? 0.16 : 0.12);
    if (sec !== "F") {
      const notes = CH[c].n.map((m) => m + 12);
      const pat = [0, 1, 2, 1, 0, 2, 1, 2];
      let k = 0;
      for (let t = t0; t < t1 - 0.01; t += BEAT / 2, k++) {
        const g = sec === "C" ? 0.05 : sec === "E" ? 0.085 : 0.07;
        pluck(notes[pat[k % 8]] + (sec === "E" && k % 4 === 3 ? 12 : 0), t, g, 0.28, k % 2 ? 0.35 : -0.35);
      }
    }
  }
}
// drums
for (let t = tDemo, b = 0; t < tBrand - 0.05; t += BEAT, b++) {
  const inB = t < tMorning, inC = t >= tMorning && t < tDash, inE = t >= tClose;
  if (inC) continue; // breathe at 9 AM
  const bar = Math.floor(b / 4), beat = b % 4;
  if (beat === 0 || beat === 2 || inE) kick(t, inE ? 0.42 : 0.36);
  if (bar >= 2 || inE) {
    hat(t + BEAT / 2, inE ? 0.06 : 0.045);
    if (inE) hat(t, 0.03);
  }
  if (beat === 3 && bar % 4 === 3 && !inB) hat(t + BEAT / 2, 0.04, true);
}
// The final chord: low C bloom
pluck(36 + 12, tBrand, 0.12, 2.2, 0);
pluck(60 + 12, tBrand + 0.05, 0.06, 2.5, 0.3);

// pad filter: dark for the problem, opening up for the demo and the finish
{
  const lp = [new Biquad("lp", 700, 0.8), new Biquad("lp", 700, 0.8)];
  const cutoff = (t) => {
    if (t < tWhatIf) return 650 + 250 * (t / tWhatIf);
    if (t < tDemo) return 900 + 1300 * ((t - tWhatIf) / (tDemo - tWhatIf));
    if (t < tMorning) return 1700;
    if (t < tDash) return 1200;
    if (t < tClose) return 1600;
    if (t < tBrand) return 1800 + 900 * ((t - tClose) / (tBrand - tClose));
    return 2600 - 1800 * Math.min(1, (t - tBrand) / 5);
  };
  for (let i = 0; i < N; i++) {
    if (i % 64 === 0) {
      const f = cutoff(i / SR);
      lp[0].set("lp", f, 0.8);
      lp[1].set("lp", f, 0.8);
    }
    const l = lp[0].run(pad[0][i]), r = lp[1].run(pad[1][i]);
    music[0][i] += l;
    music[1][i] += r;
    wetSend[0][i] += l * 0.6;
    wetSend[1][i] += r * 0.6;
  }
}
for (let i = 0; i < N; i++) {
  music[0][i] += dry[0][i];
  music[1][i] += dry[1][i];
}
reverb(wetSend, music, 1.4, 0.88, 0.35);
// fade out the very end
for (let i = idx(DUR - 2.5); i < N; i++) {
  const g = Math.max(0, 1 - (i / SR - (DUR - 2.5)) / 2.5);
  music[0][i] *= g;
  music[1][i] *= g;
}

// ── sound effects ─────────────────────────────────────────────────────────────
const fx = buf(), fxWet = buf();
function sweep(t, dur, f0, f1, gain, pan0 = -0.5, pan1 = 0.5, q = 1.2) {
  const bp = new Biquad("bp", f0, q), s0 = idx(t), n = Math.round(dur * SR);
  for (let k = 0; k < n; k++) {
    const x = k / n;
    if (k % 16 === 0) bp.set("bp", f0 * Math.pow(f1 / f0, x), q);
    const env = Math.pow(Math.sin(Math.PI * Math.min(1, x * 1.15)), 2);
    const v = bp.run(noise()) * env * gain;
    put(fx, s0 + k, v, pan0 + (pan1 - pan0) * x);
    put(fxWet, s0 + k, v * 0.5, 0);
  }
}
function impact(t, gain) {
  const s0 = idx(t);
  let ph = 0;
  const lp = new Biquad("lp", 900, 0.7);
  for (let k = 0; k < SR * 2.4; k++) {
    const x = k / SR;
    ph += (36 + 40 * Math.exp(-x * 5)) / SR;
    const boom = Math.sin(2 * Math.PI * ph) * Math.exp(-x * 1.6);
    const crack = lp.run(noise()) * Math.exp(-x * 14) * 0.9;
    put(fx, s0 + k, (boom + crack) * gain, 0);
    put(fxWet, s0 + k, crack * gain * 0.8, 0);
  }
}
function riser(t0, t1, gain) {
  const bp = new Biquad("bp", 300, 2), s0 = idx(t0), n = Math.round((t1 - t0) * SR);
  let ph = 0;
  for (let k = 0; k < n; k++) {
    const x = k / n;
    if (k % 16 === 0) bp.set("bp", 300 * Math.pow(25, x), 2);
    ph += (180 * Math.pow(4, x)) / SR;
    const env = Math.pow(x, 2.2);
    const v = (bp.run(noise()) * 0.9 + Math.sin(2 * Math.PI * ph) * 0.15) * env * gain;
    put(fx, s0 + k, v, Math.sin(x * 12) * 0.3);
    put(fxWet, s0 + k, v * 0.6, 0);
  }
}
function tone(t, f, dur, gain, pan = 0, partials = [[1, 1]], decay = 6, glideTo = null) {
  const s0 = idx(t), n = Math.round(dur * SR);
  const phs = partials.map(() => 0);
  for (let k = 0; k < n; k++) {
    const x = k / SR;
    const ff = glideTo ? f * Math.pow(glideTo / f, Math.min(1, x / dur)) : f;
    const env = Math.min(1, x / 0.003) * Math.exp(-x * decay);
    let v = 0;
    partials.forEach(([mult, amp], j) => {
      phs[j] += (ff * mult) / SR;
      v += Math.sin(2 * Math.PI * phs[j]) * amp;
    });
    put(fx, s0 + k, v * env * gain, pan);
    put(fxWet, s0 + k, v * env * gain * 0.35, pan);
  }
}
const BELL = [[1, 1], [2.76, 0.35], [5.4, 0.12]];
function click(t, gain) {
  const hp = new Biquad("hp", 2500, 0.7), s0 = idx(t);
  for (let k = 0; k < SR * 0.02; k++) put(fx, s0 + k, hp.run(noise()) * Math.exp(-k / (SR * 0.003)) * gain, 0.1);
  tone(t, 1900, 0.03, gain * 0.25, 0.1, [[1, 1]], 120);
}

// Soft UI sounds for chat bubbles (no pitch glides – those sounded like toys)
function airSwish(t, gain) {
  // sent: a short, airy "fft" – band-passed noise that brightens quickly
  const bp = new Biquad("bp", 2200, 1.4), s0 = idx(t), n = Math.round(0.11 * SR);
  for (let k = 0; k < n; k++) {
    const x = k / n;
    if (k % 8 === 0) bp.set("bp", 2200 + 3800 * x, 1.4);
    const env = Math.sin(Math.PI * Math.pow(x, 0.6)) * (1 - x);
    put(fx, s0 + k, bp.run(noise()) * env * gain, 0.3);
  }
  tone(t + 0.06, 1760, 0.05, gain * 0.18, 0.3, [[1, 1]], 70); // tiny tick at the end
}
function softTock(t, gain) {
  // received: muted wooden "tock" in C major (G5 with a soft body note), very short
  tone(t, 783.99, 0.18, gain, -0.25, [[1, 1], [3.98, 0.08]], 26);
  tone(t, 392, 0.12, gain * 0.35, -0.25, [[1, 1]], 32);
}

let lastRecv = -9;
let lastSend = -9;
for (const { t, kind } of tl.cues) {
  switch (kind) {
    case "whoosh": sweep(t - 0.15, 0.85, 260, 2600, 0.5); break;
    case "whooshOut": sweep(t, 0.75, 2400, 220, 0.42, 0.5, -0.5); break;
    case "swell": sweep(t - 0.3, 1.8, 150, 1100, 0.32, -0.2, 0.2, 0.8); break;
    case "impact": sweep(t - 0.2, 0.5, 400, 3000, 0.3); impact(t, 0.95); break;
    case "riser": riser(t, tDemo, 0.6); break;
    case "send":
      if (t - lastSend < 0.8) break;
      lastSend = t;
      airSwish(t, 0.11);
      break;
    case "recv":
      // one sound per reply, not per bubble
      if (t - lastRecv < 1.6) {
        lastRecv = t;
        break;
      }
      lastRecv = t;
      softTock(t, 0.07);
      break;
    case "ding": tone(t, 1318.5, 0.9, 0.09, 0.4, BELL, 5); tone(t + 0.13, 1760, 1.1, 0.09, 0.4, BELL, 4.5); break;
    case "tap": click(t, 0.22); break;
    case "sheet": sweep(t, 0.45, 500, 2200, 0.22, 0, 0, 1.5); break;
    case "success": [1046.5, 1318.5, 1568].forEach((f, i) => tone(t + i * 0.09, f, 1.4, 0.1, -0.2 + i * 0.2, BELL, 3.2)); break;
  }
}
reverb(fxWet, fx, 0.9, 0.84, 0.4);

writeWav(path.join(BUILD, "music.wav"), music, 0.85);
writeWav(path.join(BUILD, "sfx.wav"), fx, 0.9);
console.log("Score and sound effects ready");

// ── ffmpeg ─────────────────────────────────────────────────────────────────────
function findFfmpeg() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return "ffmpeg";
  } catch {}
  const winget = path.join(process.env.LOCALAPPDATA || "", "Microsoft/WinGet/Packages");
  if (fs.existsSync(winget)) {
    for (const d of fs.readdirSync(winget).filter((x) => x.toLowerCase().includes("ffmpeg"))) {
      const stack = [path.join(winget, d)];
      while (stack.length) {
        const cur = stack.pop();
        for (const f of fs.readdirSync(cur, { withFileTypes: true })) {
          const p = path.join(cur, f.name);
          if (f.isDirectory()) stack.push(p);
          else if (f.name.toLowerCase() === "ffmpeg.exe") return p;
        }
      }
    }
  }
  throw new Error("ffmpeg not found");
}
const ffmpeg = findFfmpeg();
const ffprobe = ffmpeg === "ffmpeg" ? "ffprobe" : path.join(path.dirname(ffmpeg), "ffprobe.exe");
const durOf = (f) => Number(execFileSync(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString().trim());
const silent = path.join(VID, "activewear33-pitch-silent.mp4");

// ── voice-over ─────────────────────────────────────────────────────────────────
// ElevenLabs (default voice "Eric") when ELEVENLABS_API_KEY is in .env; otherwise the
// Windows robot voice as a timing draft. Pass --robot to force the robot draft.
const useEleven = !!process.env.ELEVENLABS_API_KEY && !process.argv.includes("--robot");
let voiceFiles = [];
let voiceLabel = "";

async function elevenLines() {
  const KEY = process.env.ELEVENLABS_API_KEY;
  const API = "https://api.elevenlabs.io/v1";
  const api = async (p, opts = {}) => {
    const r = await fetch(API + p, { ...opts, headers: { "xi-api-key": KEY, ...(opts.headers || {}) } });
    if (!r.ok) throw new Error(`ElevenLabs ${r.status}: ${(await r.text()).slice(0, 300)}`);
    return r;
  };
  const KNOWN = { eric: "cjVigY5qzO86Huf0OWal" }; // used when the key can't list voices
  const wanted = process.env.ELEVENLABS_VOICE || "Eric";
  let voiceId = process.env.ELEVENLABS_VOICE_ID || KNOWN[wanted.toLowerCase()];
  if (!voiceId) {
    const { voices } = await (await api("/voices")).json();
    const v = voices.find((x) => x.name.toLowerCase().startsWith(wanted.toLowerCase()));
    if (!v) throw new Error(`No voice called "${wanted}" in your ElevenLabs account`);
    voiceId = v.voice_id;
  }
  const model = process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2";
  const out = [];
  for (const [i, v] of VO.entries()) {
    const hash = crypto.createHash("sha1").update([voiceId, model, v.say].join("|")).digest("hex").slice(0, 12);
    const file = path.join(BUILD, `el-${hash}.mp3`);
    if (!fs.existsSync(file)) {
      const r = await api(`/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify({
          text: v.say,
          model_id: model,
          // neighbouring lines help the voice keep one consistent tone across the script
          previous_text: i > 0 ? VO[i - 1].say : undefined,
          next_text: i + 1 < VO.length ? VO[i + 1].say : undefined,
          voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.2, use_speaker_boost: true },
        }),
      });
      fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
      process.stdout.write(`  line ${i + 1} voiced\n`);
    }
    out.push(file);
  }
  voiceLabel = wanted.toLowerCase();
  return out;
}

function robotLines() {
  if (process.platform !== "win32") return [];
  fs.writeFileSync(path.join(BUILD, "vo.json"), JSON.stringify(VO.map((v) => v.robot)));
  fs.writeFileSync(
    path.join(BUILD, "vo.ps1"),
    `Add-Type -AssemblyName System.Speech
$lines = Get-Content -Raw -Encoding UTF8 '${path.join(BUILD, "vo.json")}' | ConvertFrom-Json
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
try { $s.SelectVoice('Microsoft Zira Desktop') } catch {}
$s.Rate = 0
for ($i = 0; $i -lt $lines.Count; $i++) {
  $s.SetOutputToWaveFile('${BUILD}\\vo' + $i.ToString('00') + '.wav')
  $s.Speak($lines[$i])
}
$s.SetOutputToNull(); $s.Dispose()`
  );
  execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(BUILD, "vo.ps1")], { stdio: "inherit" });
  voiceLabel = "robot-voice";
  return VO.map((_, i) => path.join(BUILD, `vo${String(i).padStart(2, "0")}.wav`));
}

const rawVoice = useEleven ? await elevenLines() : robotLines();
const maxTempo = useEleven ? 1.1 : 1.25; // a natural voice sounds rushed if sped up much
voiceFiles = rawVoice.map((file, i) => {
  const v = VO[i];
  const start = mark(v.at) + v.d;
  const next = i + 1 < VO.length ? mark(VO[i + 1].at) + VO[i + 1].d : mark("brand");
  const slot = next - start - 0.25;
  const len = durOf(file);
  const tempo = len > slot ? Math.min(maxTempo, len / slot) : 1;
  if (len / tempo > slot + 0.05) console.log(`  ⚠ line ${i + 1} runs ${(len / tempo - slot).toFixed(1)} s into the next scene`);
  return { file, start, tempo };
});
if (voiceFiles.length) console.log(`Voice (${useEleven ? "ElevenLabs " + voiceLabel : "robot draft"}): ${voiceFiles.length} lines placed`);


// ── mix ────────────────────────────────────────────────────────────────────────
const musicWav = path.join(BUILD, "music.wav");
const sfxWav = path.join(BUILD, "sfx.wav");
const encode = ["-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-shortest"];

// 1) music + effects only
execFileSync(ffmpeg, [
  "-y", "-loglevel", "error", "-i", silent, "-i", musicWav, "-i", sfxWav,
  "-filter_complex", "[1:a]volume=0.62[m];[2:a]volume=0.8[f];[m][f]amix=inputs=2:normalize=0,alimiter=limit=0.95,loudnorm=I=-15:TP=-1.5:LRA=11[a]",
  "-map", "0:v", "-map", "[a]", ...encode, path.join(VID, "activewear33-pitch-music-only.mp4"),
], { stdio: "inherit" });
console.log("Saved video/activewear33-pitch-music-only.mp4");

// 2) with the robot voice, music ducking under it
if (voiceFiles.length) {
  const inputs = ["-i", silent, "-i", musicWav, "-i", sfxWav];
  const parts = [];
  voiceFiles.forEach((v, i) => {
    inputs.push("-i", v.file);
    const ms = Math.round(v.start * 1000);
    parts.push(`[${i + 3}:a]aresample=44100,aformat=channel_layouts=stereo,atempo=${v.tempo.toFixed(3)},adelay=${ms}|${ms}[v${i}]`);
  });
  const vs = voiceFiles.map((_, i) => `[v${i}]`).join("");
  const graph = [
    ...parts,
    `${vs}amix=inputs=${voiceFiles.length}:normalize=0,highpass=f=90,${useEleven ? "" : "equalizer=f=3000:t=q:w=1:g=3,"}acompressor=threshold=-22dB:ratio=3:attack=5:release=120,${useEleven ? "volume=1.5" : "volume=2.2"}[vo]`,
    `[vo]asplit=2[vo1][key]`,
    `[1:a]volume=0.62[m]`,
    `[m][key]sidechaincompress=threshold=0.015:ratio=7:attack=40:release=700[md]`,
    `[2:a]volume=0.7[f]`,
    `[vo1][md][f]amix=inputs=3:normalize=0,alimiter=limit=0.95,loudnorm=I=-15:TP=-1.5:LRA=11[a]`,
  ].join(";");
  execFileSync(ffmpeg, ["-y", "-loglevel", "error", ...inputs, "-filter_complex", graph, "-map", "0:v", "-map", "[a]", ...encode, path.join(VID, `activewear33-pitch-${voiceLabel}.mp4`)], { stdio: "inherit" });
  console.log(`Saved video/activewear33-pitch-${voiceLabel}.mp4`);
}
