import { chromium } from 'playwright-core';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createDatabase } from '../src/db.js';

const stagingOrigin = process.env.BROWSER_STAGING_ORIGIN;
const database = stagingOrigin ? null : await createDatabase();
const server = database && createApp(database).listen(0, '127.0.0.1');
if (server) await once(server, 'listening');
const origin = stagingOrigin || 'http://127.0.0.1:' + server.address().port;
let browser;
try {
  browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || undefined,
    headless: true,
  });
  for (const { width, count, drill } of [
    { width: 1280, count: 1, drill: false },
    { width: 390, count: 2, drill: true },
    { width: 360, count: 6, drill: false },
  ]) {
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
    if (drill) {
      await page.locator('footer a[href="#operations"]').click();
      await page.locator('#drill summary').click();
      await page.locator('#drop-response').check();
    }
    if (drill) await page.getByRole('link', { name: 'Book a train' }).click();
    else await page.locator('#book-ticket').click();
    await page.locator('#passenger-count').selectOption(String(count));
    await page.locator('#demo-routes button').first().click();
    await step('results');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'results overflow ' + width);
    assert.equal(await page.locator('#flow-progress [aria-current=step]').innerText(), 'Train');
    await page.locator('#train-sort').selectOption('availability');
    const availability = (await page.locator('.availability-count').allTextContents()).map(text => Number.parseInt(text, 10));
    assert.ok(availability.length > 1);
    assert.deepEqual(availability, [...availability].sort((a, b) => b - a));
    await page.locator('#train-sort').selectOption('departure');
    assert.match(await page.locator('.train-card').first().innerText(), /Deccan Dawn Express/);
    await page.locator('.train-card').first().click();
    await step('coach');
    await page.locator('.class-choice').nth(1).click();
    await page.locator('#reserve-seats').click();
    await page.locator('#passenger-switch').click();
    await page.locator('#passenger-name').fill('Test Rider');
    await page
      .locator('[name=email]')
      .fill('qa' + Date.now() + '@example.test');
    await page.locator('#passenger-password').fill('test-passphrase-123');
    await page.locator('#passenger-submit').click();
    await step('traveller');
    const travellers = page.locator('.traveller-fields');
    assert.equal(await travellers.count(), count);
    for (let i = 0; i < count; i++) {
      const person = travellers.nth(i);
      await person.locator('[name=name]').fill('Sample Rider ' + (i + 1));
      await person.locator('[name=age]').fill('25');
      await person.locator('[name=gender]').selectOption('Other');
      await person.locator('[name=preference]').selectOption(i === 0 && width === 1280 ? 'Side lower' : 'Lower');
    }
    const displayTotal = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(840 * count);
    assert.equal(await page.locator('#traveller [data-summary=total]').innerText(), displayTotal);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'traveller overflow ' + width);
    await page.locator('#continue-payment').click();
    await step('payment');
    await page.reload();
    await step('payment');
    assert.ok(
      await page
        .locator('#pay-now')
        .innerText()
        .then((x) => x.includes(String(840 * count))),
    );
    if (!drill && width === 1280) {
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
    } else if (drill) {
      await page.locator('#pay-now').click();
      await page
        .getByText('Drill: the server committed', { exact: false })
        .waitFor();
      await page.reload();
      await step('payment');
      await page.locator('#check-paid').click();
    } else {
      await page.locator('#pay-now').click();
    }
    await step('receipt');
    if (width === 1280) assert.equal(await page.locator('#ticket-seat').innerText(), '19');
    const pnrs = await page.locator('#group-tickets li').allTextContents();
    assert.equal(pnrs.length, count);
    assert.equal(new Set(pnrs.map(text => text.match(/TS-[A-F0-9]+/)[0])).size, count);
    const pnr = await page.locator('#ticket-pnr').innerText();
    await page.reload();
    await step('receipt');
    assert.equal(await page.locator('#ticket-pnr').innerText(), pnr);
    assert.deepEqual(await page.locator('#group-tickets li').allTextContents(), pnrs);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      'overflow ' + width,
    );
    await page.locator('#passenger-open').click();
    await page.locator('.saved-ticket summary').first().click();
    await page.locator('.saved-ticket').first().getByText(/Sample Rider [1-6]/).waitFor();
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Cancel ticket' }).click();
    await page
      .locator('.saved-ticket-status')
      .filter({ hasText: 'Cancelled' })
      .waitFor();
    await page.goto(origin + '/jury/');
    await page.getByRole('heading', { name: /ONE RUSH/ }).waitFor();
    await page.locator('#run-simulation').click();
    assert.equal(await page.locator('#ip-human').innerText(), '25 / 6');
    assert.equal(await page.locator('#fair-human').innerText(), '36 / 12');
    assert.equal(await page.locator('#seat-outcome').innerText(), '12 / 18');
    await page.locator('#recovery').click();
    const backendTrace = page.locator('#booking-trace');
    await backendTrace.getByRole('button', { name: 'Recover' }).click();
    await backendTrace.getByRole('heading', { name: 'Retry with the same hold token' }).waitFor();
    await page.locator('#delivery-trace').getByRole('button', { name: 'Browser' }).click();
    await page.getByRole('heading', { name: 'Exercise the staging booking app' }).waitFor();
    await page.getByText('API READY', { exact: false }).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'jury overflow ' + width);
    assert.deepEqual(errors, []);
    console.log(
      width + 'px, ' + count + ' passenger(s): automatic berth assignment, checkout, reload, cancellation and jury walkthrough passed',
    );
    await ctx.close();
  }
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await database?.pool.end();
}
