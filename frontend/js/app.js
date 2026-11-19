import { classes, seatClass } from './classes.js';
import { resolveStation, stationLabel, stations } from './stations.js';

// The server owns availability; the browser never invents sold seats.
const $ = id => document.getElementById(id);
const state = { trains: [], trainId: null, hold: null, busy: false, refreshing: false, seats: [] };
let query = history.state?.query || null;
state.trainId = history.state?.trainId || null;
let selectedClass = history.state?.selectedClass || 'SL';
let pendingRequests = 0;
let passenger = null;
let registerMode = false;
let resumeSeat = null;
const passengerCount = () => query?.passengers || 1;
const seatsInHold = hold => hold.seatNos || [hold.seatNo];
const formatSeats = values => values.map(seat => String(seat).padStart(2, '0')).join(', ');
try { $('drop-response').checked = sessionStorage.getItem('tatkal-drill') === 'on'; } catch {}
$('drop-response').addEventListener('change', () => {
  try { sessionStorage.setItem('tatkal-drill',$('drop-response').checked ? 'on' : 'off'); } catch {}
});

function restoreHold() {
  if (!passenger || state.hold) return;
  try {
    const hold = JSON.parse(sessionStorage.getItem('tatkal-hold-' + passenger.id) || 'null');
    if (hold && (hold.pending || hold.checkoutId || Date.parse(hold.expiresAt) > Date.now())) {
      state.hold = hold;
      state.trainId = hold.trainId;
      selectedClass = seatClass(hold.seatNo).code;
    }
  } catch { /* Storage is optional. */ }
}

function saveHold(hold) {
  state.hold = hold;
  if (!passenger) return;
  try {
    const key = 'tatkal-hold-' + passenger.id;
    if (hold) sessionStorage.setItem(key, JSON.stringify(hold));
    else sessionStorage.removeItem(key);
  } catch { /* Booking still works if session storage is disabled. */ }
}

async function api(path, body) {
  pendingRequests++;
  document.body.classList.add('requesting');
  try {
    const response = await fetch('/api' + path, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000)
    });
    const data = await response.json();
    if (!response.ok) {
      const missingAllocationRoute = path === '/seats/allocate' && response.status === 404 &&
        data.error === 'API endpoint not found.';
      const error = new Error(missingAllocationRoute
        ? 'This server needs an update to assign berths. Restart Tatkal Shield with npm start and reopen the Local address it prints.'
        : data.error || 'Request failed. Try again.');
      error.status = response.status;
      throw error;
    }
    return data;
  } finally {
    if (--pendingRequests === 0) document.body.classList.remove('requesting');
  }
}

function message(text, success = false) {
  $('message').textContent = text;
  $('message').className = 'message' + (success ? ' success' : '');
  $('message').hidden = false;
}

function departure(value) {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    timeZone: 'Asia/Kolkata'
  }).format(new Date(value)) + ' IST';
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const localDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit'
});

for (const station of stations) {
  const [code, , ...aliases] = station;
  $('rail-stations').append(new Option([code, ...aliases].join(' · '), stationLabel(station)));
}

function fillStation(field, name) {
  const station = resolveStation(name);
  field.value = station ? stationLabel(station) : name;
  field.setCustomValidity('');
}

for (const id of ['origin', 'destination']) {
  $(id).addEventListener('input', () => {
    $('origin').setCustomValidity('');
    $('destination').setCustomValidity('');
  });
}

$('swap-stations').addEventListener('click', () => {
  const origin = $('origin');
  const destination = $('destination');
  const previousOrigin = origin.value;
  fillStation(origin, destination.value);
  fillStation(destination, previousOrigin);
});

function renderDemoRoutes() {
  const routes = new Map();
  for (const train of state.trains) {
    const route = train.source + ' → ' + train.destination;
    if (!routes.has(route)) routes.set(route, train);
  }
  const buttons = [...routes].map(([route, train]) => {
    const button = element('button', 'route-option', route);
    button.type = 'button';
    button.addEventListener('click', () => {
      fillStation($('origin'), train.source);
      fillStation($('destination'), train.destination);
      $('travel-date').value = localDay.format(new Date(train.departure));
      $('journey-form').requestSubmit();
    });
    return button;
  });
  $('demo-routes').replaceChildren(element('span', '', 'Try a demo route'), ...buttons);
}

