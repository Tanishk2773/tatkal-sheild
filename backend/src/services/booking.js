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

  async function holdSeat({ trainId, seatNo, seatNos = [seatNo], userId, checkoutRequired = false, classCode, preferences }) {
    const automatic = preferences !== undefined;
    if (automatic && (!Array.isArray(preferences) || preferences.length < 1 || preferences.length > 6 ||
        preferences.some(value => !['No preference', 'Lower', 'Middle', 'Upper', 'Side lower', 'Side upper'].includes(value)))) {
      throw new BookingError(400, 'Enter valid berth preferences for one to six passengers.');
    }
    if (!automatic && (!Array.isArray(seatNos) || seatNos.length < 1 || seatNos.length > 6 ||
        seatNos.some(seat => !Number.isSafeInteger(seat) || seat < 1) ||
        new Set(seatNos).size !== seatNos.length)) {
      throw new BookingError(400, 'Choose one to six different seats.');
    }
    const selected = automatic ? [] : [...seatNos].sort((a, b) => a - b);
    if (selected.some(seat => seatClass(seat) !== seatClass(selected[0]))) {
      throw new BookingError(400, 'Choose seats in the same class.');
    }

    return transaction(async client => {
      const train = await getTrain(client, trainId, true);
      if (automatic) {
        const { rows: sold } = await client.query(
          "SELECT seat_no FROM bookings WHERE train_id=$1 AND status='CONFIRMED'", [trainId]
        );
        const { rows: holds } = await client.query('SELECT seat_no, expires_at FROM seat_holds WHERE train_id=$1', [trainId]);
        const occupied = new Set([...sold, ...holds.filter(hold => new Date(hold.expires_at).getTime() > now())].map(row => row.seat_no));
        const free = Array.from({ length: train.total_seats }, (_, i) => i + 1)
          .filter(seat => seatClass(seat).code === classCode && !occupied.has(seat));
        if (free.length < preferences.length) throw new BookingError(409, 'There are too few available berths in this class.');
        const layout = ['2A', '1A'].includes(classCode)
          ? (classCode === '1A' ? ['Lower', 'Upper'] : ['Lower', 'Upper', 'Lower', 'Upper', 'Side lower', 'Side upper'])
          : ['Lower', 'Middle', 'Upper', 'Lower', 'Middle', 'Upper', 'Side lower', 'Side upper'];
        const first = Array.from({ length: train.total_seats }, (_, i) => i + 1).find(seat => seatClass(seat).code === classCode);
        preferences.forEach((preference, index) => {
          const match = free.findIndex(seat => layout[(seat - first) % layout.length] === preference);
          if (match >= 0) selected[index] = free.splice(match, 1)[0];
        });
        preferences.forEach((_, index) => {
          if (!selected[index]) selected[index] = free.shift();
        });
      }
      const active = [];
      for (const seat of selected) {
        checkSeat(train, seat);
        if (await isSold(client, trainId, seat)) throw new BookingError(409, 'Seat ' + seat + ' is already sold.');
        const { rows: [hold] } = await client.query(
          'SELECT * FROM seat_holds WHERE train_id=$1 AND seat_no=$2', [trainId, seat]
        );
        if (hold && new Date(hold.expires_at).getTime() > now()) active.push(hold);
      }

      let holdToken = randomUUID();
      let expiresAt = new Date(now() + holdSeconds * 1000);
      if (active.length) {
        const first = active[0];
        const { rows: group } = await client.query(
          'SELECT seat_no FROM seat_holds WHERE hold_token=$1', [first.hold_token]
        );
        if (group.length !== selected.length || active.length !== selected.length ||
            active.some(hold => hold.user_id !== userId || hold.hold_token !== first.hold_token)) {
          throw new BookingError(409, 'At least one selected seat is already held. Review your selection.');
        }
        holdToken = first.hold_token;
        expiresAt = first.expires_at;
      } else {
        for (const seat of selected) {
          await client.query('DELETE FROM seat_holds WHERE train_id=$1 AND seat_no=$2', [trainId, seat]);
          await client.query(
            'INSERT INTO seat_holds (train_id, seat_no, user_id, hold_token, expires_at, checkout_required) VALUES ($1,$2,$3,$4,$5,$6)',
            [trainId, seat, userId, holdToken, expiresAt, checkoutRequired || selected.length > 1]
          );
        }
      }
      return { trainId, seatNo: selected[0], seatNos: selected, holdToken, expiresAt };
    });
  }

  async function releaseHold({ trainId, userId, holdToken }) {
    return transaction(async client => {
      await getTrain(client, trainId, true);
      const { rows: [order] } = await client.query(
        'SELECT payment_ref FROM checkout_orders WHERE hold_token=$1 AND user_id=$2', [holdToken, userId]
      );
      if (order?.payment_ref) throw new BookingError(409, 'Already paid. Retrieve your ticket.');
      await client.query(
        'DELETE FROM seat_holds WHERE train_id=$1 AND user_id=$2 AND hold_token=$3',
        [trainId, userId, holdToken]
      );
      return { released: true };
    });
  }

  async function confirmBooking({ trainId, seatNo, userId, holdToken, checkoutId = null }) {
    return transaction(async client => {
      const train = await getTrain(client, trainId, true);
      checkSeat(train, seatNo);
      const confirmationKey = createHash('sha256').update(holdToken).digest('hex');
      const { rows: previous } = await client.query(
        'SELECT id, pnr, seat_no, status, user_id, train_id, created_at FROM bookings WHERE train_id=$1 AND user_id=$2 AND confirmation_key=$3 ORDER BY id',
        [trainId, userId, confirmationKey]
      );
      if (previous.length) return { booking: previous[0], bookings: previous, train, recovered: true };

      const { rows: holds } = await client.query(
        'SELECT * FROM seat_holds WHERE train_id=$1 AND hold_token=$2 ORDER BY seat_no', [trainId, holdToken]
      );
      if (!holds.length) {
        if (await isSold(client, trainId, seatNo)) throw new BookingError(409, 'This seat is already sold.');
        const { rows: [other] } = await client.query(
          'SELECT expires_at FROM seat_holds WHERE train_id=$1 AND seat_no=$2', [trainId, seatNo]
        );
        if (other && new Date(other.expires_at).getTime() > now()) {
          throw new BookingError(403, 'This hold does not belong to your demo session.');
        }
        throw new BookingError(410, 'Your hold expired. Select available seats again.');
      }
      if (holds.some(hold => hold.user_id !== userId) || !holds.some(hold => hold.seat_no === seatNo)) {
        throw new BookingError(403, 'This hold does not belong to your demo session.');
      }
      if (holds.some(hold => new Date(hold.expires_at).getTime() <= now())) {
        throw new BookingError(410, 'Your hold expired. Select available seats again.');
      }
      const { rows: [order] } = await client.query('SELECT id, travellers FROM checkout_orders WHERE hold_token=$1', [holdToken]);
      if ((holds[0].checkout_required || order || checkoutId) && (!checkoutId || order?.id !== checkoutId)) {
        throw new BookingError(409, 'Finish the QR checkout first.');
      }
      if (order?.travellers && (order.travellers.length !== holds.length ||
          order.travellers.some((traveller, index) => traveller.seatNo !== holds[index].seat_no))) {
        throw new BookingError(410, 'The seat selection has expired.');
      }

      // Validate the whole group before writing any booking rows.
      for (const hold of holds) {
        if (await isSold(client, trainId, hold.seat_no)) throw new BookingError(409, 'A selected seat is already sold.');
      }
      const bookings = [];
      for (const [index, hold] of holds.entries()) {
        const pnr = 'TS-' + randomBytes(6).toString('hex').toUpperCase();
        const traveller = order?.travellers?.[index];
        const { rows: [booking] } = await client.query(
          'INSERT INTO bookings (train_id, seat_no, user_id, pnr, status, confirmation_key, checkout_id, traveller, preference) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, pnr, seat_no, status, user_id, train_id, created_at',
          [trainId, hold.seat_no, userId, pnr, 'CONFIRMED', confirmationKey, checkoutId, traveller?.name ?? null, traveller?.preference ?? null]
        );
        await client.query(
          'INSERT INTO booking_outbox (event_id, event_type, payload) VALUES ($1,$2,$3)',
          [pnr, 'booking.confirmed', JSON.stringify({ pnr, trainId, seatNo: hold.seat_no })]
        );
        bookings.push(booking);
      }
      await client.query('DELETE FROM seat_holds WHERE train_id=$1 AND hold_token=$2', [trainId, holdToken]);
      if (checkoutId) await client.query('UPDATE checkout_orders SET payment_ref=$1 WHERE id=$2', [bookings[0].pnr, checkoutId]);
      return { booking: bookings[0], bookings, train };
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
