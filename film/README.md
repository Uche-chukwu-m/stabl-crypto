# Pitch demo video

Records the app being used, one clip per talking point, and composes finished
1920 by 1080 videos with the phone on the brand stage. No voice: the speaker
talks over the clips.

```bash
npm run build
npx next start -p 3100   # leave running
npm run film             # in another terminal; about 2 minutes
```

Output goes to `../pitch-video` (set `FILM_OUT` to change it): one MP4 per beat,
`stabl-demo-full.mp4`, and `CUE-SHEET.md` with the suggested lines and Keynote
setup. Each run seeds a fresh film copy of Jemaya (`jemaya.film@demo.stabl.app`) on
the local database, so the live demo account is never touched.

`npm run film -- --compose` rebuilds the videos from the last recording without
recording again (for stage or encoding changes).

- `record.mjs`: the beats. Change timing, taps, or lines here.
- `layout.mjs`: frame size, phone size, and where the phone sits.
- `stage.mjs`: background, phone body, and closing card.
- `compose.mjs`: ffmpeg encoding.

Taps and drags show as a soft dot; that is added only in the recording browser.
