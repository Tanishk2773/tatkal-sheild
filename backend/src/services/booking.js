// Keep booking rules separate from HTTP handlers so they are easy to explain.
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

  async function holdSeat({ trainId, seatNo, userId }) {
    return transaction(async client => {
      // A train row lock serializes Phase 1 writes in real PostgreSQL.
      // The in-memory emulator does not model PostgreSQL locking.
      const train = await getTrain(client, trainId, true);
      checkSeat(train, seatNo);
      const { rows: sold } = await client.query(
        'SELECT id FROM bookings WHERE train_id = $1 AND seat_no = $2', [trainId, seatNo]
      );
      if (sold.length) throw new BookingError(409, 'This seat is already sold.');
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
        'INSERT INTO seat_holds (train_id, seat_no, user_id, hold_token, expires_at) VALUES ($1,$2,$3,$4,$5)',
        [trainId, seatNo, userId, holdToken, expiresAt]
      );
      return { trainId, seatNo, holdToken, expiresAt };
    });
  }

  async function confirmBooking({ trainId, seatNo, userId, holdToken }) {
    return transaction(async client => {
      const train = await getTrain(client, trainId, true);
      checkSeat(train, seatNo);
      const confirmationKey = createHash('sha256').update(holdToken).digest('hex');
      const { rows: bookings } = await client.query(
        'SELECT id, pnr, seat_no, status, user_id, train_id, created_at, confirmation_key FROM bookings WHERE train_id = $1 AND seat_no = $2', [trainId, seatNo]
      );
      if (bookings.length) {
        const previous = bookings[0];
        if (previous.user_id === userId && previous.confirmation_key === confirmationKey) {
          const { confirmation_key, ...booking } = previous;
          return { booking, train, recovered: true };
        }
        throw new BookingError(409, 'This seat is already sold.');
      }
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
      const pnr = 'TS-' + randomBytes(6).toString('hex').toUpperCase();
      const { rows } = await client.query(
        'INSERT INTO bookings (train_id, seat_no, user_id, pnr, status, confirmation_key) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, pnr, seat_no, status, user_id, train_id, created_at',
        [trainId, seatNo, userId, pnr, 'CONFIRMED', confirmationKey]
      );
      await client.query('DELETE FROM seat_holds WHERE train_id = $1 AND seat_no = $2', [trainId, seatNo]);
      return { booking: rows[0], train };
    });
  }

  return { listTrains, listSeats, holdSeat, confirmBooking };
}
