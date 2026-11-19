import assert from 'node:assert/strict';
import { createDatabase } from '../src/db.js';
import { createBookingService } from '../src/services/booking.js';
import { performance } from 'node:perf_hooks';

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
  const groupRequests = [
    { trainId: 1, userId: 'ci-group-a', seatNos: [13, 14] },
    { trainId: 1, userId: 'ci-group-b', seatNos: [14, 15] }
  ];
  const groups = await Promise.allSettled(groupRequests.map(request => service.holdSeat(request)));
  const loser = groups.findIndex(result => result.status === 'rejected');
  assert.ok(loser >= 0);
  assert.equal(groups[loser].reason.status, 409);
  const winner = groups[1 - loser];
  assert.equal(winner.status, 'fulfilled');
  const loserOnlySeat = loser === 0 ? 13 : 15;
  const { seats } = await service.listSeats(1);
  assert.equal(seats.find(seat => seat.seatNo === loserOnlySeat).status, 'free');
  await service.releaseHold({ ...winner.value, userId: groupRequests[1 - loser].userId });
  const event = await db.pool.query('SELECT payload FROM booking_outbox WHERE event_id=$1', [pnr]);
  assert.equal(event.rowCount, 1);
  assert.equal(event.rows[0].payload.pnr, pnr);
  const start = performance.now();
  const burst = await Promise.allSettled(Array.from({ length: 20 }, (_, index) =>
    service.holdSeat({ trainId: 9, classCode: '2A', preferences: ['Side lower', 'Lower'], userId: 'surge-' + index })
  ));
  const successful = burst.flatMap(result => result.status === 'fulfilled' ? result.value.seatNos : []);
  assert.equal(successful.length, 6);
  assert.equal(new Set(successful).size, 6);
  assert.equal(burst.filter(result => result.status === 'rejected' && result.reason.status === 409).length, 17);
  assert.ok(performance.now() - start < 5000, 'Concurrent allocation exceeded the staging time budget');
  console.log('PostgreSQL burst: twenty groups competed for six berths with no partial allocations or duplicates.');
  console.log('PostgreSQL rejected one overlapping group hold and left its non-overlapping seat free.');
  console.log('PostgreSQL verified seat contention, PNR recovery, seat changes and rebooking after cancellation.');
} finally {
  await db.pool.end();
}
