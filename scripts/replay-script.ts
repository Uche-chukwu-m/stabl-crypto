// Writes app/replay/script.json, the offline pitch replay, using the real message
// templates so the replay never drifts from what the app sends.
import { writeFileSync } from "node:fs";
import { render } from "@/lib/notify/templates";

const account = "Checking 4321";
const steps = [
  { at: 0, title: "Home", status: "steady", vaultCents: 1_280_00, note: "Jemaya is Steady. Income swings, spending stays inside the band.", message: null },
  {
    at: 6,
    title: "Big client pays",
    status: "feast",
    vaultCents: 1_280_00,
    note: "A big client payment lands. The feast check runs.",
    message: render("buffer_announced", { amountCents: 650_00, account, shrunk: false }).body,
  },
  {
    at: 14,
    title: "One day later",
    status: "feast",
    vaultCents: 1_930_00,
    note: "The buffer settles. The receipt shows both balances.",
    message: render("buffer_settled", { amountCents: 650_00, vaultCents: 1_930_00, checkingCents: 2_105_33 }).body,
  },
  {
    at: 22,
    title: "Slow week",
    status: "fast",
    vaultCents: 1_520_00,
    note: "No income and a $620.00 car repair. The fast check sends money back right away. No question asked.",
    message: render("release", { amountCents: 410_00, account, vaultCents: 1_520_00, unusual: false }).body,
  },
  {
    at: 30,
    title: "Emergency",
    status: "fast",
    vaultCents: 1_520_00,
    note: "EMERGENCY typed in Telegram. The code shows in the app, never back in Telegram.",
    message: render("emergency_code", { code: "482913", minutes: 10, left: 1 }).body,
  },
  {
    at: 37,
    title: "Unlocked the same day",
    status: "fast",
    vaultCents: 1_370_00,
    note: "Code and $150.00 entered. The money is in checking now.",
    message: render("emergency_settled", { amountCents: 150_00, account, vaultCents: 1_370_00 }).body,
  },
  { at: 45, title: "The thread", status: "fast", vaultCents: 1_370_00, note: "The messages tell the whole story with no screen explained.", message: null },
];
writeFileSync("app/replay/script.json", JSON.stringify({ persona: "Jemaya Brooks", steps }, null, 2) + "\n");
console.log("wrote app/replay/script.json");