$('train-sort').addEventListener('change', renderTrains);

function renderTrains() {
  const locked = Boolean(state.hold) || state.busy;
  $('find-trains').disabled = locked || !state.trains.length;
  $('reload').disabled = state.busy;
  for (const button of $('demo-routes').querySelectorAll('button')) button.disabled = locked;
  $('booking').hidden = !query;
  document.querySelector('.seats-panel').hidden = !state.trainId;
  $('free-total').textContent = state.trains.reduce((sum, train) => sum + train.available, 0);
  $('held-total').textContent = state.trains.reduce((sum, train) => sum + train.held, 0);
  const matches = query ? state.trains.filter(train => train.source === query.source &&
    train.destination === query.destination && localDay.format(new Date(train.departure)) === query.day) : [];
  const byDeparture = (a, b) => Date.parse(a.departure) - Date.parse(b.departure) || a.id - b.id;
  matches.sort($('train-sort').value === 'availability'
    ? (a, b) => b.available - a.available || byDeparture(a, b)
    : byDeparture);
  if (query) {
    $('results-route').textContent = query.source + ' → ' + query.destination;
    $('results-date').textContent = new Intl.DateTimeFormat('en-IN', {
      dateStyle: 'full', timeZone: 'Asia/Kolkata'
    }).format(new Date(query.day + 'T12:00:00+05:30'));
  }
  $('train-count').textContent = matches.length + (matches.length === 1 ? ' service' : ' services') + ' · ' + passengerCount() + (passengerCount() === 1 ? ' passenger' : ' passengers');
  const focusedTrain = document.activeElement?.dataset.trainId;
  $('train-list').replaceChildren();
  if (query && !matches.length) {
    $('train-list').append(element('p', 'empty-result', 'No demo trains match this journey and date. Edit your journey to try another route or date.'));
  }
  for (const train of matches) {
    const button = element('button', 'train-card');
    button.type = 'button';
    button.setAttribute('aria-pressed', String(state.trainId === train.id));
    button.disabled = state.busy;
    button.dataset.trainId = String(train.id);
    const service = element('span', 'train-service');
    service.append(element('span', 'train-name', train.name), element('span', 'train-departure', departure(train.departure)));
    const route = element('span', 'train-route');
    route.append(element('span', '', train.source), element('span', 'route-connection', ' → '), element('span', '', train.destination));
    const availability = element('span', 'train-availability');
    availability.append(element('span', 'availability-count', train.available + ' seats available'), element('span', 'seat-link', 'Choose class →'));
    button.append(service, route, availability);
    button.addEventListener('click', async () => {
      await selectTrain(train.id);
      if (state.trainId === train.id) go(state.hold ? activeHoldPage() : 'coach');
    });
    $('train-list').append(button);
    if (button.dataset.trainId === focusedTrain && !button.disabled) button.focus({ preventScroll: true });
  }
}

function renderSeats() {
  const focusedClass = document.activeElement?.dataset.classCode;
  const active = classes.find(c => c.code === selectedClass) || classes[0];
  document.querySelector('.coach-badge').textContent = active.name + ' · ' + active.coach;
  $('classes').replaceChildren(...classes.map(c => {
    const seats = state.seats.filter(s => seatClass(s.seatNo) === c);
    const button = element('button','class-choice', c.name + ' · ₹' + c.fare + ' · ' + seats.filter(s => s.status === 'free').length + ' free');
    button.setAttribute('aria-pressed', String(active === c));
    button.disabled = !seats.length || Boolean(state.hold);
    button.dataset.classCode = c.code;
    button.onclick = () => {
      selectedClass = c.code;
      remember();
      renderSeats();
    };
    return button;
  }));
  if (focusedClass) $('classes').querySelector('[data-class-code="' + focusedClass + '"]')?.focus({ preventScroll: true });
  const available = state.seats.filter(seat => seat.status === 'free' && seatClass(seat.seatNo) === active).length;
  $('selection-summary').textContent = available + ' available in ' + active.name;
  $('reserve-seats').disabled = available < passengerCount() || state.busy || Boolean(state.hold);
  document.querySelector('.seats-panel').setAttribute('aria-busy', String(state.busy));
  renderHold();
}

