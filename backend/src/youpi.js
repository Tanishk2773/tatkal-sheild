import { BookingError } from './services/booking.js';

export function mountYoupi(app, pool, requirePassenger) {
  const { YOUPI_SANDBOX_API_URL, YOUPI_SANDBOX_CHECKOUT_ORIGIN, YOUPI_SANDBOX_MERCHANT_ID, YOUPI_SANDBOX_MERCHANT_KEY } = process.env;
  const enabled = Boolean(YOUPI_SANDBOX_API_URL && YOUPI_SANDBOX_CHECKOUT_ORIGIN && YOUPI_SANDBOX_MERCHANT_ID && YOUPI_SANDBOX_MERCHANT_KEY);

  app.get('/api/youpi/status', (_req, res) => res.json({ enabled }));

  app.post('/api/checkout/:id/youpi', requirePassenger, async (req, res) => {
    if (!enabled) throw new BookingError(503, 'The YouPI sandbox is unavailable.');
    const { rows: [order] } = await pool.query(
      'SELECT id, fare, expires_at, payment_ref FROM checkout_orders WHERE id=$1 AND user_id=$2',
      [req.params.id, req.passenger.id]
    );
    if (!order) throw new BookingError(404, 'Checkout not found.');
    if (order.payment_ref || new Date(order.expires_at) <= new Date()) {
      throw new BookingError(409, 'Select an unpaid checkout with an active seat hold.');
    }

    try {
      const response = await fetch(new URL('/api/v1/payments', YOUPI_SANDBOX_API_URL), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Merchant-Id': YOUPI_SANDBOX_MERCHANT_ID,
          'X-Merchant-Key': YOUPI_SANDBOX_MERCHANT_KEY,
          'Idempotency-Key': order.id
        },
        body: JSON.stringify({ orderId: order.id, amount: order.fare, currency: 'INR', method: 'MANUAL_UPI' }),
        redirect: 'error',
        signal: AbortSignal.timeout(8000)
      });
      if (!response.ok) throw new Error('Checkout could not be created');
      const payload = await response.json();
      if (typeof payload.checkoutUrl !== 'string') throw new Error('Missing checkout URL');
      const checkout = new URL(payload.checkoutUrl);
      if (!['http:', 'https:'].includes(checkout.protocol) || checkout.origin !== new URL(YOUPI_SANDBOX_CHECKOUT_ORIGIN).origin) throw new Error('Unexpected checkout origin');
      res.json({ checkoutUrl: checkout.href });
    } catch {
      throw new BookingError(502, 'YouPI could not open the sandbox checkout. Try again.');
    }
  });
}
