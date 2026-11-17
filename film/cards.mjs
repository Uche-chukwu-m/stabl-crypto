// Full frame cards and the side captions that sit beside the phone, drawn as
// HTML so the brand fonts and colors are exact. 1920 by 1080.
import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";
import { STAGE } from "./layout.mjs";

const { width: W, height: H, screen: S } = STAGE;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const FONTS = `<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700&family=Lora:ital,wght@1,500&family=JetBrains+Mono:wght@500&display=block" rel="stylesheet">`;
const INK = "#16241D";
const GREEN = "#1F5138";
const CREAM = "#F1EEE3";
const MUTED = "#5C6B63";
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

const LOGO = (size, bg = CREAM, fg = GREEN) =>
  `<svg viewBox="0 0 100 100" width="${size}" height="${size}"><rect width="100" height="100" rx="22" fill="${bg}"/><polyline points="28,53 36,35 43.5,64 52,45 57.5,51 73,50" fill="none" stroke="${fg}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const page = (body, bg = CREAM) => `<!doctype html><html><head>${FONTS}<style>
  *{box-sizing:border-box} body{margin:0;width:${W}px;height:${H}px;background:${bg};font-family:Inter;color:${INK};-webkit-font-smoothing:antialiased}
  .mono{font-family:'JetBrains Mono',monospace}
