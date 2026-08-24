import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const URL = "http://127.0.0.1:3477/";
const OUT = ".impeccable/shots";
mkdirSync(OUT, { recursive: true });

const shots = [
  { name: "desktop-hero", w: 1440, h: 900, at: 0 },
  { name: "desktop-history", w: 1440, h: 900, at: "#history" },
  { name: "desktop-structure", w: 1440, h: 900, at: "#structure" },
  { name: "desktop-search", w: 1440, h: 900, at: "#search" },
  { name: "desktop-close", w: 1440, h: 900, at: "#join" },
  { name: "mobile-hero", w: 390, h: 844, at: 0 },
  { name: "mobile-history", w: 390, h: 844, at: "#history" },
  { name: "mobile-structure", w: 390, h: 844, at: "#structure" },
  { name: "mobile-search", w: 390, h: 844, at: "#search" },
  { name: "mobile-close", w: 390, h: 844, at: "#join" },
];

const browser = await chromium.launch();

for (const s of shots) {
  const page = await browser.newPage({
    viewport: { width: s.w, height: s.h },
    deviceScaleFactor: 2,
  });
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  if (s.at) {
    await page.evaluate((sel) => {
      document.querySelector(sel)?.scrollIntoView();
    }, s.at);
  }
  // let the wake catch up to the new scroll position
  await page.waitForTimeout(1400);
  await page.screenshot({ path: `${OUT}/${s.name}.png` });
  await page.close();
}

// hover state of the primary CTA — the plankton field inside the button only
// exists on :hover/:focus-visible, so a static page shot cannot show it
const hov = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 3,
});
await hov.goto(URL, { waitUntil: "networkidle" });
await hov.waitForTimeout(900);
const cta = hov.locator("#hero-wl button");
await cta.hover();
await hov.waitForTimeout(1600);
await cta.screenshot({ path: `${OUT}/desktop-cta-hover.png` });
await hov.keyboard.press("Tab");
await cta.focus();
await hov.waitForTimeout(900);
await cta.screenshot({ path: `${OUT}/desktop-cta-focus.png` });
await hov.close();

// full-page desktop, for scroll pacing
const tall = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await tall.goto(URL, { waitUntil: "networkidle" });
await tall.waitForTimeout(900);
await tall.screenshot({ path: `${OUT}/desktop-full.png`, fullPage: true });
await tall.close();

await browser.close();
console.log("shot", shots.length + 1);
