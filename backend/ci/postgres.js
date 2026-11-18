import assert from 'node:assert/strict';
import { createDatabase } from '../src/db.js';
import { createBookingService } from '../src/services/booking.js';

if (!process.env.CI_DATABASE_URL) throw Error('Set CI_DATABASE_URL to an isolated PostgreSQL test database.');
const db = await createDatabase({connectionString: process.env.CI_DATABASE_URL});
try {
  const service = createBookingService(db.pool);
  const contenders = ['ci-passenger-a', 'ci-passenger-b'];
  const attempts = await Promise.allSettled(contenders.map(userId =>
    service.holdSeat({trainId: 1, seatNo: 1, userId})));
  const winners = attempts.filter(result => result.status === 'fulfilled');
  const conflicts = attempts.filter(result => result.status === 'rejected');
  assert.equal(winners.length, 1);
  assert.equal(conflicts[0].reason.status, 409);
  const userId = contenders[attempts.indexOf(winners[0])];
  const confirmation = { ...winners[0].value, userId };
  const original = await service.confirmBooking(confirmation);
  const retry = await service.confirmBooking(confirmation);
  assert.equal(retry.booking.pnr, original.booking.pnr);
  assert.equal(retry.recovered, true);
  const { pnr } = original.booking;
  const changed = await service.manageTicket({ pnr, userId, seatNo: 2, expectedSeat: 1 });
  assert.equal(changed.seat_no, 2);
  assert.equal((await service.manageTicket({ pnr, userId })).status, 'CANCELLED');
  const replacement = await service.holdSeat({ trainId: 1, seatNo: 2, userId });
  const rebooked = await service.confirmBooking({ ...replacement, userId });
  assert.notEqual(rebooked.booking.pnr, pnr);
  console.log('PostgreSQL verified seat contention, PNR recovery, seat changes and rebooking after cancellation.');
} finally {
  await db.pool.end();
}
