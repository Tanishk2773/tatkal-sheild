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
      await page.locator('footer a[href="#operations"]').click();
      await page.locator('#drill summary').click();
      await page.locator('#drop-response').check();
    }
    if (width === 390) await page.getByRole('link', { name: 'Book a train' }).click();
    else await page.locator('#book-ticket').click();
    await page.locator('#passenger-count').selectOption('2');
    await page.locator('#demo-routes button').first().click();
    await step('results');
    await page.locator('.train-card').first().click();
    await step('coach');
    await page.locator('.class-choice').nth(1).click();
    await page.locator('.seat.free').first().click();
    await page.locator('.seat.free:not(.selected)').first().click();
    assert.match(await page.locator('#selection-summary').innerText(), /2 of 2 selected/);
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
    assert.equal(await travellers.count(), 2);
    for (let i = 0; i < 2; i++) {
      const person = travellers.nth(i);
      await person.locator('[name=name]').fill('Sample Rider ' + (i + 1));
      await person.locator('[name=age]').fill('25');
      await person.locator('[name=gender]').selectOption('Other');
      await person.locator('[name=preference]').selectOption('Lower');
    }
    await page.locator('#traveller-form button').click();
    await step('payment');
    await page.reload();
    await step('payment');
    assert.ok(
      await page
        .locator('#pay-now')
        .innerText()
        .then((x) => x.includes('1680')),
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
    const pnrs = await page.locator('#group-tickets li').allTextContents();
    assert.equal(pnrs.length, 2);
    assert.notEqual(pnrs[0], pnrs[1]);
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
    await page.getByText('Sample Rider 2', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Change seat' }).click();
    await page.getByRole('button', { name: 'Save seat change' }).click();
    await page.getByText('Seat changed. Your PNR is the same.').waitFor();
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Cancel ticket' }).click();
    await page
      .locator('.saved-ticket-status')
      .filter({ hasText: 'Cancelled' })
      .waitFor();
    await page.goto(origin + '/jury/');
    await page.getByRole('heading', { name: 'What happens when the booking reply disappears?' }).waitFor();
    await page.locator('#recovery').click();
    const backendTrace = page.locator('#booking-trace');
    await backendTrace.getByRole('button', { name: 'Recover' }).click();
    await backendTrace.getByRole('heading', { name: 'Refresh and retrieve the same PNRs' }).waitFor();
    await page.locator('#delivery-trace').getByRole('button', { name: 'Staging' }).click();
    await page.getByRole('heading', { name: 'Repeat checkout against the container' }).waitFor();
    await page.getByText('Ready ·', { exact: false }).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'jury overflow ' + width);
    assert.deepEqual(errors, []);
    console.log(
      width + 'px checkout, reload, ticket changes, cancellation and jury walkthrough passed',
    );
    await ctx.close();
  }
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await database?.pool.end();
}