</style></head><body>${body}</body></html>`;

export const CARDS = {
  "00-problem": () =>
    page(`
    <div style="position:absolute;inset:0;padding:96px 140px;display:flex;flex-direction:column;justify-content:center">
      <div style="display:flex;align-items:center;gap:16px">${LOGO(52, GREEN, CREAM)}<span style="font-family:Lora;font-style:italic;font-size:44px;color:${GREEN}">Stabl</span></div>
      <p style="margin:56px 0 0;font-size:68px;font-weight:700;letter-spacing:-0.025em;line-height:1.08">Uneven income is normal.</p>
      <div style="margin-top:64px;display:grid;grid-template-columns:repeat(3,1fr);gap:40px">
        ${[
          ["36%", "how much a typical family's income changes from one month to the next", "JPMorgan Chase Institute, Weathering Volatility 2.0"],
          ["5 months", "a year with income more than 25% above or below average", "U.S. Financial Diaries"],
          ["85%", "of freelancers are paid late at least some of the time", "Remote, 2025"],
        ]
          .map(
            ([big, what, src]) => `<div>
          <p style="margin:0;font-size:96px;font-weight:700;letter-spacing:-0.04em;line-height:1;color:${GREEN}">${big}</p>
          <p style="margin:18px 0 0;font-size:31px;line-height:1.35">${what}</p>
          <p style="margin:16px 0 0;font-size:21px;color:${MUTED}">${src}</p></div>`,
          )
          .join("")}
      </div>
      <p style="margin:76px 0 0;font-family:Lora;font-style:italic;font-size:40px;line-height:1.35;max-width:1500px">“They want to have the right money at the right time.”</p>
      <p style="margin:12px 0 0;font-size:24px;color:${MUTED}">Jonathan Morduch, NYU, co-author of The Financial Diaries</p>
    </div>`),

  "05a-why-a-blockchain": () =>
    page(
      `<div style="position:absolute;inset:0;padding:96px 140px;display:flex;flex-direction:column;justify-content:center;color:${CREAM}">
        <p style="margin:0;font-size:30px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;opacity:.7">Why a blockchain</p>
        <div style="margin-top:56px;display:flex;gap:56px">
          <div style="flex:1;background:rgb(241 238 227/.08);border:2px solid rgb(241 238 227/.22);border-radius:30px;padding:46px 46px">
            <p style="margin:0;font-size:26px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;opacity:.65">2024: the Synapse collapse</p>
            <p style="margin:26px 0 0;font-size:40px;font-weight:700;line-height:1.2">A fintech middleman kept the only ledger of who was owed what.</p>
            <p style="margin:22px 0 0;font-size:30px;line-height:1.4;opacity:.85">When it failed, customers could not prove their balances. The bankruptcy trustee found a gap of $65 to $96 million between what customers were owed and what the banks held.</p>
            <p style="margin:26px 0 0;font-size:20px;opacity:.6">NBC News, American Banker, court filings</p>
          </div>
          <div style="flex:1;background:${CREAM};color:${INK};border-radius:30px;padding:46px 46px">
            <p style="margin:0;font-size:26px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${MUTED}">Stabl's vault</p>
            <p style="margin:26px 0 0;font-size:40px;font-weight:700;line-height:1.2">Every balance sits on a public ledger anyone can check.</p>
            <p style="margin:22px 0 0;font-size:30px;line-height:1.4;color:${MUTED}">The rules are in a contract anyone can read. Money in a vault can only ever go back to its owner, whatever Stabl's servers ask for.</p>
          </div>
        </div>
      </div>`,
      INK,
    ),

  "05b-how-it-settles": () => {
    const steps = [
      ["Stabl's engine", "decides a move from bank data (Plaid)"],
      ["Circle wallets", "sign it; Gas Station pays the fee"],
      ["StablVault on Arc", "enforces the rules: money only goes back to its owner"],
      ["QuickNode Stream", "watches the contract, posts each event, signed"],
      ["Stabl", "writes the ledger and sends the receipt, once"],
    ];
    return page(
      `<div style="position:absolute;inset:0;padding:96px 140px;display:flex;flex-direction:column;justify-content:center;color:${CREAM}">
        <p style="margin:0;font-size:30px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;opacity:.7">How a move settles</p>
        <div style="margin-top:70px;display:flex;align-items:stretch;gap:0">
          ${steps
            .map(
              ([t, d], i) => `
            <div style="flex:1;background:rgb(241 238 227/.08);border:2px solid rgb(241 238 227/.22);border-radius:26px;padding:34px 28px">
              <div style="font-size:24px;opacity:.6" class="mono">${i + 1}</div>
              <div style="margin-top:14px;font-size:36px;font-weight:700;line-height:1.1">${t}</div>
              <div style="margin-top:16px;font-size:25px;line-height:1.35;opacity:.82">${d}</div>
            </div>${i < steps.length - 1 ? `<div style="width:46px;display:flex;align-items:center;justify-content:center;font-size:40px;opacity:.6">›</div>` : ""}`,
            )
            .join("")}
        </div>
        <div style="margin-top:70px;display:flex;gap:60px;font-size:30px;line-height:1.4">
          <div style="flex:1"><b>Settled only when Arc says so.</b><br><span style="opacity:.78">A move stays "on its way" until the contract's own event arrives.</span></div>
          <div style="flex:1"><b>Exactly once.</b><br><span style="opacity:.78">Each event is stored under its transaction and log index. A repeat changes nothing.</span></div>
          <div style="flex:1"><b>A fallback, not a crutch.</b><br><span style="opacity:.78">If the Stream is late, Stabl reads the receipt from Arc. Each move records which one confirmed it.</span></div>
        </div>
      </div>`,
      GREEN,
    );
  },

  "04-proof": ({ shot, url }) =>
    page(
      `<div style="position:absolute;inset:0;padding:56px 120px 0">
        <p style="margin:0;font-size:30px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${CREAM};opacity:.75">The proof link: that deposit on Arc</p>
        <div style="margin-top:28px;border-radius:22px;overflow:hidden;background:#fff;box-shadow:0 30px 80px rgb(0 0 0/.35)">
          <div style="height:58px;background:#E9E6DC;display:flex;align-items:center;gap:12px;padding:0 22px">
            <span style="width:15px;height:15px;border-radius:50%;background:#E0675B"></span><span style="width:15px;height:15px;border-radius:50%;background:#E8B54B"></span><span style="width:15px;height:15px;border-radius:50%;background:#62B366"></span>
            <span class="mono" style="margin-left:22px;flex:1;background:#fff;border-radius:10px;padding:8px 18px;font-size:20px;color:${MUTED};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(url)}</span>
          </div>
          <img src="data:image/png;base64,${readFileSync(shot).toString("base64")}" style="display:block;width:100%">
        </div>
      </div>`,
      INK,
    ),

  "09-honest": () =>
    page(`
    <div style="position:absolute;inset:0;display:flex;gap:90px;padding:120px 140px">
      <div style="flex:1">
        <p style="margin:0;font-size:30px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${MUTED}">Real, on Arc Testnet</p>
        <p style="margin:26px 0 0;font-size:38px;line-height:1.4">The vault contract and every move. Circle wallets with sponsored fees. QuickNode Stream delivery.</p>
        <p style="margin:60px 0 0;font-size:30px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${MUTED}">Simulated</p>
        <p style="margin:26px 0 0;font-size:38px;line-height:1.4">Bank transfers, and converting dollars to USDC.</p>
        <p style="margin:60px 0 0;font-size:30px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${MUTED}">Next</p>
        <p style="margin:26px 0 0;font-size:38px;line-height:1.4">Today Stabl manages the wallet keys. <b>Next, they move to the user's phone.</b></p>
      </div>
      <div style="width:640px;background:${GREEN};color:${CREAM};border-radius:34px;padding:56px 54px;display:flex;flex-direction:column;justify-content:center">
        <p style="margin:0;font-size:28px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;opacity:.75">Simulation: 200 freelancers</p>
        <p style="margin:36px 0 0;font-size:150px;font-weight:700;letter-spacing:-0.04em;line-height:1">0</p>
        <p style="margin:16px 0 0;font-size:36px;line-height:1.35">overdrafts caused by Stabl</p>
        <p style="margin:40px 0 0;font-size:24px;line-height:1.4;opacity:.75">Six months each through the app's own engine, with and without Stabl. docs/simulation.md</p>
      </div>
    </div>`),

  "10-closing": () =>
    page(
      `<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:${CREAM}">
        <div style="display:inline-flex;align-items:center;gap:22px">${LOGO(96)}<span style="font-family:Lora;font-style:italic;font-size:96px;line-height:1">Stabl</span></div>
        <p style="margin:44px 0 0;font-weight:700;font-size:56px;letter-spacing:-0.02em">Steady pay for uneven income.</p>
        <p class="mono" style="margin:56px 0 0;font-size:24px;opacity:.75">stabl-crypto.vercel.app · github.com/Uche-chukwu-m/stabl-crypto</p>
      </div>`,
      GREEN,
    ),
};

// Text beside the phone: what is happening on the left, what happened on Arc on
// the right. Transparent everywhere else.
export function caption({ title, note, facts = [] }) {
  const left = S.x - 70;
  const right = W - (S.x + S.w) - 70;
  return `<!doctype html><html><head>${FONTS}<style>body{margin:0;width:${W}px;height:${H}px;background:transparent;font-family:Inter;color:${INK};-webkit-font-smoothing:antialiased}.mono{font-family:'JetBrains Mono',monospace}</style></head><body>
    <div style="position:absolute;left:70px;top:0;bottom:0;width:${left - 60}px;display:flex;flex-direction:column;justify-content:center">
      <p style="margin:0;font-size:58px;font-weight:700;letter-spacing:-0.025em;line-height:1.05">${esc(title)}</p>
      ${note ? `<p style="margin:22px 0 0;font-size:28px;line-height:1.4;color:${MUTED}">${esc(note)}</p>` : ""}
    </div>
    ${
      facts.length
        ? `<div style="position:absolute;right:70px;top:0;bottom:0;width:${right - 40}px;display:flex;flex-direction:column;justify-content:center">
      <div style="background:${INK};color:${CREAM};border-radius:26px;padding:30px 32px">
        <p style="margin:0;font-size:20px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;opacity:.6">On Arc Testnet</p>
        ${facts.map(([k, v]) => `<p style="margin:20px 0 0;font-size:20px;opacity:.6">${esc(k)}</p><p class="mono" style="margin:6px 0 0;font-size:24px;line-height:1.3;word-break:break-all">${esc(v)}</p>`).join("")}
      </div></div>`
        : ""
    }
  </body></html>`;
}

export async function renderHtml(html, out, { transparent = false } = {}) {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const p = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await p.setContent(html, { waitUntil: "load", timeout: 90_000 });
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: out, omitBackground: transparent });
  await browser.close();
}

// A desktop screenshot of a page, for the explorer card.
export async function screenshotUrl(url, out, { width = 1680, height = 860, waitFor, settleMs = 6000 } = {}) {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--disable-blink-features=AutomationControlled"] });
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
  });
  const p = await ctx.newPage();
  await p.goto(url, { waitUntil: "commit", timeout: 60_000 });
  if (waitFor) await p.getByText(waitFor).first().waitFor({ timeout: 45_000 }).catch(() => {});
  await p.waitForTimeout(settleMs);
  await p.screenshot({ path: out });
  await browser.close();
}
