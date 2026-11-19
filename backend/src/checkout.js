import { randomUUID } from 'node:crypto';
import QRCode from 'qrcode';
import { seatClass } from '../../frontend/js/classes.js';
import { BookingError } from './services/booking.js';

export function mountCheckout(app, pool, requirePassenger, service) {
  app.post('/api/checkout', requirePassenger, async (req, res) => {
    const { holdToken, travellers: submitted } = req.body || {};
    const { rows: holds } = await pool.query(
      'SELECT * FROM seat_holds WHERE hold_token=$1 AND user_id=$2 ORDER BY seat_no',
      [holdToken, req.passenger.id]
    );
    if (!holds.length || holds.some(hold => new Date(hold.expires_at) <= new Date())) {
      throw new BookingError(410, 'Select available seats to start a new hold.');
    }

    const details = submitted ?? [req.body];
    if (!Array.isArray(details) || details.length !== holds.length) {
      throw new BookingError(400, 'Enter traveller details for every reserved seat.');
    }
    const travellers = details.map((entry, index) => {
      const { name, age, gender, preference } = entry || {};
      if (typeof name !== 'string' || !name.trim() || name.trim().length > 80 ||
          !Number.isInteger(age) || age < 1 || age > 120 ||
          !['Female', 'Male', 'Other', 'Prefer not to say'].includes(gender) ||
          !['No preference', 'Lower', 'Middle', 'Upper', 'Side lower', 'Side upper'].includes(preference)) {
        throw new BookingError(400, 'Check the details for traveller ' + (index + 1) + '.');
      }
      return { seatNo: holds[index].seat_no, name: name.trim(), age, gender, preference };
    });
    const hold = holds[0];
    const cabin = seatClass(hold.seat_no);
    const first = travellers[0];
    await pool.query(
      'INSERT INTO checkout_orders (id,hold_token,user_id,train_id,seat_no,travel_class,fare,traveller,age,gender,preference,expires_at,travellers) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (hold_token) DO NOTHING',
      [randomUUID(), holdToken, req.passenger.id, hold.train_id, hold.seat_no, cabin.code,
        cabin.fare * travellers.length, first.name, first.age, first.gender, first.preference, hold.expires_at,
        JSON.stringify(travellers)]
    );
    const {
      rows: [order],
    } = await pool.query(
      'SELECT id FROM checkout_orders WHERE hold_token=$1 AND user_id=$2',
      [holdToken, req.passenger.id],
    );
    res.json({ id: order.id });
  });
  async function orderFor(req) {
    const {
      rows: [order],
    } = await pool.query('SELECT * FROM checkout_orders WHERE id=$1', [
      req.params.id,
    ]);
    if (!order) throw new BookingError(404, 'Checkout not found.');
    return order;
  }
  app.get('/api/checkout/:id', async (req, res) => {
    const o = await orderFor(req);
    res.json({
      fare: o.fare,
      seatCount: o.travellers?.length ?? 1,
      travelClass: o.travel_class,
      expiresAt: o.expires_at,
      paid: Boolean(o.payment_ref),
    });
  });
  app.get('/api/checkout/:id/qr', async (req, res) => {
    await orderFor(req);
    const url = new URL(
      '/wallet.html',
      process.env.PUBLIC_ORIGIN || req.protocol + '://' + req.get('host'),
    );
    url.hash = req.params.id;
    res
      .type('png')
      .send(await QRCode.toBuffer(url.href, { width: 256, margin: 4 }));
  });
  app.post('/api/checkout/:id/demo-pay', async (req, res) => {
    const o = await orderFor(req);
    await service.confirmBooking({
      trainId: o.train_id,
      seatNo: o.seat_no,
      userId: o.user_id,
      holdToken: o.hold_token,
      checkoutId: o.id,
    });
    res.json({ paid: true });
  });
}
