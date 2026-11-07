// 20-second voice sample: two script lines in an ElevenLabs voice (default "Eric"),
// mixed over the matching part of the pitch video (score + effects, music ducks).
//
//   1. Put your key in .env:  ELEVENLABS_API_KEY=...
//   2. node voice-sample.mjs            (or: node voice-sample.mjs "Brian" to try another voice)
//   → video/sample-<voice>.mp4
//
// Uses about 250 characters of ElevenLabs credit.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.join(here, ".env"));
} catch {}
const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) {
  console.error("Add ELEVENLABS_API_KEY=your-key to the .env file in this folder first.");
  process.exit(1);
}
const VID = path.join(here, "video");
const BUILD = path.join(VID, ".build");
fs.mkdirSync(BUILD, { recursive: true });

const API = "https://api.elevenlabs.io/v1";
async function api(p, opts = {}) {
  const r = await fetch(API + p, { ...opts, headers: { "xi-api-key": KEY, ...(opts.headers || {}) } });
  if (!r.ok) throw new Error(`ElevenLabs ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r;
}

// Voice: by name from your account (default Eric), or ELEVENLABS_VOICE_ID
const wanted = process.argv[2] || process.env.ELEVENLABS_VOICE || "Eric";
let voiceId = process.env.ELEVENLABS_VOICE_ID;
let voiceName = wanted;
// Premade voice IDs, used when the key isn't allowed to list voices.
const KNOWN = { eric: "cjVigY5qzO86Huf0OWal" };
if (!voiceId) {
  try {
    const { voices } = await (await api("/voices")).json();
    const v = voices.find((x) => x.name.toLowerCase().startsWith(wanted.toLowerCase()));
    if (!v) throw new Error(`No voice called "${wanted}" in your account. You have: ${voices.map((x) => x.name.split(" ")[0]).join(", ")}`);
    voiceId = v.voice_id;
    voiceName = v.name;
  } catch (err) {
    if (!/missing_permissions|voices_read/.test(err.message) || !KNOWN[wanted.toLowerCase()]) throw err;
    voiceId = KNOWN[wanted.toLowerCase()];
    console.log(`(key can't list voices – using the known ID for ${wanted})`);
  }
}
// Model: newest text-to-speech model your account has, unless ELEVENLABS_MODEL is set
let model = process.env.ELEVENLABS_MODEL;
if (!model) {
  try {
    const models = await (await api("/models")).json();
    const ids = models.filter((m) => m.can_do_text_to_speech).map((m) => m.model_id);
    model = ids.find((id) => /v4/.test(id)) || ids.find((id) => /v3/.test(id)) || (ids.includes("eleven_multilingual_v2") ? "eleven_multilingual_v2" : ids[0]);
  } catch {
    model = "eleven_multilingual_v2";
  }
}
console.log(`Voice: ${voiceName} · model: ${model}`);

const tl = JSON.parse(fs.readFileSync(path.join(VID, "timeline.json"), "utf8"));
const at = (k) => tl.marks.find((m) => m.key === k).t;
const lines = [
  { t: at("whatif") + 0.3, text: "So what if every DM got a reply in seconds… even at 1 AM?" },
  { t: at("demo") + 0.6, text: "Here's a customer at 1 AM, sharing your Real Madrid reel and asking, “Price?” They get the price, the sizes, and your Diwali offer straight away. In Tanglish, the way your team talks." },
];

const files = [];
for (const [i, l] of lines.entries()) {
  const r = await api(`/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({
      text: l.text,
      model_id: model,
      voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.2, use_speaker_boost: true },
    }),
  });
  const f = path.join(BUILD, `sample-${i}.mp3`);
  fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
  files.push(f);
}

// ffmpeg (same lookup as the other scripts)
function findFfmpeg() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return "ffmpeg";
  } catch {}
  const winget = path.join(process.env.LOCALAPPDATA || "", "Microsoft/WinGet/Packages");
  for (const d of fs.existsSync(winget) ? fs.readdirSync(winget).filter((x) => x.toLowerCase().includes("ffmpeg")) : []) {
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
  throw new Error("ffmpeg not found");
}
const ffmpeg = findFfmpeg();

const start = at("whatif") - 1.0;
const len = at("step:reel:3") - start + 0.5;
const d = lines.map((l) => Math.round((l.t - start) * 1000));
const out = path.join(VID, `sample-${voiceName.split(" ")[0].toLowerCase()}.mp4`);
execFileSync(ffmpeg, [
  "-y", "-loglevel", "error",
  "-ss", start.toFixed(2), "-t", len.toFixed(2), "-i", path.join(VID, "activewear33-pitch-music-only.mp4"),
  "-i", files[0], "-i", files[1],
  "-filter_complex",
  [
    `[1:a]aformat=channel_layouts=stereo,aresample=44100,adelay=${d[0]}|${d[0]}[a]`,
    `[2:a]aformat=channel_layouts=stereo,aresample=44100,adelay=${d[1]}|${d[1]}[b]`,
    `[a][b]amix=inputs=2:normalize=0,highpass=f=80,acompressor=threshold=-20dB:ratio=2.5:attack=5:release=150,volume=1.4[vo]`,
    `[vo]asplit=2[vo1][key]`,
    `[0:a][key]sidechaincompress=threshold=0.02:ratio=6:attack=40:release=700[md]`,
    `[vo1][md]amix=inputs=2:normalize=0,alimiter=limit=0.95,loudnorm=I=-15:TP=-1.5:LRA=11,afade=t=out:st=${(len - 1).toFixed(2)}:d=1[aout]`,
  ].join(";"),
  "-map", "0:v", "-map", "[aout]", "-c:v", "libx264", "-crf", "20", "-preset", "fast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
  "-vf", `fade=t=out:st=${(len - 1).toFixed(2)}:d=1`,
  out,
], { stdio: "inherit" });
console.log("Saved", out);
