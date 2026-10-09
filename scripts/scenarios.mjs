// Runs each line-up briefly and screenshots it: node scripts/scenarios.mjs <out-dir>
import { chromium } from "playwright";
const out = process.argv[2] ?? ".";
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto("http://localhost:5317/");
for (const [id, wait] of [["baselines", 6000], ["frozen", 6000], ["failures", 8000]]) {
  await page.selectOption("#scenario", id);
  await page.getByRole("button", { name: "8×" }).click();
  await page.getByRole("button", { name: "Start run" }).click();
  await page.waitForTimeout(wait);
  await page.getByRole("button", { name: "Pause" }).click();
  await page.locator(".boards").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/scenario-${id}.png`, fullPage: true });
  await page.getByRole("button", { name: "Stop" }).click();
}
console.log("errors:", errors.length ? errors.join("\n") : "none");
await browser.close();
