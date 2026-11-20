// The narrated demo: one video, up to three minutes, with a voice over.
//
//   node film/narrated.mjs              record against the live site and build
//   node film/narrated.mjs --compose    rebuild from the last recording
//
// It records the live site (FILM_BASE to change it), so every move in the video
// is a real transaction on Arc, confirmed by the QuickNode Stream on camera. It
// drives the presenter account through the key-protected presenter routes,
// reads each move's transaction from the live database for the side captions,
// and resets the presenter account when it is done.
//
// Needs .secrets/production.env (ADMIN_KEY, PROD_DATABASE_URL) and
// .secrets/presenter-user-id. The voice is set in film/narration.mjs.
// Output: ../pitch-video/stabl-narrated.mp4 (FILM_OUT to change the folder).
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { chromium } from "playwright-core";
import { CARDS, caption, renderHtml, screenshotUrl } from "./cards.mjs";
import { addVoice, composeBeat, composeCard, concatClips, durationOf } from "./compose.mjs";
import { PHONE } from "./layout.mjs";
import { LINES, RATE, VOICE, speakAll } from "./narration.mjs";
import { renderStage } from "./stage.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const BASE = process.env.FILM_BASE ?? "https://stabl-crypto.vercel.app";
const OUT = path.resolve(process.env.FILM_OUT ?? path.join(ROOT, "..", "pitch-video"));
const WORK = path.join(OUT, ".narrated");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const EXPLORER = "https://explorer.testnet.arc.io";
const UNITS_PER_CENT = 10;

