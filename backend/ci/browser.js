import { chromium } from 'playwright-core';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createDatabase } from '../src/db.js';

const database = await createDatabase();
const server = createApp(database).listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = 'http://127.0.0.1:' + server.address().port;
let browser;
try {
  browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || undefined,
    headless: true,
  });
  for (const width of [1280, 390]) {
    const ctx = await browser.newContext({baseURL: origin,
      viewport: { width, height: 850 },
      reducedMotion: 'reduce',
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const step = (s) =>
      page.waitForSelector('body[data-page="' + s + '"]', { timeout: 7000 });
    await page.goto(origin);
    if (width === 390) {
      await page.locator('#drill summary').click();
      await page.locator('#drop-response').check();
    }
    await page.locator('#demo-routes button').first().click();
    await step('results');
    await page.locator('.train-card').first().click();
    await step('coach');
    await page.locator('.class-choice').nth(1).click();
    await page.locator('.seat.free').first().click();
    await page.locator('#passenger-switch').click();
    await page.locator('#passenger-name').fill('Test Rider');
    await page
      .locator('[name=email]')
      .fill('qa' + Date.now() + '@example.test');
    await page.locator('#passenger-password').fill('test-passphrase-123');
    await page.locator('#passenger-submit').click();
    await step('traveller');
    await page.locator('#traveller-form [name=name]').fill('Sample Rider');
    await page.locator('[name=age]').fill('25');
    await page.locator('[name=gender]').selectOption('Other');
    await page.locator('[name=preference]').selectOption('Lower');
    await page.locator('#traveller-form button').click();
    await step('payment');
    await page.reload();
    await step('payment');
    assert.ok(
      await page
        .locator('#pay-now')
        .innerText()
        .then((x) => x.includes('840')),
    );
    if (width === 1280) {
      const response = await page.request.get(
        await page.locator('#pay-qr').getAttribute('src'),
      );
      const png = PNG.sync.read(await response.body());
      const decoded = jsQR(
        new Uint8ClampedArray(png.data),
        png.width,
        png.height,
      );
      assert.ok(decoded, 'The displayed QR must decode');
      assert.equal(new URL(decoded.data).origin, origin);
      const wallet = await ctx.newPage();
      await wallet.goto(decoded.data);
      await wallet.locator('#pay').click();
      await wallet.getByText('Paid.', { exact: false }).waitFor();
      await wallet.close();
      await page.locator('#check-paid').click();
    } else {
      await page.locator('#pay-now').click();
      await page
        .getByText('Drill: the server committed', { exact: false })
        .waitFor();
      await page.reload();
      await step('payment');
      await page.locator('#check-paid').click();
    }
    await step('receipt');
    const pnr = await page.locator('#ticket-pnr').innerText();
    await page.reload();
    await step('receipt');
    assert.equal(await page.locator('#ticket-pnr').innerText(), pnr);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      'overflow ' + width,
    );
    await page.locator('#passenger-open').click();
    await page.locator('.saved-ticket summary').first().click();
    await page.getByText('Sample Rider', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Change seat' }).click();
    await page.getByRole('button', { name: 'Save seat change' }).click();
    await page.getByText('Seat changed. Your PNR is the same.').waitFor();
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Cancel ticket' }).click();
    await page
      .locator('.saved-ticket-status')
      .filter({ hasText: 'Cancelled' })
      .waitFor();
    assert.deepEqual(errors, []);
    console.log(
      width + 'px checkout, reload, ticket modification, cancellation passed',
    );
    await ctx.close();
  }
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  await database.pool.end();
}

