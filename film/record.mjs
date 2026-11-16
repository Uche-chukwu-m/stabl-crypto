// Records the pitch demo, one clip per talking point, and composes the finished
// videos. Run against a production build of the app on the local database:
//
//   npm run build && npx next start -p 3100     (in one terminal)
//   npm run film                                 (in another)
//
// A fresh film copy of Jemaya is seeded each run, so the live demo account is never
// touched. Output: ../pitch-video (or FILM_OUT).
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { composeBeat, composeEndCard, concatClips, durationOf } from "./compose.mjs";
import { PHONE } from "./layout.mjs";
import { renderStage } from "./stage.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const BASE = process.env.FILM_BASE ?? "http://localhost:3100";
const OUT = path.resolve(process.env.FILM_OUT ?? path.join(ROOT, "..", "pitch-video"));
const WORK = path.join(OUT, ".work");
const ADMIN_KEY = readFileSync(path.join(ROOT, ".env.local"), "utf8").match(/^ADMIN_KEY=(.+)$/m)?.[1]?.trim();
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// A finger on the glass: a soft dot wherever a touch lands, following drags.
// Only the recording browser gets this; the app has nothing like it.
const TOUCH_DOTS = `(() => {
  const css = ".film-touch{position:fixed;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;background:rgba(251,249,244,.62);box-shadow:0 0 0 2px rgba(22,36,29,.26),0 6px 18px rgba(22,36,29,.22);pointer-events:none;z-index:2147483647;transform:scale(.55);transition:transform .14s ease-out,opacity .38s ease}";
  const style = () => { if (document.getElementById("film-touch-css")) return; const s = document.createElement("style"); s.id = "film-touch-css"; s.textContent = css; document.documentElement.appendChild(s); };
  let dot = null;
  const at = (t) => { dot.style.left = t.clientX + "px"; dot.style.top = t.clientY + "px"; };
  addEventListener("touchstart", (e) => { style(); dot = document.createElement("div"); dot.className = "film-touch"; at(e.touches[0]); document.documentElement.appendChild(dot); requestAnimationFrame(() => dot && (dot.style.transform = "scale(1)")); }, { capture: true, passive: true });
  addEventListener("touchmove", (e) => dot && at(e.touches[0]), { capture: true, passive: true });
  addEventListener("touchend", () => { const d = dot; dot = null; if (!d) return; d.style.opacity = "0"; d.style.transform = "scale(1.3)"; setTimeout(() => d.remove(), 420); }, { capture: true, passive: true });
})();`;

// The talking points: one clip each, with the line the speaker might say.
const BEAT_INFO = [
  { key: "01-meet-jemaya", title: "Meet Jemaya", line: "This is Jemaya, a freelance designer. Some months pay well, some barely pay at all." },
  { key: "02-big-client-pays", title: "A big client pays", line: "A big client pays. Stabl notices the extra, $650, and tells Jemaya before anything moves." },
  { key: "03-tucked-away", title: "Tucked away", line: "The next day, the extra moves into her vault. Her bills stay covered." },
  { key: "04-slow-week", title: "A slow week", line: "Then work dries up and the car needs a repair. Stabl sends money back right away. No forms, no asking." },
  { key: "05-emergency", title: "Emergency unlock", line: "And if something urgent comes up, Jemaya can unlock her vault the same day, with a code sent to a second channel." },
  { key: "06-every-move-messaged", title: "Every move gets a message", line: "Every move gets a message. Nothing happens silently. Jemaya always knows where her money is." },
];