function renderHold() {
  const hold = state.hold;
  $('hold-panel').hidden = !hold;
  if (!hold) return;
  $('held-seat').textContent = formatSeats(seatsInHold(hold));
  $('confirm').disabled = state.busy;
  $('confirm').textContent = hold.pending ? 'Retrieve confirmation →' : 'Confirm mock booking →';
  $('hold-caption').textContent = hold.pending ? 'CHECKING CONFIRMATION' : 'RESERVED FOR YOU';
  $('expiry').hidden = Boolean(hold.pending);
  const seconds = Math.max(0, Math.ceil((Date.parse(hold.expiresAt) - Date.now()) / 1000));
  const clock = Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
  $('hold-timer').textContent = clock;
  $('flow-clock').textContent = hold.pending ? 'Retrieving ticket' : 'Seat reserved · ' + clock;
}

async function loadSeats() {
  if (!state.trainId) return;
  const selectedId = state.trainId;
  const data = await api('/trains/' + selectedId + '/seats');
  if (selectedId !== state.trainId) return;
  state.seats = data.seats;
  $('journey-label').textContent = data.train.name + ' · ' + data.train.source + ' → ' + data.train.destination;
  renderSeats();
}

async function selectTrain(id) {
  if (state.busy) return;
  if (state.hold && state.hold.trainId !== id) {
    message('You have an active hold. Confirm it or wait for its five-minute expiry before changing trains.');
    return;
  }
  state.trainId = id;
  state.seats = [];
  state.busy = true;
  renderTrains();
  renderSeats();
  try {
    await loadSeats();
  } catch (error) {
    message(error.message);
  } finally {
    state.busy = false;
    renderTrains();
    renderSeats();
  }
}

async function refresh() {
  if (state.busy || state.refreshing) return;
  state.refreshing = true;
  try {
    const data = await api('/trains');
    state.trains = data.trains;
    renderTrains();
    await loadSeats();
  } finally {
    state.refreshing = false;
  }
}

$('reserve-seats').onclick = openTravellers;

function openTravellers() {
  if (!passenger) {
    resumeSeat = { trainId: state.trainId };
    openPassenger();
    return;
  }
  $('traveller-fields').replaceChildren();
  for (let index = 0; index < passengerCount(); index++) {
    const fieldset = $('traveller-fields-template').content.cloneNode(true);
    fieldset.querySelector('legend').textContent = 'Passenger ' + (index + 1);
    $('traveller-fields').append(fieldset);
  }
  go('traveller');
}

function renderGroupTickets(tickets) {
  const list = $('group-tickets');
  list.hidden = tickets.length < 2;
  list.replaceChildren(...tickets.map(ticket => element('li', '', 'Seat ' +
    formatSeats([ticket.seat_no]) + ' · ' + ticket.pnr + (ticket.status === 'CANCELLED' ? ' · Cancelled' : ''))));
}

