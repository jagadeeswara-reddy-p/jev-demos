// Drives a live run in the browser (needs `bun dev`, real keys or scripts/fake-providers.ts).
//   bun scripts/live.mjs <out-dir>
import { chromium } from "playwright";
const out = process.argv[2] ?? ".";
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto("http://localhost:5317/");
await page.waitForTimeout(1000);
console.log("line-up:", await page.locator("#scenario").inputValue());
await page.getByRole("button", { name: "Start live run" }).click();
await page.waitForTimeout(12000);
console.log("speed locked:", await page.getByRole("button", { name: "8×" }).isDisabled());
console.log("pause hidden:", (await page.getByRole("button", { name: "Pause" }).count()) === 0);
await page.screenshot({ path: `${out}/live-running.png`, fullPage: true });
await page.getByRole("button", { name: "Stop" }).click();
await page.waitForTimeout(800);
await page.getByRole("button", { name: "8×" }).click();
await page.getByRole("button", { name: "Replay" }).click();
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/live-replay.png` });
console.log("errors:", errors.length ? errors.join("\n") : "none");
await browser.close();
