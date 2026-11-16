// Where everything sits in the finished 1920 by 1080 frame. The phone screen
// keeps the app's 390 by 844 shape (an iPhone 14 or 15).
const H = 1080;
const screenH = 940;
const screenW = Math.round((screenH * 390) / 844);

export const STAGE = {
  width: 1920,
  height: H,
  fps: 60,
  screen: { w: screenW + (screenW % 2), h: screenH, x: Math.round((1920 - screenW) / 2), y: Math.round((H - screenH) / 2), r: 58 },
  bezel: 13,
};

// The phone the app runs in while recording: logical size, pixel density, and
// the safe areas an iPhone reports (notch area at top, home bar at bottom).
export const PHONE = { width: 390, height: 844, scale: 3, safeTop: 47, safeBottom: 34 };
