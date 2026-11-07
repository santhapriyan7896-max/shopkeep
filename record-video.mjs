// Records pitch.html into a 1080p MP4 (H.264, plays on WhatsApp / Instagram / phones).
//
// Needs: the demo server running (npm start), Google Chrome or Edge, and ffmpeg.
// Run:   node record-video.mjs            (optional: --phone "+91 98xxx xxxxx" for a contact line)
// Output: video/activewear33-pitch-silent.mp4 + video/timeline.json (scene marks + sound cues)
// Then:   node make-audio.mjs              → adds music, sound effects and the voice-over

import puppeteer from "puppeteer-core";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "video");
fs.mkdirSync(outDir, { recursive: true });
const raw = path.join(outDir, "raw-recording.mp4");
const final = path.join(outDir, "activewear33-pitch-silent.mp4");

const args = process.argv.slice(2);
const params = new URLSearchParams();
const phoneArg = args.indexOf("--phone");
if (phoneArg >= 0 && args[phoneArg + 1]) params.set("phone", args[phoneArg + 1]);
const url = `http://localhost:${process.env.PORT || 3033}/pitch.html?${params}`;

const browserPath = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
].find((p) => p && fs.existsSync(p));
if (!browserPath) throw new Error("Chrome or Edge not found. Set CHROME_PATH.");

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
  throw new Error("ffmpeg not found. Install it (winget install ffmpeg) or set FFMPEG_PATH.");
}
const ffmpeg = findFfmpeg();

console.log("Recording", url);
const browser = await puppeteer.launch({
  executablePath: browserPath,
  headless: true,
  args: ["--window-size=1920,1080", "--hide-scrollbars", "--force-device-scale-factor=1", "--autoplay-policy=no-user-gesture-required"],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
page.on("pageerror", (e) => console.error("page error:", e.message));
await page.goto(url, { waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 1500)); // let both demo frames settle

let recording;
let usedScreencast = false;
let recStartEpoch = 0;
try {
  recording = await page.record({ path: raw, fps: 30, maxWidth: 1920, maxHeight: 1080 });
} catch (err) {
  console.log("page.record not available (" + err.message + "), using screencast + ffmpeg");
  usedScreencast = true;
  recording = await page.screencast({ path: raw.replace(/\.mp4$/, ".webm"), ffmpegPath: ffmpeg, fps: 30, quality: 18 });
}
recStartEpoch = Date.now();

const t0 = Date.now();
await page.evaluate(() => window.startFilm());
await page.waitForFunction("window.__filmDone === true", { timeout: 6 * 60 * 1000, polling: 500 });
const { marks, cues, filmStartEpoch } = await page.evaluate(() => ({ marks: window.__marks, cues: window.__cues, filmStartEpoch: window.__filmStartEpoch }));
await new Promise((r) => setTimeout(r, 1200));
await recording.stop();
// The recording starts a moment before the film: cut that lead-in so t=0 is the film's first frame.
const offset = Math.max(0, (filmStartEpoch - recStartEpoch) / 1000);
const duration = marks.at(-1).t + 0.6;
fs.writeFileSync(path.join(outDir, "timeline.json"), JSON.stringify({ duration, marks, cues }, null, 2));
for (const m of marks.filter((m) => !m.key.startsWith("step:"))) console.log(m.t.toFixed(1).padStart(6) + "s  " + m.label);
console.log(`${cues.length} sound cues logged, trimming ${offset.toFixed(2)} s of lead-in`);
await browser.close();
console.log(`Captured ${((Date.now() - t0) / 1000).toFixed(1)} s`);

// Re-encode: H.264 + yuv420p + faststart → plays everywhere, small file.
const src = usedScreencast ? raw.replace(/\.mp4$/, ".webm") : raw;
execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-i", src, "-ss", offset.toFixed(3), "-t", duration.toFixed(3), "-vf", "scale=1920:1080:flags=lanczos,fps=30", "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", final], { stdio: "inherit" });
console.log("Saved", final);