$('confirm').addEventListener('click', async () => {
  if (!state.hold?.checkoutId || state.busy) return;
  const hold = state.hold;
  state.busy = true;
  renderSeats();
  renderTrains();
  try {
    if (!(await api('/checkout/' + hold.checkoutId)).paid) { message('Complete your demo wallet payment first.'); return; }
    saveHold({ ...hold, pending: true });
    const { booking, bookings, train, recovered } = await api('/bookings/confirm', hold);
    if (!hold.pending && $('drop-response').checked) {
      $('drop-response').checked = false;
      try { sessionStorage.removeItem('tatkal-drill'); } catch {}
      $('ticket').hidden = true;
      message('Drill: the server committed the booking. Its reply was discarded. Retrieve the confirmation to recover your PNR.');
      $('drill-result').textContent = 'Reply discarded · recovery pending';
      return;
    }
    $('drill-result').textContent = recovered && hold.pending ? 'Receipt recovered · original PNR returned' : 'Receipt delivered · booking committed';
    saveHold(null);
    if (booking.status === 'CANCELLED') {
      $('ticket').hidden = true;
      message('This booking was cancelled. You can view it under My tickets.');
      return;
    }
    $('ticket-route').textContent = train.name + ' · ' + train.source + ' → ' + train.destination;
    $('ticket-departure').textContent = departure(train.departure);
    $('ticket-pnr').textContent = booking.pnr;
    $('ticket-seat').textContent = String(booking.seat_no).padStart(2, '0');
    renderGroupTickets(bookings);
    $('ticket').hidden = false;
    $('receipt-class').textContent = seatClass(booking.seat_no).name;
    go('receipt');
    history.replaceState({...history.state,pnr:booking.pnr},'');
    message('Booking confirmed. Your seat is now marked sold.', true);
  } catch (error) {
    if ([403, 409, 410].includes(error.status)) saveHold(null);
    if (error.status === 401) {
      state.hold = null;
      passenger = null;
      openPassenger();
    }
    message(error.message);
  } finally {
    state.busy = false;
    renderTrains();
    renderSeats();
    try { await refresh(); } catch { /* Do not hide a successful booking. */ }
  }
});

$('reload').addEventListener('click', async () => {
  try { await boot(); } catch (error) { message(error.message); }
});

async function boot() {
  await passengerReady;
  const started = performance.now();
  const health = await api('/health');
  $('health-time').textContent = Math.round(performance.now() - started) + ' ms';
  $('storage-notice').textContent = health.storage === 'demo-memory'
    ? 'LOCAL DEMO · Bookings reset when the server restarts. This is an in-memory PostgreSQL emulator.'
    : 'POSTGRESQL CONNECTED · Bookings are stored in your configured database.';
  const data = await api('/trains');
  state.trains = data.trains;
  renderDemoRoutes();
  const days = [...new Set(state.trains.map(train => localDay.format(new Date(train.departure))))].sort();
  if (!$('travel-date').value) $('travel-date').value = days[0] || '';
  $('schedule-hint').textContent = days.length
    ? 'Demo timetable · ' + days.map(day => new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(day + 'T12:00:00Z'))).join(' / ')
    : 'No scheduled departures.';
  const restored = state.hold && state.trains.find(train => train.id === state.hold.trainId);
  if (restored) {
    query = { source: restored.source, destination: restored.destination, day: localDay.format(new Date(restored.departure)), passengers: seatsInHold(state.hold).length };
  }
  if (query) {
    fillStation($('origin'), query.source);
    fillStation($('destination'), query.destination);
    $('travel-date').value = query.day;
  }
  $('passenger-count').value = String(passengerCount());
  $('retry-timetable').hidden = true;
  renderTrains();
  if (state.trainId) await selectTrain(state.trainId);
  if (location.hash === '#receipt' && history.state?.pnr && passenger && $('ticket').hidden) {
    const {tickets} = await api('/passenger/tickets');
    const ticket = tickets.find(t => t.pnr === history.state.pnr && t.status === 'CONFIRMED');
    if (ticket) {
      renderGroupTickets(ticket.checkout_id ? tickets.filter(t => t.checkout_id === ticket.checkout_id).reverse() : [ticket]);
      $('ticket-route').textContent = ticket.name + ' · ' + ticket.source + ' → ' + ticket.destination;
      $('ticket-departure').textContent = departure(ticket.departure);
      $('ticket-pnr').textContent = ticket.pnr;
      $('receipt-class').textContent = ticket.travel_class || 'Sleeper';
      $('ticket-seat').textContent = String(ticket.seat_no).padStart(2,'0');
      $('ticket').hidden = false;
    }
  }
  syncPage();
}

setInterval(() => {
  if (!state.hold) return;
  if (!state.hold.pending && !state.hold.checkoutId && Date.parse(state.hold.expiresAt) <= Date.now() && !state.busy) {
    saveHold(null);
    renderSeats();
    go('coach');
    message('Your seat hold expired. Enter passenger details to request new berths.');
    refresh().catch(error => message(error.message));
  } else {
    renderHold();
  }
}, 1000);

