// Express serves the API and the buildless frontend from one local origin.
import express from 'express';
import { mountPassengers } from './services/passengers.js';
import { fileURLToPath } from 'node:url';
import { BookingError, createBookingService } from './services/booking.js';

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) throw new BookingError(400, name + ' must be a positive integer.');
  return value;
}

function requiredText(value, name) {
  if (typeof value !== 'string' || !value.trim() || value.length > 100) {
    throw new BookingError(400, name + ' must be text between 1 and 100 characters.');
  }
  return value.trim();
}

function seatRequest(body, userId, confirm = false) {
  const request = {
    trainId: positiveInteger(body?.trainId, 'trainId'),
    seatNo: positiveInteger(body.seatNo, 'seatNo'),
    userId
  };
  if (confirm) request.holdToken = requiredText(body.holdToken, 'holdToken');
  return request;
}

export function createApp(database, options = {}) {
  const app = express();
  const service = createBookingService(database.pool, options);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '8kb' }));
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (_req.method === 'POST' && !_req.is('application/json')) {
      throw new BookingError(415, 'Send an application/json request.');
    }
    next();
  });
  const requirePassenger = mountPassengers(app, database.pool, options);

  app.get('/api/health', async (_req, res) => {
    await database.pool.query('SELECT 1');
    res.json({ status: 'ok', phase: 1, storage: database.mode });
  });
  app.get('/api/trains', async (_req, res) => res.json({ trains: await service.listTrains() }));
  app.get('/api/trains/:id/seats', async (req, res) => {
    if (!/^[1-9]\d*$/.test(req.params.id)) throw new BookingError(400, 'Invalid train ID.');
    res.json(await service.listSeats(positiveInteger(Number(req.params.id), 'trainId')));
  });
  app.post('/api/seats/hold', requirePassenger, async (req, res) => {
    res.status(201).json(await service.holdSeat(seatRequest(req.body, req.passenger.id)));
  });
  app.post('/api/bookings/confirm', requirePassenger, async (req, res) => {
    const result = await service.confirmBooking(seatRequest(req.body, req.passenger.id, true));
    res.status(result.recovered ? 200 : 201).json(result);
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint not found.' }));
  app.use(express.static(fileURLToPath(new URL('../../frontend/', import.meta.url))));
  app.use((error, _req, res, _next) => {
    if (error instanceof BookingError) return res.status(error.status).json({ error: error.message });
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Send a valid JSON body.' });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Request body is too large.' });
    console.error(error);
    res.status(500).json({ error: 'The booking service is unavailable. Please try again.' });
  });
  return app;
}
