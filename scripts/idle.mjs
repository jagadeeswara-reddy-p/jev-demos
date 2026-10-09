// Screenshots the page before any run: bun scripts/idle.mjs <out-dir>
import { chromium } from "playwright";
const out = process.argv[2] ?? ".";
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto("http://localhost:5317/");
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/idle.png` });
console.log("line-up:", await page.locator("#scenario").inputValue());
console.log("boards:", await page.locator("figure h2").allInnerTexts());
console.log("selects in boards:", await page.locator("figure select").count(), "add tile:", await page.locator(".add-board").count());
console.log("errors:", errors.length ? errors.join("\n") : "none");
await browser.close();
