// The spoken track for the narrated demo, one line per beat, and the voice that
// reads it. Lines are written to be heard: short sentences, numbers spelled the
// way they should be said.
//
// The voice comes from macOS `say`. FILM_VOICE picks it (run `say -v '?'` for the
// list); a Premium or Enhanced voice from System Settings, Accessibility, Spoken
// Content sounds far more natural than the built in ones. FILM_RATE sets words a
// minute. To use a recorded voice instead, put one file per beat in
// FILM_VOICE_DIR named <beat key>.m4a (or .wav, .aiff) and it is used as is.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import ffmpeg from "ffmpeg-static";
import { durationOf } from "./compose.mjs";

export const VOICE = process.env.FILM_VOICE ?? "Samantha";
export const RATE = Number(process.env.FILM_RATE ?? 168);

export const LINES = {
  "00-problem":
    "Uneven income is normal. The JPMorgan Chase Institute found a typical family's income changes by about a third from one month to the next. And in a 2025 survey by Remote, eighty-five percent of freelancers said they're paid late at least some of the time. As researcher Jonathan Morduch puts it, people want the right money at the right time.",
  "01-meet-jemaya":
    "Stabl handles that timing for you. Meet Mike, a freelance designer. Stabl reads his bank through Plaid and learns his income and his bills. In good weeks it sets money aside. In slow weeks it gives it back.",
  "02-big-client-pays":
    "A big client pays. Stabl sees six hundred and fifty dollars more than Mike needs for the next three weeks, and tells him a day before anything moves.",
  "03-set-aside":
    "The next day, it moves into his vault. Mike only ever sees dollars. Underneath, the vault is a smart contract on Arc, Circle's blockchain for dollars.",
  "04-proof":
    "Every receipt links to its proof on Arc. Circle made Mike a wallet and paid the fee, so he never touches crypto.",
  "05a-why-a-blockchain":
    "Why a blockchain? Three reasons. Trust: in 2024 the fintech middleman Synapse collapsed, and customers couldn't prove what they were owed. Stabl's balances sit on a public ledger anyone can check. Time: the vault settles in under a second, any day, even on the weekends when bank transfers stop. And rules: the contract enforces Stabl's rules at the ledger itself, and next it can split each payout into a reserve that earns yield in tokenized Treasuries.",
  "05b-how-it-settles":
    "And why these three? Arc, because fees are paid in dollars, about a tenth of a cent. Circle, for wallets with no seed phrase. QuickNode, to push each vault event to Stabl the moment it lands.",
  "06-check-it":
    "In Settings, Mike can check Stabl against the contract himself, read live from Arc, and see each move confirmed by the QuickNode Stream.",
  "07-slow-week":
    "Then work dries up, and the car needs a repair. Stabl sends money back right away.",
  "08-emergency":
    "In an emergency, Mike can unlock his vault the same day with a one-time code. And with a passkey on his phone, only he can.",
  "09-honest":
    "To be clear: the bank side and the conversion to U S D C are simulated. The vault moves you saw are real, on Arc's test network. Next, real dollars through a licensed bank partner, instant payouts, and a pilot with real freelancers. Because this is what they tell us. For one freelance screenwriter, a client paying late meant a late fee on January rent and some overdraft fees.",
  "10-closing":
    "Stabl. Steady pay for uneven income.",
};

// Make the audio for every beat, and return each one's file and length.
// One continuous take (FILM_VOICE_TAKE=<file>): the whole script read straight
// through, with a pause of about two seconds between sections. The take is cut
// at its longest pauses, one fewer than there are sections, into one clip per
// beat, in order. Each clip is then trimmed and leveled like any recorded clip.
function cutTake(take, dir) {
  const keys = Object.keys(LINES);
  // ffmpeg prints silence detection to stderr; spawnSync keeps both streams.
  const probe = spawnSync(ffmpeg, ["-hide_banner", "-i", take, "-af", "silencedetect=noise=-38dB:d=0.9", "-f", "null", "-"], { encoding: "utf8" });
  const text = `${probe.stdout ?? ""}${probe.stderr ?? ""}`;
  const starts = [...text.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...text.matchAll(/silence_end: ([\d.]+) \| silence_duration: ([\d.]+)/g)].map((m) => ({ end: Number(m[1]), length: Number(m[2]) }));
  const pauses = ends.map((e, i) => ({ at: (starts[i] ?? e.end - e.length) + e.length / 2, length: e.length }));
  const total = durationOf(take);
  // Ignore silence at the very start and end of the take.
  const inner = pauses.filter((p) => p.at > 1 && p.at < total - 1);
  if (!process.env.FILM_VOICE_CUTS && inner.length < keys.length - 1) {
    throw new Error(`The take has ${inner.length} clear pauses but needs ${keys.length - 1}. Leave about two seconds between sections.`);
  }
  // FILM_VOICE_CUTS lists the cut points by hand, in seconds, when the pauses
  // between sections are not the longest ones in the take.
  const manual = process.env.FILM_VOICE_CUTS?.split(",").map(Number).filter((n) => Number.isFinite(n));
  const cuts = manual?.length === keys.length - 1 ? manual : inner.sort((a, b) => b.length - a.length).slice(0, keys.length - 1).map((p) => p.at).sort((a, b) => a - b);
  const bounds = [0, ...cuts, total];
  mkdirSync(dir, { recursive: true });
  return keys.map((key, i) => {
    const file = path.join(dir, `${key}.wav`);
    execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", take, "-ss", bounds[i].toFixed(3), "-to", bounds[i + 1].toFixed(3), "-ac", "1", file]);
    return [key, file];
  });
}

export function speakAll(dir) {
  mkdirSync(dir, { recursive: true });
  const out = {};
  if (process.env.FILM_VOICE_TAKE) {
    const pieces = cutTake(process.env.FILM_VOICE_TAKE, path.join(dir, "take"));
    process.env.FILM_VOICE_DIR = path.join(dir, "take");
    console.log(`Split the take into ${pieces.length} clips at its ${pieces.length - 1} longest pauses.`);
  }
  for (const [key, line] of Object.entries(LINES)) {
    const recorded = ["m4a", "wav", "aiff", "mp3", "mov", "caf"].map((ext) => process.env.FILM_VOICE_DIR && path.join(process.env.FILM_VOICE_DIR, `${key}.${ext}`)).find((f) => f && existsSync(f));
    const file = path.join(dir, `${key}.m4a`);
    if (recorded) {
      // Trim the silence before and after the line, and bring every clip to the
      // same loudness, so takes recorded at different times sound like one.
      const trim = "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.1";
      execFileSync(ffmpeg, [
        "-hide_banner", "-loglevel", "error", "-y", "-i", recorded, "-vn",
        // Only true silence (below -50 dB) longer than 0.9 s inside a line is
        // shortened, to 0.6 s, so no quiet part of a word is ever cut.
        // FILM_VOICE_TEMPO speeds speech up without changing pitch.
        "-af", `${trim},areverse,${trim},areverse,silenceremove=stop_periods=-1:stop_duration=${process.env.FILM_VOICE_PAUSE_MAX ?? 0.9}:stop_threshold=${process.env.FILM_VOICE_PAUSE_DB ?? -50}dB:stop_silence=0.6,atempo=${Number(process.env.FILM_VOICE_TEMPO ?? 1)},highpass=f=70,loudnorm=I=-16:TP=-1.5:LRA=11`,
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