setInterval(() => {
  if (!document.hidden && state.hold?.checkoutId && !state.hold.pending && !state.busy) {
    const id = state.hold.checkoutId;
    api('/checkout/'+id).then(order => {
      if (state.hold?.checkoutId !== id || state.busy || state.hold.pending) return;
      if (order.paid) $('confirm').click();
      else if (Date.parse(order.expiresAt) <= Date.now()) {
        saveHold(null); go('coach'); message('Your seat hold expired. Enter passenger details to request new berths.');
      }
    }).catch(() => {});
  }
  if (!document.hidden) refresh().catch(error => message('Availability refresh failed: ' + error.message));
}, 5000);

$('journey-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (state.hold || state.busy) return;
  const origin = resolveStation($('origin').value);
  const destination = resolveStation($('destination').value);
  for (const [id, station] of [['origin', origin], ['destination', destination]]) {
    if (!station) {
      $(id).setCustomValidity('Choose a station from the suggestions or enter its exact code.');
      $(id).reportValidity();
      return;
    }
  }
  if (origin[0] === destination[0]) {
    $('destination').setCustomValidity('Choose a different arrival station.');
    $('destination').reportValidity();
    return;
  }
  fillStation($('origin'), origin[1]);
  fillStation($('destination'), destination[1]);
  const nextQuery = { source: origin[1], destination: destination[1], day: $('travel-date').value, passengers: Number($('passenger-count').value) };
  state.busy = true;
  const searchButton = $('find-trains');
  searchButton.setAttribute('aria-busy', 'true');
  searchButton.textContent = 'Searching…';
  const started = performance.now();
  renderTrains();
  try {
    const data = await api('/trains');
    // Let fast local responses finish the loading transition instead of flashing it.
    if (matchMedia('(prefers-reduced-motion: no-preference)').matches) {
      await new Promise(resolve => setTimeout(resolve, Math.max(0, 360 - (performance.now() - started))));
    }
    state.trains = data.trains;
    query = nextQuery;
    state.trainId = null;
    state.seats = [];
    $('ticket').hidden = true;
    $('message').hidden = true;
    renderSeats();
    renderTrains();
    go('results');
    loadReference(origin[0], destination[0]);
  } catch (error) {
    message(error.message);
  } finally {
    state.busy = false;
    searchButton.removeAttribute('aria-busy');
    searchButton.textContent = 'Search trains →';
    renderTrains();
  }
});

$('retry-timetable').addEventListener('click', () => boot().catch(error => message(error.message)));

function renderPassenger() {
  $('passenger-open').textContent = passenger ? 'My tickets' : 'Sign in';
  $('passenger-form').hidden = Boolean(passenger);
  $('passenger-profile').hidden = !passenger;
  $('account-title').textContent = passenger ? passenger.name : registerMode ? 'Create passenger account' : 'Passenger sign in';
  $('passenger-name-field').hidden = !registerMode;
  $('passenger-name').required = registerMode;
  $('passenger-password').autocomplete = registerMode ? 'new-password' : 'current-password';
  $('passenger-submit').textContent = registerMode ? 'Create account' : 'Sign in';
  $('passenger-switch').textContent = registerMode ? 'Already registered? Sign in' : 'Create a passenger account';
  $('passenger-email').textContent = passenger?.email || '';
}

