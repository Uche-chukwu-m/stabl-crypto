// Turns captured frames into finished clips with ffmpeg: the screen, masked to
// rounded corners, sits in the phone body on the cream stage at 60 frames a second.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import ffmpeg from "ffmpeg-static";
import { STAGE } from "./layout.mjs";

const run = (args) => execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
const ENCODE = ["-c:v", "libx264", "-preset", "slow", "-crf", "14", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-r", String(STAGE.fps)];

// frames: [{ file, at }] in milliseconds, plus endAt. Each frame lasts until the
// next one arrives, exactly as it was on screen.
function concatList(dir, frames, endAt) {
  const lines = ["ffconcat version 1.0"];
  frames.forEach((f, i) => {
    const until = i + 1 < frames.length ? frames[i + 1].at : endAt;
    lines.push(`file '${path.join(dir, f.file)}'`, `duration ${Math.max(0.001, (until - f.at) / 1000).toFixed(4)}`);
  });
  // The concat demuxer drops the last duration unless the last file repeats.
  lines.push(`file '${path.join(dir, frames.at(-1).file)}'`);
  const list = path.join(dir, "frames.ffconcat");
  writeFileSync(list, lines.join("\n") + "\n");
  return list;
}

export function composeBeat({ framesDir, stageDir, out, holdSeconds = 0.8 }) {
  const { frames, endAt } = JSON.parse(readFileSync(path.join(framesDir, "timing.json"), "utf8"));
  const list = concatList(framesDir, frames, endAt);
  const { w, h, x, y } = STAGE.screen;
  // The still layers loop forever, so the clip length is set explicitly: the
  // recording plus the held last frame.
  const seconds = ((endAt - frames[0].at) / 1000 + holdSeconds).toFixed(3);
  const still = (file) => ["-loop", "1", "-framerate", String(STAGE.fps), "-i", path.join(stageDir, file)];
  run([
    "-f", "concat", "-safe", "0", "-i", list,
    ...still("stage-bg.png"),
    ...still("screen-mask.png"),
    ...still("stage-fg.png"),
    "-filter_complex",
    [
      `[0:v]fps=${STAGE.fps},tpad=stop_mode=clone:stop_duration=${holdSeconds},scale=${w}:${h}:flags=lanczos,format=rgba[screen]`,
      `[2:v]format=gray,scale=${w}:${h}[mask]`,
      `[screen][mask]alphamerge[rounded]`,
      `[1:v][rounded]overlay=${x}:${y}:shortest=1[staged]`,
      `[staged][3:v]overlay=0:0:shortest=1,format=yuv420p[out]`,
    ].join(";"),
    "-map", "[out]", "-t", seconds, ...ENCODE, out,
  ]);
}

// The closing card fades in and holds.
export function composeEndCard({ stageDir, out, seconds = 5 }) {
  run([
    "-loop", "1", "-t", String(seconds), "-i", path.join(stageDir, "end-card.png"),
    "-vf", `fps=${STAGE.fps},fade=t=in:st=0:d=0.6,format=yuv420p`,
    ...ENCODE, out,
  ]);
}

export function concatClips({ clips, out }) {
  const list = out.replace(/\.mp4$/, ".ffconcat");
  writeFileSync(list, ["ffconcat version 1.0", ...clips.map((c) => `file '${c}'`)].join("\n") + "\n");
  run(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", out]);
}

export function durationOf(file) {
  try {
    execFileSync(ffmpeg, ["-hide_banner", "-i", file], { stdio: "pipe" });
  } catch (e) {
    const m = String(e.stderr).match(/Duration: (\d+):(\d+):([\d.]+)/);
    if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  }
  return 0;
}
