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
    "Freelancers can earn enough over a year and still come up short, because clients pay whenever they pay. Rent is due on the first either way. Stabl smooths that out. It sets money aside in good weeks, and gives it back in slow ones.",
  "01-meet-jemaya":
    "This is Jemaya, a freelance designer. Stabl reads her bank through Plaid, and learns her income and her bills. Her pay swings. Her spending stays steady.",
  "02-big-client-pays":
    "A big client pays. Stabl sees six hundred and fifty dollars more than she needs for the next three weeks, and tells her a day before anything moves. She can reply, stop.",
  "03-set-aside":
    "The next day, the money moves into her vault. Jemaya only ever sees dollars. Under the hood, that vault is a smart contract on Arc, Circle's blockchain for dollars.",
  "04-proof":
    "Every receipt carries a proof link. This is that deposit on Arc. Test U S D C, credited to a wallet Circle made for her. Circle's Gas Station paid the fee, so she never needs crypto of her own.",
  "05-how-it-settles":
    "Here is how a move settles. The engine decides. Circle signs. The vault contract on Arc enforces the rules: money can only ever go back to its owner. A QuickNode Stream watches the contract and posts each event to Stabl. Only then does Stabl write the ledger and send the receipt. If an event arrives twice, nothing happens twice.",
  "06-check-it":
    "In settings, Jemaya can check it herself. What Stabl shows matches what the contract holds, read live from Arc. And each move was confirmed by the QuickNode Stream.",
  "07-slow-week":
    "Then work dries up, and the car needs a repair. Stabl sends money back right away. That release is on Arc too.",
  "08-emergency":
    "If something urgent comes up, she can unlock her vault the same day, with a one time code. That transaction comes from her own vault wallet, not from Stabl's operator.",
  "09-honest":
    "To be clear about this prototype. The bank side, and the conversion between dollars and U S D C, are simulated. And Stabl still manages the wallet keys. Next, those keys move to the user's phone. The vault moves are real transactions on Arc's test network. We also ran two hundred simulated freelancers through the same engine. Stabl never caused an overdraft. And when people spend some of what they can see, it cut overdraft days by up to forty four percent.",
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
