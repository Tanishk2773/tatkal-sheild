-- Phase 1 schema. PostgreSQL is the source of truth for confirmed seats.
CREATE TABLE IF NOT EXISTS trains (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  source TEXT NOT NULL,
  destination TEXT NOT NULL,
  departure TIMESTAMPTZ NOT NULL,
  total_seats INTEGER NOT NULL CHECK (total_seats > 0)
);

CREATE TABLE IF NOT EXISTS bookings (
  id SERIAL PRIMARY KEY,
  train_id INTEGER NOT NULL REFERENCES trains(id),
  seat_no INTEGER NOT NULL CHECK (seat_no > 0),
  user_id TEXT NOT NULL,
  pnr TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('CONFIRMED', 'CANCELLED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS confirmation_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS bookings_confirmed_seat
  ON bookings (train_id, seat_no) WHERE status = 'CONFIRMED';
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_train_id_seat_no_key;

-- Temporary SQL holds make Phase 1 runnable without Redis.
-- Redis atomic holds and their concurrency tests belong to Phase 3.
CREATE TABLE IF NOT EXISTS seat_holds (
  train_id INTEGER NOT NULL REFERENCES trains(id),
  seat_no INTEGER NOT NULL CHECK (seat_no > 0),
  user_id TEXT NOT NULL,
  hold_token TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (train_id, seat_no)
);

-- Reserved for the queued mock payment flow in a later phase.
CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  idempotency_key TEXT UNIQUE NOT NULL,
  booking_ref TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'SUCCESS', 'FAILED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS passengers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  salt TEXT NOT NULL,
  password_key TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS passenger_sessions (
  session_key TEXT PRIMARY KEY,
  passenger_id TEXT NOT NULL REFERENCES passengers(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);

ALTER TABLE seat_holds ADD COLUMN IF NOT EXISTS checkout_required BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS checkout_orders (
  id TEXT PRIMARY KEY,
  hold_token TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  train_id INTEGER NOT NULL REFERENCES trains(id),
  seat_no INTEGER NOT NULL,
  travel_class TEXT NOT NULL,
  fare INTEGER NOT NULL,
  traveller TEXT NOT NULL,
  age INTEGER NOT NULL,
  gender TEXT NOT NULL,
  preference TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  payment_ref TEXT UNIQUE
);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS checkout_id TEXT REFERENCES checkout_orders(id);