const secrets = Object.fromEntries(
  readFileSync(path.join(ROOT, ".secrets/production.env"), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const KEY = secrets.ADMIN_KEY;
const deployment = JSON.parse(readFileSync(path.join(ROOT, "contracts/deployments/arc-testnet.json"), "utf8"));
const short = (h) => `${h.slice(0, 8)}…${h.slice(-6)}`;

// Retries only calls that are safe to repeat. An event or a day passing may have
// reached the server even if the answer did not come back, so those never retry.
const REPEATABLE = new Set(["reset", "link", "seed"]);
async function admin(action, body = {}) {
  let res;
  for (let attempt = 1; ; attempt++) {
    try {
      res = await fetch(`${BASE}/api/admin/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-key": KEY },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(240_000),
      });
      break;
    } catch (error) {
      if (attempt >= 4 || !REPEATABLE.has(action)) throw error;
      console.log(`   ${action}: ${error.cause?.code ?? error.message}, retrying`);
      await new Promise((r) => setTimeout(r, 5000 * attempt));
    }
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`admin ${action}: ${JSON.stringify(json)}`);
  return json;
}

// The move a beat made, read from the live database: its transaction, and what
// confirmed it and how fast.
async function lastMove(db, userId, direction, waitSeconds = 60) {
  for (let i = 0; i < waitSeconds; i++) {
    const { rows } = await db.query(
      `select amount_cents, state, tx_hash, confirmed_by,
              round(extract(epoch from (settled_at - submitted_at))::numeric, 1)::float as secs
       from moves where user_id = $1 and direction = $2 and submitted_at is not null
       order by submitted_at desc limit 1`,
      [userId, direction],
    );
    if (rows[0]?.state === "settled") return rows[0];
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`No settled ${direction} for the presenter`);
}

function moveFacts(m, event) {
  const usdc = (m.amount_cents * UNITS_PER_CENT) / 1e6;
  return [
    ["Event", `${event} ${usdc} USDC`],
    ["Confirmed by", m.confirmed_by === "stream" ? `QuickNode Stream, ${m.secs} s` : `Reading Arc directly, ${m.secs} s`],
    ["Transaction", short(m.tx_hash)],
  ];
}

function withTimeout(promise, ms, what) {
  return Promise.race([promise, new Promise((_, no) => setTimeout(() => no(new Error(`${what} took over ${ms} ms`)), ms))]);
}

const SEQUENCE = [
  { key: "00-problem", card: true },
  { key: "01-meet-jemaya", title: "Stabl", note: "Steady pay for uneven income. Meet Mike, a freelance designer: his pay swings, his spending doesn't." },
  { key: "02-big-client-pays", title: "A big client pays", note: "Stabl tells Mike a day before anything moves. He can reply STOP." },
  { key: "03-set-aside", title: "Set aside", note: "Mike sees dollars. Underneath, the vault is a contract on Arc." },
  { key: "04-proof", card: true },
  { key: "05a-why-a-blockchain", card: true },
  { key: "05b-how-it-settles", card: true },
  // speed: screen action with no talking over it plays a little faster.
  { key: "06-check-it", title: "Check it yourself", note: "The app's balance against the contract's, read live from Arc.", speed: 1.3 },
  { key: "07-slow-week", title: "A slow week", note: "Money goes back to checking right away.", speed: 1.25 },
  { key: "08-emergency", title: "Emergency unlock", note: "The same day, with a one time code, from his own vault wallet.", speed: 1.7 },
  { key: "09-honest", card: true },
  { key: "10-closing", card: true },
];

async function record() {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  const db = new pg.Client({ connectionString: secrets.PROD_DATABASE_URL, ssl: { rejectUnauthorized: true } });
  await db.connect();

  console.log("Fresh presenter account on the live site");
  const idFile = path.join(ROOT, ".secrets/presenter-user-id");
  const { userId } = await admin("reset", { userId: readFileSync(idFile, "utf8").trim() });
  writeFileSync(idFile, userId);
  const { url: loginUrl } = await admin("link", { userId });

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
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: PHONE.safeTop, bottom: PHONE.safeBottom, left: 0, right: 0 } });

  // Hold new messages back while a beat is set up, so a banner never shows
  // before the camera rolls. Released on cue.
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

  let rec = null;
  cdp.on("Page.screencastFrame", async (f) => {
    await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
    if (!rec) return;
    const file = `${String(rec.frames.length).padStart(5, "0")}.jpg`;
    rec.frames.push({ file, at: Date.now() - rec.t0 });
    writeFileSync(path.join(rec.dir, file), Buffer.from(f.data, "base64"));
  });
  const startRec = async (key) => {
    const dir = path.join(WORK, key);
    mkdirSync(dir, { recursive: true });
    rec = { dir, frames: [], t0: Date.now() };
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: PHONE.width * PHONE.scale, maxHeight: PHONE.height * PHONE.scale });
  };
  const stopRec = async () => {
    const endAt = Date.now() - rec.t0;
    await cdp.send("Page.stopScreencast");
    await new Promise((r) => setTimeout(r, 150));
    writeFileSync(path.join(rec.dir, "timing.json"), JSON.stringify({ frames: rec.frames, endAt }));
    console.log(`   ${rec.frames.length} frames, ${(endAt / 1000).toFixed(1)} s`);
    rec = null;
  };
  const wait = (ms) => page.waitForTimeout(ms);
  const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
  const tap = async (locator, before = 500) => {
    await locator.waitFor({ state: "visible" });
    await locator.scrollIntoViewIfNeeded();
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
    withTimeout(page.evaluate(
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
    ), ms + 10_000, "scroll");
  const latestTemplate = async () => (await (await page.request.get(`${BASE}/api/messages/latest`)).json()).latest?.template;
  const tab = (name) => page.locator('nav[aria-label="Tabs"]').getByRole("link", { name });
  const facts = {};

  console.log("Signing the phone in");
  await page.goto(loginUrl);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/home/, { timeout: 60_000 });

  console.log("01 Meet Mike");
  await startRec("01-meet-jemaya");
  await page.goto(`${BASE}/home`);
  await page.evaluate(() => document.fonts.ready);
  await wait(2400);
  const chart = page.locator("figure svg").first();
  await scrollTo(Math.max(0, (await chart.evaluate((el) => el.getBoundingClientRect().top + window.scrollY)) - 300), 1100);
  await wait(500);
  const b = await chart.boundingBox();
  await drag({ x: b.x + b.width * 0.5, y: b.y + b.height * 0.6 }, { x: b.x + b.width * 0.97, y: b.y + b.height * 0.5 }, 2600, 700);
  await wait(800);
  await scrollTo(0, 900);
  await wait(600);
  await stopRec();

  console.log("02 A big client pays");
  hold();
  await admin("inject", { userId, event: "big_client" });
  await startRec("02-big-client-pays");
  await wait(1000);
  await reveal();
  const announce = page.getByRole("status").filter({ hasText: "Good stretch" });
  await announce.waitFor({ timeout: 10_000 });
  await wait(2400);
  await tap(announce, 200);
  await page.waitForURL(/\/messages/);
  await page.getByRole("button", { name: "Stop it" }).last().waitFor();
  await wait(3200);
  await stopRec();

  console.log("03 Set aside");
  hold();
  await admin("advance", { userId, days: 1 });
  const buffer = await lastMove(db, userId, "buffer");
  facts["03-set-aside"] = moveFacts(buffer, "Deposited");
  await startRec("03-set-aside");
  await wait(900);
  await reveal();
  await page.getByText(/Moved \$[\d,]+\.00 to your vault/).last().waitFor({ timeout: 10_000 });
  await wait(1500);
  await scrollTo("bottom", 700);
  await wait(3500);
  await stopRec();

  console.log("04 The deposit on Arc's explorer");
  const txUrl = `${EXPLORER}/tx/${buffer.tx_hash}`;
  await screenshotUrl(txUrl, path.join(WORK, "explorer.png"), { waitFor: "Transaction details", settleMs: 7000 });
  writeFileSync(path.join(WORK, "explorer.json"), JSON.stringify({ url: txUrl }));

  console.log("06 Check it yourself");
  // Straight to the vault page: the Settings screen above it shows the account's name.
  await startRec("06-check-it");
  await page.goto(`${BASE}/settings/vault`);
  await page.evaluate(() => document.fonts.ready);
  await page.getByText("The contract says").waitFor({ timeout: 20_000 });
  await wait(1200);
  const checkTop = await page
    .getByRole("heading", { name: "Check it yourself" })
    .first()
    .evaluate((el) => el.getBoundingClientRect().top + window.scrollY, null, { timeout: 15_000 })
    .catch(() => 300);
  console.log("   page ready, scrolling");
  await scrollTo(Math.max(0, checkTop - 80), 1600);
  await wait(3000);
  await scrollTo("bottom", 1800);
  await wait(3200);
  await stopRec();
  facts["06-check-it"] = [
    ["Vault contract", short(deployment.address)],
    ["Source", "Verified on the explorer"],
    ["Owner wallet", "Circle smart contract account"],
  ];

  console.log("07 A slow week");
  await page.goto(`${BASE}/home`);
  await wait(1500);
  hold();
  await admin("inject", { userId, event: "slow_week" });
  for (let day = 0; day < 7 && (await latestTemplate()) !== "release"; day++) await admin("advance", { userId, days: 1 });
  const release = await lastMove(db, userId, "release");
  facts["07-slow-week"] = moveFacts(release, "Released");
  await startRec("07-slow-week");
  await wait(900);
  await reveal();
  await page.getByRole("status").filter({ hasText: /we sent \$/ }).waitFor({ timeout: 10_000 });
  await wait(2400);
  await drag({ x: 195, y: 230 }, { x: 195, y: 520 }, 650, 300);
  await page.getByText("Sent back. You are covered.").waitFor({ timeout: 10_000 }).catch(() => {});
  await wait(3200);
  await stopRec();

  // Circle sends one transaction per wallet at a time. The slow week's money
  // going back to the bank side leaves from the same wallet as the unlock, so
  // let it land first, or the unlock waits behind it.
  for (let i = 0; i < 180; i++) {
    const { rows } = await db.query(`select count(*)::int as n from chain_ops where user_id = $1 and kind = 'offramp' and state = 'sent'`, [userId]);
    if (rows[0].n === 0) break;
    if (i % 15 === 0) console.log("   waiting for the earlier transfer to land");
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log("08 Emergency unlock");
  await scrollTo(0, 10);
  await startRec("08-emergency");
  await wait(800);
  await tap(page.getByRole("link", { name: "Emergency" }));
  const sheet = page.getByRole("dialog", { name: "Emergency unlock" });
  await sheet.waitFor();
  await wait(1100);
  await tap(sheet.getByRole("button", { name: "Send me a code" }));
  const codeField = sheet.getByLabel("Code from your messages");
  await codeField.waitFor({ timeout: 10_000 });
  const codeBanner = page.getByRole("status").filter({ hasText: "Your code is" });
  await codeBanner.waitFor({ timeout: 10_000 });
  const code = (await codeBanner.textContent()).match(/code is (\d{6})/)[1];
  await wait(1800);
  await tap(codeField, 200);
  await page.keyboard.type(code, { delay: 120 });
  await tap(sheet.getByPlaceholder("150"), 300);
  await page.keyboard.type("150", { delay: 150 });
  await tap(sheet.getByRole("button", { name: "Send to checking" }), 500);
  await page.getByText("$150.00 sent to checking").waitFor({ timeout: 10_000 }).catch(() => {});
  const emergency = await lastMove(db, userId, "emergency", 300);
  facts["08-emergency"] = moveFacts(emergency, "EmergencyUnlocked");
  await page.getByRole("status").filter({ hasText: "Emergency unlock done" }).waitFor({ timeout: 15_000 }).catch(() => {});
  await wait(2800);
  await stopRec();

  await browser.close();
  writeFileSync(path.join(WORK, "facts.json"), JSON.stringify(facts, null, 2));
  await db.end();

  console.log("Resetting the presenter account");
  const fresh = await admin("reset", { userId });
  writeFileSync(idFile, fresh.userId);
}

async function build() {
  console.log("Rendering the stage, cards and captions");
  const stageDir = path.join(WORK, "stage");
  await renderStage(stageDir);
  const facts = JSON.parse(readFileSync(path.join(WORK, "facts.json"), "utf8"));
  const { url } = JSON.parse(readFileSync(path.join(WORK, "explorer.json"), "utf8"));
  const cardsDir = path.join(WORK, "cards");
  mkdirSync(cardsDir, { recursive: true });
  for (const beat of SEQUENCE) {
    const png = path.join(cardsDir, `${beat.key}.png`);
    if (beat.card) {
      const html = beat.key === "04-proof" ? CARDS[beat.key]({ shot: path.join(WORK, "explorer.png"), url }) : CARDS[beat.key]();
      await renderHtml(html, png);
    } else {
      await renderHtml(caption({ title: beat.title, note: beat.note, facts: facts[beat.key] ?? [] }), png, { transparent: true });
    }
  }

  console.log(`Voice: ${process.env.FILM_VOICE_DIR ? "recorded files" : `${VOICE} at ${RATE} words a minute`}`);
  const voice = speakAll(path.join(WORK, "voice"));

  console.log("Composing");
  const clips = [];
  for (const beat of SEQUENCE) {
    const silent = path.join(WORK, `${beat.key}.silent.mp4`);
    const final = path.join(WORK, `${beat.key}.mp4`);
    const line = voice[beat.key];
    const need = line.seconds + 0.35 + 0.7;
    const png = path.join(cardsDir, `${beat.key}.png`);
    if (beat.card) {
      composeCard({ image: png, out: silent, seconds: Math.max(need, beat.key === "10-closing" ? 4 : 3) });
    } else {
      const dir = path.join(WORK, beat.key);
      const { frames, endAt } = JSON.parse(readFileSync(path.join(dir, "timing.json"), "utf8"));
      const speed = beat.speed ?? 1;
      const recorded = (endAt - frames[0].at) / 1000 / speed;
      composeBeat({ framesDir: dir, stageDir, out: silent, caption: png, speed, holdSeconds: Math.max(0.5, need - recorded) });
    }
    addVoice({ video: silent, audio: line.file, out: final });
    clips.push({ key: beat.key, out: final, seconds: durationOf(final), line: LINES[beat.key] });
    console.log(`   ${beat.key}: ${durationOf(final).toFixed(1)} s (voice ${line.seconds.toFixed(1)} s)`);
  }
  const out = path.join(OUT, "stabl-narrated.mp4");
  concatClips({ clips: clips.map((c) => c.out), out });
  const total = durationOf(out);
  console.log(`\n${out}\n${total.toFixed(1)} seconds${total > 180 ? "  <- OVER three minutes" : ""}`);

  writeFileSync(
    path.join(OUT, "NARRATION.md"),
    [
      "# Stabl narrated demo: script",
      "",
      `\`stabl-narrated.mp4\`, ${total.toFixed(0)} seconds. Every move in it is a real transaction on Arc Testnet, made by the live site while recording.`,
      "",
      "| # | Beat | Length | Line |",
      "| --- | --- | --- | --- |",
      ...clips.map((c, i) => `| ${i + 1} | ${c.key} | ${c.seconds.toFixed(1)} s | ${c.line} |`),
      "",
      "To record your own voice instead: one file per beat in a folder, named by the beat (for example `03-set-aside.m4a`), then `FILM_VOICE_DIR=<folder> node film/narrated.mjs --compose`.",
      "",
    ].join("\n"),
  );
}

const composeOnly = process.argv.includes("--compose");
if (!composeOnly) await record();
await build();