function ticketCard(ticket) {
  const item = element('li', 'saved-ticket');
  const cancelled = ticket.status === 'CANCELLED';
  const details = element('details');
  details.append(element('summary', '', 'View ticket · ' + ticket.pnr));
  details.append(
    element('strong', '', ticket.name),
    element('p', '', ticket.source + ' → ' + ticket.destination),
    element('p', '', departure(ticket.departure)),
    element('p', '', (ticket.travel_class || 'Coach S1') + ' · Seat ' + ticket.seat_no + ' · ' + (cancelled ? 'Cancelled' : 'Confirmed'))
  );
  if (ticket.traveller) details.append(element('p','subtle', ticket.traveller + ' · ₹' + seatClass(ticket.seat_no).fare + ' · ' + ticket.preference));
  item.append(
    element('strong', '', ticket.source + ' → ' + ticket.destination),
    element('span', 'saved-ticket-status', cancelled ? 'Cancelled' : 'Confirmed'),
    details
  );
  if (cancelled || !ticket.train_id) return item;

  const actions = element('div', 'saved-ticket-actions');
  const cancel = element('button', 'text-button', 'Cancel ticket');
  cancel.type = 'button';
  actions.append(cancel);
  const note = element('p', 'subtle');
  note.setAttribute('role', 'status');
  details.append(actions, note);

  async function update(action, payload, feedback) {
    for (const button of details.querySelectorAll('button')) button.disabled = true;
    note.textContent = 'Updating ticket…';
    try {
      await api('/bookings/' + encodeURIComponent(ticket.pnr) + '/' + action, payload);
      if ($('ticket-pnr').textContent === ticket.pnr) {
        $('ticket').hidden = true;
        go('journey');
      }
      await loadTickets(ticket.pnr);
      $('passenger-status').textContent = feedback;
      refresh().catch(() => { /* The ticket update already succeeded. */ });
    } catch (error) {
      note.textContent = error.message;
    } finally {
      for (const button of details.querySelectorAll('button')) button.disabled = false;
    }
  }

  cancel.addEventListener('click', () => {
    if (window.confirm('Cancel demo ticket ' + ticket.pnr + ' and release seat ' + ticket.seat_no + '?')) {
      update('cancel', {}, 'Ticket cancelled. The seat is available again.');
    }
  });
  return item;
}

async function loadTickets(openPnr) {
  const list = $('passenger-tickets');
  list.replaceChildren(element('li', 'subtle', 'Loading your tickets…'));
  try {
    const { tickets } = await api('/passenger/tickets');
    list.replaceChildren(...tickets.map(ticket => {
      const item = ticketCard(ticket);
      if (ticket.pnr === openPnr) item.querySelector('details').open = true;
      return item;
    }));
    if (!tickets.length) list.append(element('li', 'subtle', 'Your confirmed bookings will appear here.'));
  } catch (error) {
    list.replaceChildren(element('li', '', error.message));
    if (error.status === 401) {
      passenger = null;
      state.hold = null;
      $('ticket').hidden = true;
      renderPassenger();
      renderTrains();
      renderSeats();
    }
  }
}

function openPassenger() {
  renderPassenger();
  $('passenger-status').textContent = '';
  if (!$('passenger-dialog').open) $('passenger-dialog').showModal();
  if (passenger) loadTickets();
}

