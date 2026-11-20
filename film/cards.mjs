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

  "05a-why-a-blockchain": () => {
    const reasons = [
      [
        "Trust",
        "A public ledger anyone can check",
        "In 2024 the fintech middleman Synapse collapsed. It kept the only ledger of who was owed what; customers could not prove their balances, and a $65 to $96 million gap was found.",
        "NBC News, American Banker",
      ],
      [
        "Time",
        "Settles 24/7, in under a second",
        "Bank transfers (ACH) take 1 to 3 business days and stop on weekends and holidays. The vault settles any hour, any day, so money that lands on a Saturday can move on a Saturday.",
        "Arc docs: deterministic finality",
      ],
      [
        "Rules",
        "Enforced at the ledger, not by policy",
        "Today the contract guarantees money only goes back to its owner, freezes on request, and settles each move once. Next: split each payout automatically into a reserve earning yield in tokenized Treasuries (USYC on Arc).",
        "StablVault.sol",
      ],
    ];
    return page(
      `<div style="position:absolute;inset:0;padding:80px 110px;display:flex;flex-direction:column;justify-content:center;color:${CREAM}">
        <p style="margin:0;font-size:30px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;opacity:.7">Why a blockchain</p>
        <div style="margin-top:40px;display:flex;gap:32px">
          ${reasons
            .map(
              ([tag, head, body, src], i) => `<div style="flex:1;border-radius:28px;padding:40px 38px;${i === 0 ? "background:rgb(241 238 227/.08);border:2px solid rgb(241 238 227/.22)" : `background:${CREAM};color:${INK}`}">
              <p style="margin:0;font-size:24px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;opacity:.65">${tag}</p>
              <p style="margin:20px 0 0;font-size:38px;font-weight:700;line-height:1.15">${head}</p>
              <p style="margin:20px 0 0;font-size:26px;line-height:1.4;opacity:.85">${body}</p>
              <p style="margin:20px 0 0;font-size:18px;opacity:.55">${src}</p>
            </div>`,
            )
            .join("")}
        </div>
      </div>`,
      INK,
    );
  },

  "05b-how-it-settles": () => {
    const flow = ["Engine decides", "Circle signs", "Arc settles", "QuickNode tells Stabl", "Receipt sent"];
    const cols = [
      ["Arc", ["Fees are paid in dollars (USDC), about a tenth of a cent, and stay steady", "Final in under a second, and can never be reversed", "Built for USDC, with Circle's on-ramp and earn tools next"]],
      ["Circle", ["A wallet for every person, with no seed phrase to lose", "Gas Station pays every fee, so nobody needs crypto", "Stabl never holds a private key"]],
      ["QuickNode Streams", ["Pushes each vault event the moment it lands", "Only Stabl's contract, and every delivery is signed", "Never skips a block: it retries until delivered"]],
    ];
    return page(
      `<div style="position:absolute;inset:0;padding:80px 120px;display:flex;flex-direction:column;justify-content:center;color:${CREAM}">
        <p style="margin:0;font-size:28px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;opacity:.7">Why these three</p>
        <div style="margin-top:34px;display:flex;align-items:center;gap:14px;font-size:26px">
          ${flow.map((f, i) => `<span style="padding:12px 22px;border-radius:999px;background:rgb(241 238 227/.12)">${f}</span>${i < flow.length - 1 ? '<span style="opacity:.55">›</span>' : ""}`).join("")}
        </div>
        <div style="margin-top:44px;display:flex;gap:30px">
          ${cols
            .map(
              ([t, items]) => `<div style="flex:1;background:rgb(241 238 227/.08);border:2px solid rgb(241 238 227/.22);border-radius:26px;padding:34px 34px">
              <p style="margin:0;font-size:40px;font-weight:700">${t}</p>
              ${items.map((x) => `<p style="margin:22px 0 0;font-size:28px;line-height:1.35;opacity:.88">${x}</p>`).join("")}
            </div>`,
            )
            .join("")}
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
    <div style="position:absolute;inset:0;display:flex;gap:90px;padding:100px 140px">
      <div style="flex:1">
        <p style="margin:0;font-size:30px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${MUTED}">Real, on Arc Testnet</p>
        <p style="margin:24px 0 0;font-size:34px;line-height:1.4">The vault contract and every move. Circle wallets with sponsored fees, and passkey wallets only you can sign for. QuickNode Stream delivery.</p>
        <p style="margin:52px 0 0;font-size:30px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${MUTED}">Simulated</p>
        <p style="margin:24px 0 0;font-size:34px;line-height:1.4">Bank transfers, and converting dollars to USDC.</p>
        <p style="margin:52px 0 0;font-size:30px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${MUTED}">Next</p>
        <p style="margin:24px 0 0;font-size:32px;line-height:1.4">Each payout split automatically into a yield-earning reserve. Instant payouts over FedNow and RTP. Passkeys at sign-up, with recovery.</p>
      </div>
      <div style="width:600px;background:${GREEN};color:${CREAM};border-radius:34px;padding:56px 54px;display:flex;flex-direction:column;justify-content:center">
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
