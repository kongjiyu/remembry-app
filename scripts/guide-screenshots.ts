import { chromium } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const BASE_URL = "http://localhost:3010";
const OUTPUT_DIR = "./screenshots/guide";
const AUDIO_FILE = "./Recording Jan 15 2026.m4a";

async function takeGuideScreenshots() {
  // Verify audio file exists
  if (!fs.existsSync(AUDIO_FILE)) {
    console.error(`❌ Audio file not found: ${AUDIO_FILE}`);
    return;
  }

  console.log(`Using audio file: ${AUDIO_FILE}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true
  });
  const page = await context.newPage();

  // Create output directory
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const steps = [
    { name: "01-upload-page", path: "/meetings/new", desc: "Navigate to upload page" },
  ];

  console.log("\n=== Remembry User Guide Screenshots ===\n");

  try {
    // Step 1: Upload page
    console.log("📸 Step 1: Upload Page");
    await page.goto(`${BASE_URL}/meetings/new`, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${OUTPUT_DIR}/01-upload-page.png`, fullPage: false });
    console.log(`   ✅ Saved: ${OUTPUT_DIR}/01-upload-page.png`);

    // Step 2: Fill form and upload file
    console.log("📸 Step 2: Fill form and upload file");

    // Fill meeting title
    const titleInput = await page.$('input[type="text"], input[placeholder*="title" i], input[id*="title"]');
    if (titleInput) {
      await titleInput.fill("Recording Jan 15 2026");
    }

    // Upload audio file
    const fileInput = await page.$('input[type="file"]');
    if (fileInput) {
      await fileInput.setInputFiles(AUDIO_FILE);
      console.log("   📁 Audio file selected");
    }
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${OUTPUT_DIR}/02-file-selected.png`, fullPage: false });
    console.log(`   ✅ Saved: ${OUTPUT_DIR}/02-file-selected.png`);

    // Step 3: Submit for processing
    console.log("📸 Step 3: Submit for processing");
    const submitButton = await page.$('button[type="submit"], button:has-text("Upload"), button:has-text("Submit")');
    if (submitButton) {
      await submitButton.click();
      console.log("   🖱️ Submitted for processing");
    }
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${OUTPUT_DIR}/03-submitted.png`, fullPage: false });
    console.log(`   ✅ Saved: ${OUTPUT_DIR}/03-submitted.png`);

    // Step 4: Processing state
    console.log("📸 Step 4: Processing state");
    await page.waitForTimeout(5000);
    await page.screenshot({ path: `${OUTPUT_DIR}/04-processing.png`, fullPage: false });
    console.log(`   ✅ Saved: ${OUTPUT_DIR}/04-processing.png`);

    // Step 5: Check for results or redirect
    console.log("📸 Step 5: Check results");
    await page.waitForTimeout(10000); // Wait for AI processing
    const currentUrl = page.url();
    console.log(`   URL: ${currentUrl}`);
    await page.screenshot({ path: `${OUTPUT_DIR}/05-results.png`, fullPage: false });
    console.log(`   ✅ Saved: ${OUTPUT_DIR}/05-results.png`);

    // If redirected to meeting detail, capture that too
    if (currentUrl.includes("/meetings/")) {
      console.log("📸 Step 6: Meeting detail page");
      await page.waitForTimeout(3000);
      await page.screenshot({ path: `${OUTPUT_DIR}/06-meeting-detail.png`, fullPage: false });
      console.log(`   ✅ Saved: ${OUTPUT_DIR}/06-meeting-detail.png`);
    }

  } catch (error: unknown) {
    console.error(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
  }

  await browser.close();
  console.log("\n=== Guide screenshots complete ===");
}

takeGuideScreenshots();