$('passenger-open').addEventListener('click', () => {
  resumeSeat = null;
  openPassenger();
});
$('passenger-dialog').addEventListener('close', () => {
  resumeSeat = null;
  $('passenger-password').value = '';
});
$('passenger-switch').addEventListener('click', () => {
  registerMode = !registerMode;
  $('passenger-status').textContent = '';
  renderPassenger();
});
$('passenger-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('passenger-submit');
  if (button.disabled) return;
  button.disabled = true;
  $('passenger-switch').disabled = true;
  $('passenger-status').textContent = 'Checking your account…';
  try {
    const data = Object.fromEntries(new FormData(event.currentTarget));
    ({ passenger } = await api('/passenger/' + (registerMode ? 'register' : 'login'), data));
    registerMode = false;
    const target = resumeSeat;
    $('passenger-form').reset();
    renderPassenger();
    $('passenger-status').textContent = '';
    restoreHold();
    if (state.hold || target) {
      $('passenger-dialog').close();
      if (state.hold) await boot();
      else if (target.trainId === state.trainId) openTravellers();
    } else {
      await loadTickets();
    }
  } catch (error) {
    $('passenger-status').textContent = error.status === 404
      ? 'This server is missing the sign-in route. Open the Local address printed by the current npm start command.'
      : error.message;
  } finally {
    button.disabled = false;
    $('passenger-switch').disabled = false;
  }
});
$('passenger-logout').addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await api('/passenger/logout', {});
    passenger = null;
    state.hold = null;
    $('traveller-form').reset();
    go('journey');
    $('ticket').hidden = true;
    $('message').hidden = true;
    $('passenger-tickets').replaceChildren();
    renderPassenger();
    renderTrains();
    renderSeats();
    $('passenger-dialog').close();
  } catch (error) {
    $('passenger-status').textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

const steps = ['results','coach','traveller','payment','receipt'];
const summaryPanels = [...document.querySelectorAll('.trip-summary')];
for (const panel of summaryPanels) panel.append($('trip-summary-template').content.cloneNode(true));
const rupees = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
function remember() {
  history.replaceState({query,trainId:state.trainId,selectedClass}, '');
}
function activeHoldPage() { return state.hold?.checkoutId ? 'payment' : 'traveller'; }
function go(page) {
  if (location.hash !== '#' + page) history.pushState({query,trainId:state.trainId,selectedClass}, '', '#' + page);
  remember();
  syncPage();
}
function syncPage() {
  let page = location.hash.slice(1);
  if (state.hold && (steps.includes(page) || page === 'journey')) page = activeHoldPage();
  else if (page === 'receipt' && $('ticket').hidden) page = 'journey';
  else if ((page === 'payment' || page === 'traveller' && (!state.trainId || !passenger || !$('traveller-fields').children.length))) page = state.trainId ? 'coach' : 'journey';
  else if (page === 'coach' && !state.trainId || page === 'results' && !query) page = 'journey';
  if (page !== location.hash.slice(1)) history.replaceState({query,trainId:state.trainId,selectedClass},'', '#' + page);
  const step = steps.indexOf(page);
  document.body.dataset.page = step < 0 ? (page && page !== 'welcome' ? 'home' : 'welcome') : page;
  $('flow-nav').hidden = step < 0;
  $('flow-clock').hidden = !state.hold;
  $('release-hold').hidden = !state.hold || state.hold.pending;
  [...$('flow-progress').children].forEach((item, index) => {
    if (index === step) item.setAttribute('aria-current', 'step');
    else item.removeAttribute('aria-current');
  });
  for (const id of ['traveller','payment']) $(id).hidden = id !== page;
  if (state.hold || page === 'traveller') {
    const c = state.hold ? seatClass(state.hold.seatNo) : classes.find(item => item.code === selectedClass) || classes[0];
    const seats = state.hold ? seatsInHold(state.hold) : [];
    const total = (seats.length || passengerCount()) * c.fare;
    const train = state.trains.find(t => t.id === (state.hold?.trainId ?? state.trainId));
    const summary = {
      train: train?.name || 'Selected train',
      route: train ? train.source + ' → ' + train.destination : '',
      class: c.name,
      seats: (seats.length || passengerCount()) + ' · assigned automatically',
      total: rupees.format(total),
    };
    for (const panel of summaryPanels) {
      for (const field of panel.querySelectorAll('[data-summary]')) field.textContent = summary[field.dataset.summary];
    }
    if (page === 'traveller' && state.hold && !$('traveller-fields').children.length) {
      for (let index = 0; index < seats.length; index++) {
        const fieldset = $('traveller-fields-template').content.cloneNode(true);
        fieldset.querySelector('legend').textContent = 'Passenger ' + (index + 1);
        $('traveller-fields').append(fieldset);
      }
    }
    if (page === 'payment') {
      $('pay-now').textContent = 'Pay ₹' + total + ' with demo wallet';
      $('pay-qr').src = '/api/checkout/' + state.hold.checkoutId + '/qr';
    }
  }
  if (step >= 0) {
    const heading = document.querySelector(({results:'#trains-heading',coach:'#seats-heading',traveller:'#traveller h2',payment:'#payment h2',receipt:'#ticket'})[page]);
    heading?.focus({preventScroll:true});
    window.scrollTo(0,0);
  } else if (page === 'journey') {
    $('search-title').focus({preventScroll:true});
    window.scrollTo(0, 0);
  } else if (page) document.getElementById(page)?.scrollIntoView();
}
window.addEventListener('hashchange', syncPage);
if (location.hash === '#journey') syncPage();
$('release-hold').onclick = async () => {
  if (state.busy || !state.hold) return;
  state.busy = true;
  try {
    await api('/seats/release', state.hold);
    saveHold(null);
    $('traveller-fields').replaceChildren();
    message('Berth hold released. You can change your journey or class.', true);
    go('coach');
    await loadSeats();
  } catch (error) { message(error.message); }
  finally { state.busy = false; renderSeats(); renderTrains(); }
};
$('traveller-form').onsubmit = async e => {
  e.preventDefault();
  if (!state.trainId || state.busy) return;
  const form = e.currentTarget;
  const travellers = [...form.querySelectorAll('fieldset')].map(fieldset => {
    const values = Object.fromEntries([...fieldset.querySelectorAll('input, select')].map(input => [input.name, input.value]));
    return { ...values, age: Number(values.age) };
  });
  state.busy = true;
  $('continue-payment').disabled = true;
  try {
    if (!state.hold) {
      const hold = await api('/seats/allocate', {
        trainId: state.trainId,
        classCode: selectedClass || classes[0].code,
        preferences: travellers.map(person => person.preference),
      });
      saveHold(hold);
    }
    const orderedTravellers = travellers.map((person, index) => ({ person, seat: seatsInHold(state.hold)[index] }))
      .sort((a, b) => a.seat - b.seat)
      .map(entry => entry.person);
    const order = await api('/checkout',{travellers:orderedTravellers,holdToken:state.hold.holdToken});
    saveHold({...state.hold,checkoutId:order.id});
    form.reset();
    go('payment');
  } catch (error) { message(error.message); }
  finally { state.busy = false; $('continue-payment').disabled = false; }
};
async function pay() {
  if (!state.hold?.checkoutId || state.busy) return;
  $('pay-now').disabled = true;
  try {
    await api('/checkout/' + state.hold.checkoutId + '/demo-pay',{});
    $('confirm').click();
  } catch (error) {
    if (error.status === 410) { saveHold(null); go('coach'); }
    message(error.message);
  } finally { $('pay-now').disabled = false; }
}
$('pay-now').onclick = pay;
api('/youpi/status').then(({ enabled }) => {
  $('youpi-option').hidden = !enabled;
}).catch(() => { /* The local demo wallet remains available. */ });

$('open-youpi').onclick = async event => {
  if (!state.hold?.checkoutId) return;
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const { checkoutUrl } = await api('/checkout/' + state.hold.checkoutId + '/youpi', {});
    window.location.assign(checkoutUrl);
  } catch (error) {
    message(error.message);
  } finally {
    button.disabled = false;
  }
};

