import { lookups } from '../../frontend/js/rail-lookups.js';
import { BookingError } from './services/booking.js';

export function mountRailInfo(app) {
  let sdkPromise;
  function getSdk() {
    sdkPromise ??= import('railkit').then(sdk => {
      sdk.configure(process.env.RAILKIT_API_KEY);
      return sdk;
    });
    return sdkPromise;
  }

  app.get('/api/railkit/search', async (req, res) => {
    if (!process.env.RAILKIT_API_KEY) return res.json({ enabled: false });
    const { from, to } = req.query;
    if (![from, to].every(code => typeof code === 'string' && /^[A-Z0-9]{1,6}$/.test(code))) {
      throw new BookingError(400, 'Choose valid station codes.');
    }
    try {
      const sdk = await getSdk();
      const result = await sdk.searchTrainBetweenStations(from, to);
      if (result?.success === false) throw new Error('Upstream rejected the search');
      res.json({ enabled: true, result });
    } catch {
      throw new BookingError(502, 'RailKit could not return this timetable.');
    }
  });

  app.get('/api/railkit/status', (_req, res) => {
    res.json({ enabled: Boolean(process.env.RAILKIT_API_KEY) });
  });

  app.post('/api/railkit/lookup', async (req, res) => {
    if (!process.env.RAILKIT_API_KEY) throw new BookingError(503, 'Live rail information is unavailable.');
    const { method, fields } = req.body || {};
    const lookup = lookups.find(([id]) => id === method);
    if (!lookup) throw new BookingError(400, 'Choose a rail lookup.');
    const values = lookup.slice(2).map(({ name, label, pattern }) => {
      const value = fields?.[name];
      if (typeof value !== 'string' || !new RegExp('^(?:' + pattern + ')$').test(value)) {
        throw new BookingError(400, 'Check the ' + label.toLowerCase() + ' field.');
      }
      return name === 'name' ? value : value.toUpperCase();
    });

    try {
      const sdk = await getSdk();
      const result = await sdk[method](...values);
      if (result?.success === false) throw new Error('Upstream rejected the lookup');
      res.json({ result: result?.data ?? result });
    } catch {
      throw new BookingError(502, 'RailKit could not return this lookup. Check your details and try again.');
    }
  });
}
