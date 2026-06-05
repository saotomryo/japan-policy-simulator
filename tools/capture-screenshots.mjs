import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const baseUrl = process.env.SCREENSHOT_BASE_URL || "http://127.0.0.1:4173";
const outDir = "assets/screenshots";

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 2048, height: 1040 },
  deviceScaleFactor: 1,
});

page.setDefaultTimeout(25000);
await page.addInitScript(() => {
  localStorage.setItem("national-policy-display-mode", "detail");
});

async function saveScreenshot(name) {
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${outDir}/${name}`, fullPage: false });
  console.log(`saved ${outDir}/${name}`);
}

await page.goto(baseUrl, { waitUntil: "networkidle" });
await saveScreenshot("dashboard.png");

await page.click('a[data-view="issues"]');
await page.waitForSelector(".issue-row");
await page.click(".issue-row");
await page.waitForFunction(() => !document.querySelector("#generate-target-analysis")?.disabled);
await saveScreenshot("policy-target.png");

await page.click("#generate-target-analysis");
await page.waitForFunction(() => document.querySelector(".generation-notice")?.textContent?.includes("完了"));
await page.click('a[data-view="voices"]');
await page.waitForFunction(() => document.querySelector(".app-shell")?.className.includes("view-voices"));
await saveScreenshot("voices.png");

await page.click('a[data-view="policy"]');
await page.waitForTimeout(700);
await saveScreenshot("policy-draft.png");

const executeButton = page.locator("#execute-policy").first();
if (await executeButton.count()) {
  await executeButton.click();
  await page.waitForFunction(() => document.querySelector(".app-shell")?.className.includes("view-result"));
} else {
  await page.click('a[data-view="result"]');
}
await saveScreenshot("result-report.png");

await browser.close();