async function admin(action, body) {
  const res = await fetch(`${BASE}/api/admin/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-key": ADMIN_KEY },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`admin ${action}: ${json.error}`);
  return json;
}

function seedFilmUser() {
  const out = execFileSync("npx", ["tsx", "scripts/film-seed.ts"], { cwd: ROOT, env: { ...process.env, APP_URL: BASE }, encoding: "utf8" });
  return JSON.parse(out.trim().split("\n").at(-1));
}

async function main() {
  if (!ADMIN_KEY) throw new Error("ADMIN_KEY missing from .env.local");
  await fetch(`${BASE}/signin`).catch(() => {
    throw new Error(`Start the app first: npx next start -p 3100 (expected at ${BASE})`);
  });

  // --compose rebuilds the clips from the last recording without recording again.
  const composeOnly = process.argv.includes("--compose");
  if (!composeOnly) {
    rmSync(WORK, { recursive: true, force: true });
    mkdirSync(WORK, { recursive: true });
  }
  console.log("Rendering the stage");
  await renderStage(path.join(WORK, "stage"));
  if (composeOnly) return compose(BEAT_INFO.map((b) => ({ ...b, dir: path.join(WORK, b.key) })));

  console.log("Seeding a fresh film copy of Jemaya");
  const { userId, loginUrl } = seedFilmUser();

  // The screen capture follows the browser window, not the emulated device, so the
  // window is sized to the phone and drawn at the phone's pixel density.
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: [`--window-size=${PHONE.width},${PHONE.height}`, `--force-device-scale-factor=${PHONE.scale}`],
  });
  const context = await browser.newContext({
    viewport: { width: PHONE.width, height: PHONE.height },
    deviceScaleFactor: PHONE.scale,
    isMobile: true,
    hasTouch: true,
    timezoneId: "America/Chicago",
    colorScheme: "light",
    reducedMotion: "no-preference",
  });
  await context.addInitScript(TOUCH_DOTS);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: PHONE.safeTop, bottom: PHONE.safeBottom, left: 0, right: 0 } });

  // Hold new messages back while a beat is being set up, so a banner never
  // appears before the camera is rolling. Released on cue with reveal().
  let held = false;
  const lastSeen = {};
  await page.route(/\/api\/messages(\/latest)?(\?.*)?$/, async (route) => {
    const req = route.request();
    if (req.method() !== "GET") return route.continue();
    const key = new URL(req.url()).pathname;
    if (held && lastSeen[key]) return route.fulfill({ status: 200, contentType: "application/json", body: lastSeen[key] });
    const res = await route.fetch();
    lastSeen[key] = await res.text();
    return route.fulfill({ response: res, body: lastSeen[key] });
  });
  const hold = () => (held = true);
  const reveal = async () => {
    held = false;
    await page.evaluate(() => window.dispatchEvent(new Event("stabl:check-messages")));
  };

  // Recording: every frame Chrome paints, with the moment it arrived.
  let rec = null;
  cdp.on("Page.screencastFrame", async (f) => {
    await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
    if (!rec) return;
    const file = `${String(rec.frames.length).padStart(5, "0")}.jpg`;
    rec.frames.push({ file, at: Date.now() - rec.t0 });
    writeFileSync(path.join(rec.dir, file), Buffer.from(f.data, "base64"));
  });
  const startRec = async (dir) => {
    mkdirSync(dir, { recursive: true });
    rec = { dir, frames: [], t0: Date.now() };
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: PHONE.width * PHONE.scale, maxHeight: PHONE.height * PHONE.scale });
  };
  const stopRec = async () => {
    const endAt = Date.now() - rec.t0;
    await cdp.send("Page.stopScreencast");
    await new Promise((r) => setTimeout(r, 150));
    writeFileSync(path.join(rec.dir, "timing.json"), JSON.stringify({ frames: rec.frames, endAt }));
    const n = rec.frames.length;
    rec = null;
    return { frames: n, seconds: endAt / 1000 };
  };

  const wait = (ms) => page.waitForTimeout(ms);
  const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
  const tap = async (locator, before = 500) => {
    await locator.waitFor({ state: "visible" });
    const b = await locator.boundingBox();
    await wait(before);
    await touch("touchStart", b.x + b.width / 2, b.y + b.height / 2);
    await wait(120);
    await touch("touchEnd");
  };
  const drag = async (from, to, ms, holdEnd = 0) => {
    await touch("touchStart", from.x, from.y);
    const steps = Math.max(2, Math.round(ms / 16));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      await touch("touchMove", from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e);
      await wait(16);
    }
    if (holdEnd) await wait(holdEnd);
    await touch("touchEnd");
  };
  const scrollTo = (top, ms) =>
    page.evaluate(
      ({ top, ms }) =>
        new Promise((done) => {
          const from = window.scrollY;
          const end = top === "bottom" ? document.documentElement.scrollHeight - innerHeight : top;
          const t0 = performance.now();
          const step = (now) => {
            const t = Math.min(1, (now - t0) / ms);
            const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
            window.scrollTo(0, from + (end - from) * e);
            if (t < 1) requestAnimationFrame(step);
            else done();
          };
          requestAnimationFrame(step);
        }),
      { top, ms },
    );
  const latestTemplate = async () => (await (await page.request.get(`${BASE}/api/messages/latest`)).json()).latest?.template;
  const tab = (name) => page.locator('nav[aria-label="Tabs"]').getByRole("link", { name });

  // Signed in before the cameras roll.
  await page.goto(loginUrl);
  await page.getByRole("button", { name: "Open the demo" }).click();
  await page.waitForURL(/\/home/);
  await page.setContent('<html style="background:#F1EEE3"><body></body></html>');

  const beats = [
    {
      ...BEAT_INFO[0],
      async run() {
        await startRec(this.dir);
        await page.goto(`${BASE}/home`);
        await page.evaluate(() => document.fonts.ready);
        await wait(2600);
        const chart = page.locator("figure svg").first();
        await scrollTo(Math.max(0, (await chart.evaluate((el) => el.getBoundingClientRect().top + window.scrollY)) - 300), 1100);
        await wait(500);
        const b = await chart.boundingBox();
        // From midsummer, when the vault starts to fill, to today.
        await drag({ x: b.x + b.width * 0.5, y: b.y + b.height * 0.6 }, { x: b.x + b.width * 0.97, y: b.y + b.height * 0.5 }, 2600, 700);
        await wait(900);
        await scrollTo(0, 900);
        await wait(700);
        return stopRec();
      },
    },
    {
      ...BEAT_INFO[1],
      async run() {
        hold();
        const r = await admin("inject", { userId, event: "big_client" });
        console.log("   engine:", r.actions.map((a) => a.type).join(", "));
        await startRec(this.dir);
        await wait(1100);
        await reveal();
        const banner = page.getByRole("status").filter({ hasText: "Good stretch" });
        await banner.waitFor({ timeout: 8000 });
        await wait(2600);
        await tap(banner, 200);
        await page.waitForURL(/\/messages/);
        await page.getByRole("button", { name: "Stop it" }).last().waitFor();
        await wait(3000);
        return stopRec();
      },
    },
    {
      ...BEAT_INFO[2],
      async run() {
        hold();
        await admin("advance", { userId, days: 1 });
        console.log("   latest message:", await latestTemplate());
        await startRec(this.dir);
        await wait(900);
        await reveal();
        await page.getByText(/Moved \$[\d,]+\.00 to your vault/).last().waitFor({ timeout: 8000 });
        await wait(2400);
        await tap(tab("Home"));
        await page.getByText("Tucked away").waitFor({ timeout: 8000 });
        await wait(3600);
        return stopRec();
      },
    },
    {
      ...BEAT_INFO[3],
      async run() {
        await page.waitForTimeout(1500);
        await scrollTo(0, 10);
        hold();
        const r = await admin("inject", { userId, event: "slow_week" });
        console.log("   engine:", r.actions.map((a) => a.type).join(", "));
        // If the week's bills are not due yet, let days pass until the release lands.
        for (let day = 0; day < 7 && (await latestTemplate()) !== "release"; day++) await admin("advance", { userId, days: 1 });
        console.log("   latest message:", await latestTemplate());
        await startRec(this.dir);
        await wait(1000);
        await reveal();
        // "Slow week, so we sent..." or, with no income at all, "Income came in well under normal..., so we sent..."
        await page.getByRole("status").filter({ hasText: /we sent \$/ }).waitFor({ timeout: 8000 });
        await wait(2600);
        await drag({ x: 195, y: 230 }, { x: 195, y: 520 }, 650, 300);
        await page.getByText("Sent back. You are covered.").waitFor({ timeout: 8000 });
        await wait(3800);
        return stopRec();
      },
    },
    {
      ...BEAT_INFO[4],
      async run() {
        await scrollTo(0, 10);
        await startRec(this.dir);
        await wait(900);
        await tap(page.getByRole("link", { name: "Emergency" }));
        const sheet = page.getByRole("dialog", { name: "Emergency unlock" });
        await sheet.waitFor();
        await wait(1300);
        await tap(sheet.getByRole("button", { name: "Send me a code" }));
        const codeField = sheet.getByLabel("Code from your messages");
        await codeField.waitFor({ timeout: 8000 });
        const banner = page.getByRole("status").filter({ hasText: "Your code is" });
        await banner.waitFor({ timeout: 8000 });
        const code = (await banner.textContent()).match(/code is (\d{6})/)[1];
        await wait(2400);
        await tap(codeField, 200);
        await page.keyboard.type(code, { delay: 150 });
        await tap(sheet.getByPlaceholder("150"), 350);
        await page.keyboard.type("150", { delay: 180 });
        await tap(sheet.getByRole("button", { name: "Send to checking" }), 600);
        await page.getByText("$150.00 sent to checking").waitFor({ timeout: 8000 });
        await wait(3000);
        return stopRec();
      },
    },
    {
      ...BEAT_INFO[5],
      async run() {
        await startRec(this.dir);
        await wait(700);
        await tap(tab("Messages"));
        await page.waitForURL(/\/messages/);
        await wait(1500);
        const height = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
        await scrollTo(Math.max(0, height - 2300), 5200);
        await wait(700);
        await scrollTo("bottom", 1500);
        await wait(1600);
        return stopRec();
      },
    },
  ];

  const results = [];
  for (const beat of beats) {
    beat.dir = path.join(WORK, beat.key);
    console.log(`Recording ${beat.key}`);
    const r = await beat.run();
    console.log(`   ${r.frames} frames over ${r.seconds.toFixed(1)} s (${(r.frames / r.seconds).toFixed(0)} fps)`);
    results.push(beat);
  }
  await browser.close();

  await compose(results);
}

async function compose(results) {
  console.log("Composing clips");
  const clips = [];
  for (const beat of results) {
    console.log(`   ${beat.key}`);
    const out = path.join(OUT, `${beat.key}.mp4`);
    composeBeat({ framesDir: beat.dir, stageDir: path.join(WORK, "stage"), out });
    clips.push({ ...beat, out, seconds: durationOf(out) });
  }
  const end = path.join(OUT, "07-closing-card.mp4");
  composeEndCard({ stageDir: path.join(WORK, "stage"), out: end });
  clips.push({ key: "07-closing-card", title: "Closing card", line: "Your closing line.", out: end, seconds: durationOf(end) });
  concatClips({ clips: clips.map((c) => c.out), out: path.join(OUT, "stabl-demo-full.mp4") });

  writeCueSheet(clips);
  console.log(`Done: ${OUT}`);
}

function writeCueSheet(clips) {
  const total = clips.reduce((s, c) => s + c.seconds, 0);
  const rows = clips.map((c, i) => `| ${i + 1} | ${c.title} | \`${path.basename(c.out)}\` | ${c.seconds.toFixed(1)} s | ${c.line} |`);
  writeFileSync(
    path.join(OUT, "CUE-SHEET.md"),
    `# Stabl pitch demo: speaker cue sheet

One clip per slide in Keynote. Each clip plays once and stops on its last frame,
so take your time: click to the next slide when you finish the line.

Total running time if played straight through: ${total.toFixed(0)} seconds.

| # | Beat | Clip | Length | Suggested line |
|---|---|---|---|---|
${rows.join("\n")}

## Keynote setup

1. One slide per clip. Drag the clip onto a blank slide and make it fill the slide.
2. Select the movie, open Format, Movie: turn on Start movie on slide change. Leave Repeat off.
3. Transition between slides: Dissolve, 0.3 seconds. Clips follow on from each other, so it reads as one take.
4. Play from the presenter's laptop with the clips stored locally, not streamed.

Backups: \`stabl-demo-full.mp4\` (everything in one file), the offline replay at /replay, and the live app.
`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
