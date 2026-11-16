import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { render, templates, type TemplateName } from "@/lib/notify/templates";

// Copy rules from the PRD: no emojis anywhere, and no dashes as punctuation in
// any screen or message copy.
const EMOJI = /\p{Extended_Pictographic}/u;
const DASHES = /[‒–—―]|\s-\s|--/;

const SAMPLE = {
  amountCents: 64_000,
  account: "Checking 4321",
  shrunk: true,
  vaultCents: 192_000,
  checkingCents: 210_533,
  reason: "safety",
  unusual: false,
  shortByCents: 21_000,
  gapCents: 21_000,
  name: "ZELLE FROM K JONES",
  income: true,
  depositCents: 1_200_000,
  bufferCents: 70_000,
  until: "January 21",
  code: "482913",
  minutes: 10,
  left: 1,
  where: "the Stabl app",
  opensAt: "Thu 3:10 PM",
  institution: "Second Bank",
  mask: "5521",
  what: "stop",
  incomeCents: 310_000,
  spendCents: 250_000,
  moves: 2,
};

describe("message copy", () => {
  for (const name of Object.keys(templates) as TemplateName[]) {
    it(`${name} has no emojis or dashes`, () => {
      const { body } = render(name, SAMPLE as never);
      expect(body).not.toMatch(EMOJI);
      expect(body).not.toMatch(DASHES);
      expect(body.startsWith("Stabl")).toBe(true);
    });
  }

  it("matches the catalog word for word", () => {
    expect(render("buffer_announced", { amountCents: 64_000, account: "Checking 4321", shrunk: false }).body).toBe(
      "Stabl: Good stretch. Tomorrow we will move $640.00 from Checking 4321 to your vault. Your bills stay covered. Reply STOP to skip it.",
    );
    expect(render("buffer_settled", { amountCents: 64_000, vaultCents: 192_000, checkingCents: 210_533 }).body).toBe(
      "Stabl: Moved $640.00 to your vault. Vault $1,920.00. Checking $2,105.33.",
    );
    expect(render("release", { amountCents: 41_000, account: "Checking 4321", vaultCents: 151_000, unusual: false }).body).toBe(
      "Stabl: Slow week, so we sent $410.00 from your vault to Checking 4321. It is there now. Vault $1,510.00.",
    );
    expect(render("release_short", { amountCents: 20_000, shortByCents: 21_000 }).body).toBe(
      "Stabl: We sent everything in your vault, $200.00. Checking is still about $210.00 short for this week's bills.",
    );
    expect(render("mystery_credit", { amountCents: 30_000, name: "ZELLE FROM K JONES" }).body).toBe(
      "Stabl: $300.00 came in from ZELLE FROM K JONES. Is this income? Reply YES or NO.",
    );
    expect(render("unusual_jump", { depositCents: 1_200_000, bufferCents: 70_000 }).body).toBe(
      "Stabl: $12,000.00 is much more than usual. We moved a normal amount, $700.00. Pause buffering for 3 months while we relearn, or keep going? Reply PAUSE or KEEP.",
    );
    expect(render("emergency_code", { code: "482913", minutes: 10, left: 1 }).body).toBe(
      "Stabl: Emergency unlock requested. Your code is 482913 and it expires in 10 minutes. You have 1 emergency unlock left this quarter.",
    );
    expect(render("home_base_change", {}).body).toBe(
      "Stabl: A request to change your home base was made. It takes effect in 72 hours. Not you? Reply FREEZE.",
    );
    expect(render("connection_broken", { institution: "Second Bank" }).body).toBe(
      "Stabl: We lost access to Second Bank. Open the app to reconnect. Your vault is safe.",
    );
  });
});

// Every screen: scan the app and component sources for emojis and dash characters.
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx|ts|json)$/.test(f) ? [p] : [];
  });
}

describe("screen copy", () => {
  const roots = ["app", "components"].filter((d) => {
    try {
      return statSync(d).isDirectory();
    } catch {
      return false;
    }
  });
  const sources = roots.flatMap(files);
  it.each(sources)("%s has no emojis or dash characters", (file) => {
    const text = readFileSync(file, "utf8");
    expect(text).not.toMatch(EMOJI);
    expect(text).not.toMatch(/[‒–—―]/);
  });
});
