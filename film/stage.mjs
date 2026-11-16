// Renders the still layers the clips are composed on: the background with the
// phone body, the camera pill drawn over the screen, the rounded screen mask,
// and the closing card. Drawn as HTML so the brand fonts and colors are exact.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { STAGE } from "./layout.mjs";

const { width: W, height: H, screen: S, bezel: B } = STAGE;
const outer = { x: S.x - B, y: S.y - B, w: S.w + 2 * B, h: S.h + 2 * B, r: S.r + B };

const FONTS = `<link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;700&family=Lora:ital,wght@1,500&display=block" rel="stylesheet">`;

const pages = {
  // Cream page, the phone body in ink with a soft shadow, and two side buttons.
  "stage-bg": `
    <body style="margin:0;width:${W}px;height:${H}px;background:#F1EEE3">
      <div style="position:absolute;left:${outer.x}px;top:${outer.y}px;width:${outer.w}px;height:${outer.h}px;border-radius:${outer.r}px;background:#16241D;
        box-shadow:0 2px 4px rgb(22 36 29/.10),0 30px 70px rgb(22 36 29/.22),inset 0 0 0 2px #2c3a33"></div>
      <div style="position:absolute;left:${outer.x - 4}px;top:${outer.y + 190}px;width:4px;height:58px;border-radius:2px 0 0 2px;background:#22302a"></div>
      <div style="position:absolute;left:${outer.x - 4}px;top:${outer.y + 262}px;width:4px;height:58px;border-radius:2px 0 0 2px;background:#22302a"></div>
      <div style="position:absolute;left:${outer.x + outer.w}px;top:${outer.y + 220}px;width:4px;height:92px;border-radius:0 2px 2px 0;background:#22302a"></div>
    </body>`,
  // The camera pill sits over the top of the screen, as on a modern phone.
  "stage-fg": `
    <body style="margin:0;width:${W}px;height:${H}px;background:transparent">
      <div style="position:absolute;left:${S.x + S.w / 2 - 58}px;top:${S.y + 11}px;width:116px;height:34px;border-radius:17px;background:#050807"></div>
    </body>`,
  // White where the screen shows, black elsewhere, at screen size.
  "screen-mask": `
    <body style="margin:0;width:${S.w}px;height:${S.h}px;background:#000">
      <div style="width:${S.w}px;height:${S.h}px;border-radius:${S.r}px;background:#fff"></div>
    </body>`,
  "end-card": `
    <body style="margin:0;width:${W}px;height:${H}px;background:#1F5138;display:flex;align-items:center;justify-content:center;font-family:Inter">
      <div style="text-align:center;color:#F1EEE3">
        <div style="display:inline-flex;align-items:center;gap:22px">
          <svg viewBox="0 0 100 100" width="96" height="96"><rect width="100" height="100" rx="22" fill="#F1EEE3"/>
            <polyline points="28,53 36,35 43.5,64 52,45 57.5,51 73,50" fill="none" stroke="#1F5138" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span style="font-family:Lora;font-style:italic;font-weight:500;font-size:96px;line-height:1">Stabl</span>
        </div>
        <p style="margin:44px 0 0;font-weight:700;font-size:56px;letter-spacing:-0.02em">Steady pay for uneven income.</p>
      </div>
    </body>`,
};

export async function renderStage(outDir) {
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
  for (const [name, body] of Object.entries(pages)) {
    const isMask = name === "screen-mask";
    const page = await browser.newPage({ viewport: isMask ? { width: S.w, height: S.h } : { width: W, height: H }, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><html><head>${FONTS}</head>${body}</html>`, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${outDir}/${name}.png`, omitBackground: name === "stage-fg" });
    await page.close();
  }
  await browser.close();
}
