import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { BookingError } from './booking.js';

const deriveKey = promisify(scrypt);
const cookieName = 'tatkal_session';
const lifetime = 12 * 60 * 60 * 1000;
const digest = token => createHash('sha256').update(token).digest('hex');

export function mountPassengers(app, pool, { secureCookies = false } = {}) {
  const cookieOptions = { httpOnly: true, sameSite: 'strict', secure: secureCookies, path: '/' };
  const attempts = new Map();
  let resetAt = 0;

  function limitAttempts(req, _res, next) {
    const now = Date.now();
    if (now >= resetAt) {
      attempts.clear();
      resetAt = now + 60_000;
    }
    const count = attempts.get(req.ip) || 0;
    if (count >= 15 || (!count && attempts.size >= 2000)) {
      throw new BookingError(429, 'Too many account attempts. Try again in a minute.');
    }
    attempts.set(req.ip, count + 1);
    next();
  }

  function sessionKey(req) {
    const token = req.headers.cookie?.match(/(?:^|;\s*)tatkal_session=([a-f0-9]{64})(?:;|$)/)?.[1];
    return token ? digest(token) : null;
  }

  async function passengerFor(req) {
    const key = sessionKey(req);
    if (!key) return null;
    const { rows } = await pool.query(
      'SELECT p.id, p.name, p.email FROM passenger_sessions s JOIN passengers p ON p.id = s.passenger_id WHERE s.session_key = $1 AND s.expires_at > $2',
      [key, new Date()]
    );
    return rows[0] ?? null;
  }

  async function requirePassenger(req, _res, next) {
    req.passenger = await passengerFor(req);
    if (!req.passenger) throw new BookingError(401, 'Sign in to continue with your booking.');
    next();
  }

  async function startSession(req, res, passenger, status) {
    await pool.query('DELETE FROM passenger_sessions WHERE expires_at <= $1 OR session_key = $2', [new Date(), sessionKey(req)]);
    const token = randomBytes(32).toString('hex');
    await pool.query('INSERT INTO passenger_sessions (session_key, passenger_id, expires_at) VALUES ($1,$2,$3)',
      [digest(token), passenger.id, new Date(Date.now() + lifetime)]);
    res.cookie(cookieName, token, { ...cookieOptions, maxAge: lifetime });
    res.status(status).json({ passenger: { id: passenger.id, name: passenger.name, email: passenger.email } });
  }

  function credentials(req) {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = req.body?.password;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 ||
        typeof password !== 'string' || password.length < 10 || password.length > 128) {
      throw new BookingError(400, 'Enter a valid email and a password of 10 to 128 characters.');
    }
    return { email, password };
  }

  app.get('/api/passenger', async (req, res) => res.json({ passenger: await passengerFor(req) }));
  app.post('/api/passenger/register', limitAttempts, async (req, res) => {
    const { email, password } = credentials(req);
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name || name.length > 80) throw new BookingError(400, 'Enter a name of up to 80 characters.');
    const salt = randomBytes(16).toString('hex');
    const key = (await deriveKey(password, salt, 64)).toString('hex');
    let passenger;
    try {
      const { rows } = await pool.query(
        'INSERT INTO passengers (id,name,email,salt,password_key) VALUES ($1,$2,$3,$4,$5) RETURNING id,name,email',
        [randomUUID(), name, email, salt, key]
      );
      passenger = rows[0];
    } catch (error) {
      if (error.code === '23505') throw new BookingError(409, 'An account already uses this email. Sign in to continue.');
      throw error;
    }
    await startSession(req, res, passenger, 201);
  });

  app.post('/api/passenger/login', limitAttempts, async (req, res) => {
    const { email, password } = credentials(req);
    const { rows: [passenger] } = await pool.query('SELECT * FROM passengers WHERE email = $1', [email]);
    const key = await deriveKey(password, passenger?.salt ?? '00000000000000000000000000000000', 64);
    if (!passenger || !timingSafeEqual(key, Buffer.from(passenger.password_key, 'hex'))) {
      throw new BookingError(401, 'Email or password is incorrect.');
    }
    await startSession(req, res, passenger, 200);
  });

  app.post('/api/passenger/logout', async (req, res) => {
    const key = sessionKey(req);
    if (key) await pool.query('DELETE FROM passenger_sessions WHERE session_key = $1', [key]);
    res.clearCookie(cookieName, cookieOptions).json({ passenger: null });
  });

  app.get('/api/passenger/tickets', requirePassenger, async (req, res) => {
    const { rows } = await pool.query(
      'SELECT o.traveller, o.travel_class, o.fare, o.preference, b.pnr, b.seat_no, b.status, b.train_id, t.name, t.source, t.destination, t.departure FROM bookings b LEFT JOIN checkout_orders o ON o.id=b.checkout_id JOIN trains t ON t.id = b.train_id WHERE b.user_id = $1 ORDER BY b.id DESC',
      [req.passenger.id]
    );
    res.json({ tickets: rows });
  });

  return requirePassenger;
}
