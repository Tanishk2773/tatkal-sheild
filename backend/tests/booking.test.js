// Exercise real HTTP routes and SQL queries with a fresh demo DB per test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { createDatabase } from '../src/db.js';

async function setup(t, options) {
  const database = await createDatabase();
  const server = createApp(database, options).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  t.after(async () => {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeIdleConnections();
    });
    await database.pool.end();
  });
  async function send(path, body, cookie) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (cookie) headers.Cookie = cookie;
    const response = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  const sessions = new Map();
  return {
    database,
    send,
    async request(path, body) {
      if (body?.userId && !sessions.has(body.userId)) {
        const account = await send('/api/passenger/register', {
          name: body.userId, email: body.userId + '@example.test', password: 'test-password-123'
        });
        assert.equal(account.status, 201);
        sessions.set(body.userId, account.cookie);
      }
      return send(path, body, sessions.get(body?.userId));
    },
    async page(path) { return fetch(base + path); }
  };
}

test('acceptance: list trains → hold → confirm → seat is sold', async t => {
  const { request, page } = await setup(t);
  assert.equal((await page('/')).status, 200);
  assert.equal((await page('/js/app.js')).status, 200);
  const health = await request('/api/health');
  assert.equal(health.body.storage, 'demo-memory');
  const trains = await request('/api/trains');
  assert.equal(trains.body.trains.length, 3);
  assert.equal(trains.body.trains[0].available, 36);
  const payload = { trainId: 1, seatNo: 1, userId: 'demo-alice' };
  const hold = await request('/api/seats/hold', payload);
  assert.equal(hold.status, 201);
  assert.ok(hold.body.holdToken);
  let seats = await request('/api/trains/1/seats');
  assert.equal(seats.body.seats[0].status, 'held');
  const confirmation = await request('/api/bookings/confirm', { ...payload, holdToken: hold.body.holdToken });
  assert.equal(confirmation.status, 201);
  assert.equal(confirmation.body.booking.status, 'CONFIRMED');
  assert.match(confirmation.body.booking.pnr, /^TS-[A-F0-9]{12}$/);
  seats = await request('/api/trains/1/seats');
  assert.equal(seats.body.seats[0].status, 'sold');
  assert.equal((await request('/api/trains')).body.trains[0].available, 35);
});

test('another session cannot hold or confirm someone else’s seat', async t => {
  const { request } = await setup(t);
  const payload = { trainId: 1, seatNo: 2, userId: 'demo-alice' };
  const hold = await request('/api/seats/hold', payload);
  const rival = await request('/api/seats/hold', { ...payload, userId: 'demo-bob' });
  assert.equal(rival.status, 409);
  const stolen = await request('/api/bookings/confirm', { ...payload, userId: 'demo-bob', holdToken: hold.body.holdToken });
  assert.equal(stolen.status, 403);
  const forged = await request('/api/bookings/confirm', { ...payload, holdToken: 'wrong-token' });
  assert.equal(forged.status, 403);
  assert.equal((await request('/api/bookings/confirm', { ...payload, holdToken: hold.body.holdToken })).status, 201);
});

test('hold retries reuse the token; sold seats cannot be booked twice', async t => {
  const { request, database } = await setup(t);
  const payload = { trainId: 2, seatNo: 3, userId: 'demo-alice' };
  const first = await request('/api/seats/hold', payload);
  const retry = await request('/api/seats/hold', payload);
  assert.equal(first.body.holdToken, retry.body.holdToken);
  assert.equal(first.body.expiresAt, retry.body.expiresAt);
  const confirmation = { ...payload, holdToken: first.body.holdToken };
  const firstReceipt = await request('/api/bookings/confirm', confirmation);
  assert.equal(firstReceipt.status, 201);
  const recovered = await request('/api/bookings/confirm', confirmation);
  assert.equal(recovered.status, 200);
  assert.equal(recovered.body.recovered, true);
  assert.deepEqual(recovered.body.booking, firstReceipt.body.booking);
  for (const override of [{ holdToken: 'incorrect' }, { userId: 'demo-bob' }]) {
    assert.equal((await request('/api/bookings/confirm', { ...confirmation, ...override })).status, 409);
  }
  assert.equal((await request('/api/seats/hold', { ...payload, userId: 'demo-bob' })).status, 409);
  const { rows } = await database.pool.query('SELECT * FROM bookings WHERE train_id = $1 AND seat_no = $2', [2, 3]);
  assert.equal(rows.length, 1);
  await assert.rejects(database.pool.query(
    'INSERT INTO bookings (train_id,seat_no,user_id,pnr,status) VALUES ($1,$2,$3,$4,$5)',
    [2, 3, 'demo-bob', 'DUPLICATE-SEAT', 'CONFIRMED']
  ), error => error.code === '23505');
});

