// The spoken track for the narrated demo, one line per beat, and the voice that
// reads it. Lines are written to be heard: short sentences, numbers spelled the
// way they should be said.
//
// The voice comes from macOS `say`. FILM_VOICE picks it (run `say -v '?'` for the
// list); a Premium or Enhanced voice from System Settings, Accessibility, Spoken
// Content sounds far more natural than the built in ones. FILM_RATE sets words a
// minute. To use a recorded voice instead, put one file per beat in
// FILM_VOICE_DIR named <beat key>.m4a (or .wav, .aiff) and it is used as is.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import ffmpeg from "ffmpeg-static";
import { durationOf } from "./compose.mjs";

export const VOICE = process.env.FILM_VOICE ?? "Samantha";
export const RATE = Number(process.env.FILM_RATE ?? 168);

export const LINES = {
  "00-problem":
    "Uneven income is normal. The JPMorgan Chase Institute found a typical family's income changes by about a third from one month to the next. And in a 2025 survey by Remote, eighty five percent of freelancers said they're paid late at least some of the time. As researcher Jonathan Morduch puts it, people want the right money at the right time.",
  "01-meet-jemaya":
    "Stabl handles that timing for you. This is Jemaya, a freelance designer. Stabl reads her bank through Plaid and learns her income and her bills. In good weeks it sets money aside. In slow weeks it gives it back.",
  "02-big-client-pays":
    "A big client pays. Stabl sees six hundred and fifty dollars more than she needs for the next three weeks, and tells her a day before anything moves.",
  "03-set-aside":
    "The next day, it moves into her vault. She only ever sees dollars. Underneath, the vault is a smart contract on Arc, Circle's blockchain for dollars.",
  "04-proof":
    "Every receipt links to its proof on Arc. Circle made her a wallet and paid the fee, so she never touches crypto.",
  "05a-why-a-blockchain":
    "Why a blockchain? In 2024, the fintech middleman Synapse collapsed. It kept the ledger of who was owed what, and when it failed, customers couldn't prove their balances. Tens of millions of dollars went unaccounted for. Stabl's vault balances live on a public ledger anyone can check, the rules are in code, and it runs around the clock.",
  "05b-how-it-settles":
    "And why these three? Arc runs on dollars: fees are paid in U S D C, about a tenth of a cent, and every move is final in under a second. Circle gives each person a wallet they never see, and pays the fees. QuickNode pushes every vault event to Stabl the moment it lands, so nothing is missed, and nothing counts twice.",
  "06-check-it":
    "In Settings, Jemaya can check Stabl against the contract herself, read live from Arc. Each move here was confirmed by the QuickNode Stream.",
  "07-slow-week":
    "Then work dries up, and the car needs a repair. Stabl sends money back right away.",
  "08-emergency":
    "In an emergency, she can unlock her vault the same day with a one time code, sent from her own vault wallet.",
  "09-honest":
    "To be clear: the bank side and the dollar to U S D C conversion are simulated. Every vault starts with a key Stabl manages, and one tap moves it to a passkey on your phone; then only you can unfreeze or unlock it. In production, Stabl pays you first over instant bank networks, and the vault settles behind it in under a second. The vault moves you saw are real, on Arc's test network. And across two hundred simulated freelancers, Stabl never caused an overdraft.",
  "10-closing": "Stabl. Steady pay for uneven income.",
};

// Make the audio for every beat, and return each one's file and length.
export function speakAll(dir) {
  mkdirSync(dir, { recursive: true });
  const out = {};
  for (const [key, line] of Object.entries(LINES)) {
    const recorded = ["m4a", "wav", "aiff", "mp3", "mov", "caf"].map((ext) => process.env.FILM_VOICE_DIR && path.join(process.env.FILM_VOICE_DIR, `${key}.${ext}`)).find((f) => f && existsSync(f));
    const file = path.join(dir, `${key}.m4a`);
    if (recorded) {
      // Trim the silence before and after the line, and bring every clip to the
      // same loudness, so takes recorded at different times sound like one.
      const trim = "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.1";
      execFileSync(ffmpeg, [
        "-hide_banner", "-loglevel", "error", "-y", "-i", recorded, "-vn",
        "-af", `${trim},areverse,${trim},areverse,highpass=f=70,loudnorm=I=-16:TP=-1.5:LRA=11`,
        "-ac", "2", "-ar", "48000", "-c:a", "aac", "-b:a", "192k", file,
      ]);
    } else {
      const aiff = path.join(dir, `${key}.aiff`);
      execFileSync("say", ["-v", VOICE, "-r", String(RATE), "-o", aiff, line]);
      // A touch of room and a gentle level, so the synthetic voice sits better.
      execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", aiff, "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ac", "2", "-ar", "48000", "-c:a", "aac", "-b:a", "192k", file]);
    }
    out[key] = { file, seconds: durationOf(file) };
  }
  return out;
}