$('check-paid').onclick = () => $('confirm').click();
let referenceRequest = 0;
async function loadReference(from,to) {
  const request = ++referenceRequest;
  const box = $('railkit-results');
  box.hidden = true;
  try {
    const data = await api('/railkit/search?from='+encodeURIComponent(from)+'&to='+encodeURIComponent(to));
    if (request !== referenceRequest || !data.enabled) return;
    const rows = Array.isArray(data.result) ? data.result : data.result?.data;
    const names = Array.isArray(rows) ? rows.map(r => r.trainName || r.train_name || r.name).filter(n => typeof n === 'string') : [];
    box.textContent = 'RailKit timetable reference · ' + (names.join(' · ') || 'No additional services listed.');
    box.hidden = false;
  } catch { if (request === referenceRequest) { box.textContent = 'RailKit timetable reference is unavailable.'; box.hidden = false; } }
}

const passengerReady = api('/passenger').then(result => {
  passenger = result.passenger;
  restoreHold();
  renderPassenger();
}).catch(() => { /* The public timetable remains available. */ });

boot().catch(error => {
  $('retry-timetable').hidden = false;
  $('schedule-hint').textContent = 'Could not load the timetable.';
  document.querySelector('.seats-panel').setAttribute('aria-busy', 'false');
  $('train-list').replaceChildren(element('p', 'loading', 'Could not load trains. Use Refresh availability to retry.'));
  $('storage-notice').textContent = 'Booking service unavailable.';
  message(error.message);
});