test('expired holds become available and cannot be confirmed with their old token', async t => {
  let clock = Date.now();
  const { request } = await setup(t, { now: () => clock });
  const payload = { trainId: 1, seatNo: 4, userId: 'demo-alice' };
  const hold = await request('/api/seats/hold', payload);
  clock += 301000;
  assert.equal((await request('/api/trains/1/seats')).body.seats[3].status, 'free');
  assert.equal((await request('/api/bookings/confirm', { ...payload, holdToken: hold.body.holdToken })).status, 410);
  assert.equal((await request('/api/seats/hold', { ...payload, userId: 'demo-bob' })).status, 201);
});

test('invalid input is rejected before writing; unknown routes return JSON', async t => {
  const { request } = await setup(t);
  for (const seatNo of [0, -1, 37, 1.5, '1']) {
    assert.equal((await request('/api/seats/hold', { trainId: 1, seatNo, userId: 'demo-alice' })).status, 400);
  }
  assert.equal((await request('/api/seats/hold', { trainId: 1, seatNo: 1, userId: '' })).status, 401);
  assert.equal((await request('/api/seats/hold', null)).status, 400);
  assert.equal((await request('/api/seats/hold')).status, 404);
  assert.equal((await request('/api/trains/999/seats')).status, 404);
  assert.equal((await request('/api/trains/1abc/seats')).status, 400);
  assert.equal((await request('/api/missing')).status, 404);
  assert.equal((await request('/api/trains')).body.trains[0].available, 36);
});


test('passenger sessions authenticate bookings and isolate ticket history', async t => {
  const { send } = await setup(t);
  const payload = { trainId: 1, seatNo: 5 };
  assert.equal((await send('/api/seats/hold', payload)).status, 401);
  const credentials = { name: 'Passenger One', email: 'one@example.test', password: 'test-password-456' };
  const account = await send('/api/passenger/register', credentials);
  assert.equal(account.status, 201);
  assert.equal((await send('/api/passenger/login', { ...credentials, password: 'wrong-password' })).status, 401);
  const other = await send('/api/passenger/register', { ...credentials, email: 'other@example.test' });
  const hold = await send('/api/seats/hold', { ...payload, userId: other.body.passenger.id }, account.cookie);
  assert.equal(hold.status, 201);
  assert.equal((await send('/api/bookings/confirm', hold.body, other.cookie)).status, 403);
  const confirmed = await send('/api/bookings/confirm', hold.body, account.cookie);
  assert.equal(confirmed.status, 201);
  assert.equal((await send('/api/passenger/tickets', undefined, other.cookie)).body.tickets.length, 0);
  assert.equal((await send('/api/passenger/logout', {}, account.cookie)).status, 200);
  assert.equal((await send('/api/passenger/tickets', undefined, account.cookie)).status, 401);
  const login = await send('/api/passenger/login', credentials);
  assert.equal(login.status, 200);
  assert.equal((await send('/api/passenger/tickets', undefined, login.cookie)).body.tickets[0].pnr, confirmed.body.booking.pnr);
});

test('passenger can change and cancel their own ticket and free inventory', async t => {
  const { send } = await setup(t);
  const register = email => send('/api/passenger/register', {
    name: 'Test Passenger', email, password: 'test-password-456'
  });
  const owner = await register('owner@example.test');
  const other = await register('other@example.test');
  const hold = await send('/api/seats/hold', { trainId: 1, seatNo: 6 }, owner.cookie);
  const booking = await send('/api/bookings/confirm', hold.body, owner.cookie);
  assert.equal(booking.status, 201);
  const { pnr } = booking.body.booking;
  const root = '/api/bookings/' + pnr;
  assert.equal((await send(root + '/cancel', {}, other.cookie)).status, 404);
  const competing = await send('/api/seats/hold', { trainId: 1, seatNo: 8 }, other.cookie);
  assert.equal(competing.status, 201);
  assert.equal((await send(root + '/change-seat', { seatNo: 8, expectedSeat: 6 }, owner.cookie)).status, 409);
  const change = await send(root + '/change-seat', { seatNo: 7, expectedSeat: 6 }, owner.cookie);
  assert.equal(change.status, 200);
  assert.equal(change.body.ticket.pnr, pnr);
  assert.equal(change.body.ticket.seat_no, 7);
  assert.equal((await send(root + '/change-seat', { seatNo: 9, expectedSeat: 6 }, owner.cookie)).status, 409);
  const seats = await send('/api/trains/1/seats');
  assert.equal(seats.body.seats[5].status, 'free');
  assert.equal(seats.body.seats[6].status, 'sold');
  const retry = await send('/api/bookings/confirm', hold.body, owner.cookie);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.booking.seat_no, 7);
  assert.equal((await send(root + '/cancel', {}, owner.cookie)).body.ticket.status, 'CANCELLED');
  assert.equal((await send(root + '/cancel', {}, owner.cookie)).status, 200);
  const newHold = await send('/api/seats/hold', { trainId: 1, seatNo: 7 }, other.cookie);
  assert.equal(newHold.status, 201);
  assert.equal((await send('/api/bookings/confirm', newHold.body, other.cookie)).status, 201);
  const history = await send('/api/passenger/tickets', undefined, owner.cookie);
  assert.equal(history.body.tickets[0].status, 'CANCELLED');
});
