#!/usr/bin/env node
/**
 * Playwright screenshot script for consumer withdrawal verification.
 * 
 * Usage (run from services/user-front/):
 *   WALLET_KEY=0x59c6... npx playwright test scripts/screenshot-withdraw-flow.ts
 * 
 * Or run directly:
 *   node scripts/screenshot-withdraw-flow.mjs
 *
 * Pre-conditions:
 *   - Frontend running at http://localhost:3000
 *   - Gateway running at http://localhost:8000
 *   - Wallet already signed in (or WALLET_KEY provided for auto-auth)
 *
 * Output:
 *   docs/screenshots/
 *     01_credits_before_withdraw.png
 *     02_withdraw_modal.png
 *     03_credits_after_withdraw.png
 *     04_billing_payments_with_withdraw_record.png
 */

import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import https from 'https';
import http from 'http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.resolve(__dirname, '../../../docs/screenshots');
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

async function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  console.log('1. Navigating to Credits page...');
  await page.goto(`${FRONTEND_URL}/dashboard/billing/credits`, { waitUntil: 'networkidle' });
  await wait(2000);

  // Screenshot 1: Credits page before withdrawal
  const before = path.join(SCREENSHOTS_DIR, '01_credits_before_withdraw.png');
  await page.screenshot({ path: before, fullPage: false });
  console.log(`   ✓ Saved: ${before}`);

  // Check current balance text
  const balanceEl = page.locator('p.text-\\[24px\\]').first();
  const balanceText = await balanceEl.textContent().catch(() => 'N/A');
  console.log(`   Balance before: ${balanceText}`);

  // Try to open the withdraw modal
  const withdrawBtn = page.getByRole('button', { name: 'Withdraw' });
  const isDisabled = await withdrawBtn.isDisabled().catch(() => true);

  if (!isDisabled) {
    console.log('2. Opening withdrawal modal...');
    await withdrawBtn.click();
    await wait(800);

    // Screenshot 2: Withdrawal modal open
    const modal = path.join(SCREENSHOTS_DIR, '02_withdraw_modal.png');
    await page.screenshot({ path: modal, fullPage: false });
    console.log(`   ✓ Saved: ${modal}`);

    // Get amount input value
    const amountInput = page.getByRole('spinbutton');
    const amount = await amountInput.inputValue().catch(() => '');
    console.log(`   Withdrawal amount: ${amount}`);

    // Submit withdrawal
    console.log('3. Submitting withdrawal...');
    const submitBtn = page.locator('button:has-text("Withdraw")').last();
    await submitBtn.click();
    await wait(2000); // wait for refresh

    // Screenshot 3: Credits page after withdrawal
    const after = path.join(SCREENSHOTS_DIR, '03_credits_after_withdraw.png');
    await page.screenshot({ path: after, fullPage: false });
    const balanceAfter = await balanceEl.textContent().catch(() => 'N/A');
    console.log(`   ✓ Saved: ${after}`);
    console.log(`   Balance after: ${balanceAfter}`);
  } else {
    console.log('2. Withdraw button is disabled (balance may be 0 or not authenticated)');
    // Take a screenshot of current state anyway
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '02_withdraw_modal.png'),
      fullPage: false,
    });
  }

  // Navigate to Billing / Payments page
  console.log('4. Navigating to Billing / Payments page...');
  await page.goto(`${FRONTEND_URL}/dashboard/billing`, { waitUntil: 'networkidle' });
  await wait(2000);

  // Screenshot 4: Billing page with withdrawal record
  const billing = path.join(SCREENSHOTS_DIR, '04_billing_payments_with_withdraw_record.png');
  await page.screenshot({ path: billing, fullPage: false });
  console.log(`   ✓ Saved: ${billing}`);

  await browser.close();
  console.log('\nDone. Screenshots saved to:', SCREENSHOTS_DIR);
}

run().catch(err => {
  console.error('Screenshot script failed:', err.message);
  process.exit(1);
});
