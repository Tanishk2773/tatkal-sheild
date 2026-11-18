# Tatkal Shield

> We broke the booking rush on purpose, so it won't break you.

A self-contained **mock** train booking project. No real railway, payment, or personal data integration.

## Current milestone: Phase 1

Implemented from [TATKAL_SHIELD_BUILD_GUIDE.md](TATKAL_SHIELD_BUILD_GUIDE.md):

- Express API and a buildless HTML/CSS/JavaScript frontend.
- PostgreSQL schema and three seeded fake trains.
- Live seat availability, five-minute seat holds, mock confirmation, and a ticket PNR.
- A database unique constraint on each train/seat.
- HTTP integration checks covering the booking acceptance flow, ownership, expiry, and invalid input.

Redis, Docker, CI/CD, queues, Kubernetes, load tests, monitoring, chaos controls, and animation are later phases. This milestone does **not** demonstrate 10,000-user capacity.

## Run on this computer

Node.js 22 or newer is required. In PowerShell:

    cd "D:\tatkal shield"
    npm.cmd install
    npm.cmd start

Open **http://127.0.0.1:3000**. Stop with Ctrl+C. Dependencies are already installed if this project was just set up.

With no DATABASE_URL, the app uses **pg-mem**, an in-memory PostgreSQL emulator. The screen explicitly labels this mode. All demo bookings reset when the process stops. This mode needs no PostgreSQL or Docker installation and is intended for learning and the Phase 1 functional check.

For auto-restart while editing:

    npm.cmd run dev

## Acceptance check

1. Pick one of the three fake trains.
2. Select a green seat; it becomes amber and a five-minute hold timer appears.
3. Click **Confirm mock booking**.
4. Check the ticket PNR and see that the same seat is red (sold).
5. Refresh the page; the sold seat remains sold until the demo server restarts.
6. Open another tab to get a separate demo session and try an already held or sold seat.

A held seat is unavailable to others until confirmation or expiry. Reloading the original tab restores its hold. The UI keeps one active hold at a time; wait for expiry or confirm before switching trains.

Run automated checks:

    npm.cmd test
    npm.cmd run check

The tests run against fresh emulator databases. They do not prove PostgreSQL transaction locking or rush-load capacity. The 500-request Redis concurrency acceptance test belongs to Phase 3.

## Optional: persistent PostgreSQL

PostgreSQL is not bundled. Install it separately if you want persistence. Keep using demo mode if you are just trying the app.

1. Create an empty database named tatkal_shield using your PostgreSQL tools.
2. Copy .env.example to .env:

       Copy-Item .env.example .env

3. Uncomment and edit DATABASE_URL in .env with your local database credentials.
4. Restart with npm.cmd start.

The server creates tables and inserts only missing seed trains. It does not reset existing trains or bookings. An invalid DATABASE_URL fails startup; it never silently switches to memory storage. .env is ignored by Git.

Real PostgreSQL mutations use transactions and a train row lock. This simple Phase 1 approach favors clarity. Redis locking and distributed admission are planned later. The emulator does not implement real database locking or full rollback behavior, so use PostgreSQL for persistence and transaction validation.

## Structure

    frontend/
      index.html                Booking page and mock ticket
      css/styles.css            Responsive night-railway styling
      js/app.js                 API calls, seat grid, hold timer
    backend/
      sql/schema.sql            Trains, holds, bookings, payments
      src/server.js             Startup and graceful shutdown
      src/app.js                Routes and input validation
      src/db.js                 Storage selection and train seeding
      src/services/booking.js   Hold and confirmation rules
      tests/booking.test.js     HTTP and database integration tests

## API

All responses are JSON. IDs and seat numbers in request bodies must be positive integers.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | /api/health | Service and storage status |
| GET | /api/trains | Fake trains and availability counts |
| GET | /api/trains/:id/seats | Free, held, and sold seats |
| POST | /api/seats/hold | Hold a seat for 300 seconds |
| POST | /api/bookings/confirm | Confirm a valid hold |

Hold body:

    { "trainId": 1, "seatNo": 1, "userId": "demo-alice" }

Confirm body (use the holdToken returned above):

    { "trainId": 1, "seatNo": 1, "userId": "demo-alice", "holdToken": "returned-token" }

Responses use 201 for success, 400 for invalid input, 403 for a mismatched hold, 404 for a missing train, 409 for a taken seat, and 410 for an expired hold.

The userId is a demo session identifier, not authentication. Seat listings never expose hold tokens. The app binds to 127.0.0.1 by default for local use.

## Next milestone

Phase 2 in the guide: Docker, Compose, Nginx, Redis service setup, and CI/CD.
