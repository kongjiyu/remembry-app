import { chromium } from "@playwright/test";

const BASE_URL = "http://localhost:3010";
const OUTPUT_DIR = "./public";

async function validatePage(page: any, name: string): Promise<boolean> {
  // Check for error elements
  const errorEl = await page.$('text=/error|failed|connection/i');
  if (errorEl) {
    const errorText = await errorEl.textContent();
    console.log(`  ⚠ Found error text: ${errorText}`);
    return false;
  }

  // Check if main content loaded
  const body = await page.$('body');
  const bodyText = await body?.textContent();
  if (bodyText && bodyText.length < 100) {
    console.log(`  ⚠ Page seems empty or minimal`);
    return false;
  }

  return true;
}

async function takeScreenshots() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true
  });
  const page = await context.newPage();

  const pages = [
    { name: "01-home", path: "/dashboard" },
    { name: "02-meetings", path: "/meetings" },
    { name: "03-new-meeting", path: "/meetings/new" },
    { name: "04-settings", path: "/settings" },
  ];

  console.log("Testing and taking screenshots...\n");

  for (const p of pages) {
    try {
      console.log(`📸 ${p.name}:`);
      console.log(`   Navigating to ${p.path}...`);
      await page.goto(`${BASE_URL}${p.path}`, { waitUntil: "networkidle", timeout: 30000 });

      // Wait for content to settle
      await page.waitForTimeout(3000);

      const url = page.url();
      console.log(`   URL: ${url}`);

      // Validate page content
      const isValid = await validatePage(page, p.name);
      if (!isValid) {
        console.log(`   ⚠ Page may have issues, but taking screenshot anyway`);
      }

      // Wait for loading states to complete
      const loadingEl = await page.$('text=/loading|Loading/i');
      if (loadingEl) {
        console.log(`   ⏳ Waiting for loading to complete...`);
        await page.waitForSelector('text=/loading/gi', { state: 'hidden', timeout: 10000 }).catch(() => {});
        await page.waitForTimeout(1000);
      }

      // Take screenshot
      await page.screenshot({ path: `${OUTPUT_DIR}/${p.name}.png`, fullPage: false });

      // Verify file
      const fs = await import('fs');
      const stats = fs.statSync(`${OUTPUT_DIR}/${p.name}.png`);
      console.log(`   ✅ Screenshot saved (${stats.size} bytes)\n`);

    } catch (error: unknown) {
      console.error(`   ❌ Error: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }

  await browser.close();
  console.log("Done!");
}

takeScreenshots();
