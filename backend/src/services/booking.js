// Keep booking rules separate from HTTP handlers so they are easy to explain.
import { seatClass } from '../../../frontend/js/classes.js';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

export class BookingError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function createBookingService(pool, { holdSeconds = 300, now = () => Date.now() } = {}) {
  async function transaction(work) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      // The unique constraint is a final safeguard against a duplicate seat.
      if (error.code === '23505') {
        throw new BookingError(409, 'This seat was just taken. Choose another.');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async function getTrain(client, trainId, lock = false) {
    const { rows } = await client.query(
      'SELECT * FROM trains WHERE id = $1' + (lock ? ' FOR UPDATE' : ''),
      [trainId]
    );
    if (!rows[0]) throw new BookingError(404, 'Train not found.');
    return rows[0];
  }

  function checkSeat(train, seatNo) {
    if (seatNo > train.total_seats) throw new BookingError(400, 'Seat is outside this coach.');
  }

  async function listTrains() {
    const { rows: trains } = await pool.query('SELECT * FROM trains ORDER BY id');
    const { rows: bookings } = await pool.query('SELECT train_id FROM bookings WHERE status = $1', ['CONFIRMED']);
    const { rows: holds } = await pool.query('SELECT train_id, expires_at FROM seat_holds');
    return trains.map(train => {
      const sold = bookings.filter(row => row.train_id === train.id).length;
      const held = holds.filter(row => row.train_id === train.id && new Date(row.expires_at).getTime() > now()).length;
      return { ...train, sold, held, available: train.total_seats - sold - held };
    });
  }

  async function listSeats(trainId) {
    const train = await getTrain(pool, trainId);
    const { rows: bookings } = await pool.query(
      'SELECT seat_no FROM bookings WHERE train_id = $1 AND status = $2', [trainId, 'CONFIRMED']
    );
    const { rows: holds } = await pool.query(
      'SELECT seat_no, expires_at FROM seat_holds WHERE train_id = $1', [trainId]
    );
    const sold = new Set(bookings.map(row => row.seat_no));
    const active = new Map(holds.filter(row => new Date(row.expires_at).getTime() > now())
      .map(row => [row.seat_no, row]));
    const seats = Array.from({ length: train.total_seats }, (_, index) => {
      const seatNo = index + 1;
      const hold = active.get(seatNo);
      return {
        seatNo,
        status: sold.has(seatNo) ? 'sold' : hold ? 'held' : 'free',
        expiresAt: hold && !sold.has(seatNo) ? hold.expires_at : null
      };
    });
    return { train, seats };
  }

  async function isSold(client, trainId, seatNo) {
    const { rows } = await client.query(
      "SELECT id FROM bookings WHERE train_id = $1 AND seat_no = $2 AND status = 'CONFIRMED'",
      [trainId, seatNo]
    );
    return rows.length > 0;
  }

  async function holdSeat({ trainId, seatNo, userId, checkoutRequired = false }) {
    return transaction(async client => {
      // A train row lock serializes Phase 1 writes in real PostgreSQL.
      // The in-memory emulator does not model PostgreSQL locking.
      const train = await getTrain(client, trainId, true);
      checkSeat(train, seatNo);
      if (await isSold(client, trainId, seatNo)) throw new BookingError(409, 'This seat is already sold.');
      const { rows: holds } = await client.query(
        'SELECT * FROM seat_holds WHERE train_id = $1 AND seat_no = $2', [trainId, seatNo]
      );
      const existing = holds[0];
      if (existing && new Date(existing.expires_at).getTime() > now()) {
        if (existing.user_id !== userId) {
          throw new BookingError(409, 'Someone else is holding this seat.');
        }
        // Retrying a hold reuses its token and original expiry.
        return { trainId, seatNo, holdToken: existing.hold_token, expiresAt: existing.expires_at };
      }
      const holdToken = randomUUID();
      const expiresAt = new Date(now() + holdSeconds * 1000);
      await client.query('DELETE FROM seat_holds WHERE train_id = $1 AND seat_no = $2', [trainId, seatNo]);
      await client.query(
        'INSERT INTO seat_holds (train_id, seat_no, user_id, hold_token, expires_at, checkout_required) VALUES ($1,$2,$3,$4,$5,$6)',
        [trainId, seatNo, userId, holdToken, expiresAt, checkoutRequired]
      );
      return { trainId, seatNo, holdToken, expiresAt };
    });
  }

  async function releaseHold({ trainId, seatNo, userId, holdToken }) {
    return transaction(async client => {
      await getTrain(client, trainId, true);
      const { rows: [order] } = await client.query(
        'SELECT payment_ref FROM checkout_orders WHERE hold_token=$1 AND user_id=$2', [holdToken, userId]
      );
      if (order?.payment_ref) throw new BookingError(409, 'Already paid. Retrieve your ticket.');
      await client.query(
        'DELETE FROM seat_holds WHERE train_id=$1 AND seat_no=$2 AND user_id=$3 AND hold_token=$4',
        [trainId, seatNo, userId, holdToken]
      );
      return { released: true };
    });
  }

  async function confirmBooking({ trainId, seatNo, userId, holdToken, checkoutId = null }) {
    return transaction(async client => {
      const train = await getTrain(client, trainId, true);
      checkSeat(train, seatNo);
      const confirmationKey = createHash('sha256').update(holdToken).digest('hex');
      const { rows: [previous] } = await client.query(
        'SELECT id, pnr, seat_no, status, user_id, train_id, created_at FROM bookings WHERE train_id = $1 AND user_id = $2 AND confirmation_key = $3',
        [trainId, userId, confirmationKey]
      );
      if (previous) return { booking: previous, train, recovered: true };
      if (await isSold(client, trainId, seatNo)) throw new BookingError(409, 'This seat is already sold.');
      const { rows: holds } = await client.query(
        'SELECT * FROM seat_holds WHERE train_id = $1 AND seat_no = $2', [trainId, seatNo]
      );
      const hold = holds[0];
      if (!hold || new Date(hold.expires_at).getTime() <= now()) {
        throw new BookingError(410, 'Your hold expired. Select an available seat again.');
      }
      if (hold.user_id !== userId || hold.hold_token !== holdToken) {
        throw new BookingError(403, 'This hold does not belong to your demo session.');
      }
      const { rows: [order] } = await client.query('SELECT id FROM checkout_orders WHERE hold_token=$1', [holdToken]);
      if ((hold.checkout_required && !checkoutId) || (order && order.id !== checkoutId)) throw new BookingError(409,'Finish the QR checkout first.');
      const pnr = 'TS-' + randomBytes(6).toString('hex').toUpperCase();
      const { rows } = await client.query(
        'INSERT INTO bookings (train_id, seat_no, user_id, pnr, status, confirmation_key, checkout_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, pnr, seat_no, status, user_id, train_id, created_at',
        [trainId, seatNo, userId, pnr, 'CONFIRMED', confirmationKey, checkoutId]
      );
      await client.query('DELETE FROM seat_holds WHERE train_id = $1 AND seat_no = $2', [trainId, seatNo]);
      if (checkoutId) await client.query('UPDATE checkout_orders SET payment_ref=$1 WHERE id=$2', [pnr,checkoutId]);
      return { booking: rows[0], train };
    });
  }

  async function manageTicket({ pnr, userId, seatNo, expectedSeat }) {
    return transaction(async client => {
      const lookup = 'SELECT pnr, train_id, seat_no, status, checkout_id FROM bookings WHERE pnr = $1 AND user_id = $2';
      const { rows: [owned] } = await client.query(lookup, [pnr, userId]);
      if (!owned) throw new BookingError(404, 'Ticket not found.');
      const train = await getTrain(client, owned.train_id, true);
      const { rows: [ticket] } = await client.query(lookup, [pnr, userId]);
      if (seatNo === undefined) {
        if (ticket.status === 'CONFIRMED') {
          await client.query("UPDATE bookings SET status = 'CANCELLED' WHERE pnr = $1", [pnr]);
        }
        return { ...ticket, status: 'CANCELLED' };
      }

      if (ticket.status !== 'CONFIRMED') throw new BookingError(409, 'This ticket is cancelled.');
      checkSeat(train, seatNo);
      if (ticket.checkout_id && seatClass(seatNo).code !== seatClass(ticket.seat_no).code) throw new BookingError(400,'Choose a seat in the booked class.');
      if (ticket.seat_no === seatNo) return ticket;
      if (ticket.seat_no !== expectedSeat) throw new BookingError(409, 'The seat has changed. Reload your tickets and try again.');
      if (await isSold(client, train.id, seatNo)) throw new BookingError(409, 'This seat is already sold.');
      const { rows: [hold] } = await client.query(
        'SELECT expires_at FROM seat_holds WHERE train_id = $1 AND seat_no = $2', [train.id, seatNo]
      );
      if (hold && new Date(hold.expires_at).getTime() > now()) {
        throw new BookingError(409, 'This seat is currently held. Choose another.');
      }
      await client.query('UPDATE bookings SET seat_no = $1 WHERE pnr = $2', [seatNo, pnr]);
      return { ...ticket, seat_no: seatNo };
    });
  }

  return { listTrains, listSeats, holdSeat, releaseHold, confirmBooking, manageTicket };
}
