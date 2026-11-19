const scenarios = {
  contention: [
    ['Race', 'Two groups request overlapping seats', 'Family A requests 13 and 14. Family B requests 14 and 15. The API places the complete request inside a PostgreSQL transaction.'],
    ['Serialize', 'Train-level lock orders the writes', 'PostgreSQL grants one booking transaction the train row lock. The other waits, so both requests cannot validate against the same free-seat snapshot.'],
    ['Validate', 'The winning group gets every selected seat', 'The winning transaction checks all of its seats before writing. It creates one ticket per traveller and releases the shared hold atomically.'],
    ['Reject', 'The losing group leaves with no partial hold', 'The second group gets a conflict because seat 14 is sold. Seat 15 remains available. No partial group booking is created.']
  ],
  recovery: [
    ['Hold', 'Assign berths for each traveller', 'One shared hold token covers the group. The server assigns available seats and tries to honor berth preferences.'],
    ['Price', 'The server calculates the fare', 'The server calculates the group total using the selected class and traveller count. The QR opens the demo wallet.'],
    ['Commit', 'Create one ticket per passenger', 'A PostgreSQL transaction writes the tickets, releases the holds and marks the local demo order paid.'],
    ['Drop', 'The browser loses its confirmation response', 'The Operations Lab simulates a network interruption after the booking commits. The tickets still exist in PostgreSQL.'],
    ['Recover', 'Retry with the same hold token', 'The confirmation key matches the original group. The service returns the original set of PNRs instead of creating duplicate tickets.']
  ]
};
const delivery = [
  ['Source', 'Push the change to GitHub', 'GitHub Actions starts automatically for a main branch push or a pull request.'],
  ['Checks', 'Run syntax and API checks', 'The workflow tests passenger accounts, group holds, QR checkout, idempotent recovery and cancellation.'],
  ['Race', 'Start PostgreSQL contenders', 'An isolated PostgreSQL service verifies that concurrent requests cannot claim the same seat or leave a partial group hold.'],
  ['Image', 'Build the Docker candidate', 'The workflow packages the checked source into a release candidate and starts it beside PostgreSQL.'],
  ['Browser', 'Exercise the staging booking app', 'Desktop and mobile Chromium tests repeat multi-passenger booking and ticket recovery against the container.'],
  ['Publish', 'Deliver the tested image', 'Only after staging passes does GitHub Actions publish the image to GitHub Container Registry.']
];

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function mountTrace(container, initial) {
  let stages = initial;
  let index = 0;
  let timer;
  const nodes = node('div', '', 'trace-nodes');
  const detail = node('div', '', 'trace-detail');
  detail.setAttribute('aria-live', 'polite');
  const controls = node('div', '', 'trace-controls');
  const previous = node('button', 'Previous');
  const play = node('button', 'Play');
  const next = node('button', 'Next');
  controls.append(previous, play, next);
  container.append(nodes, detail, controls);

  function stop() {
    clearInterval(timer);
    timer = undefined;
    play.textContent = 'Play';
  }

  function show(step) {
    index = step;
    const [, title, description] = stages[index];
    const content = node('div');
    content.append(node('h3', title), node('p', description));
    detail.replaceChildren(content);
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      content.animate([{ opacity: .25, transform: 'translateY(5px)' }, { opacity: 1, transform: 'none' }], 260);
    }
    [...nodes.children].forEach((button, i) => {
      if (i === index) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    });
    previous.disabled = index === 0;
    next.disabled = index === stages.length - 1;
  }

  function setStages(items) {
    stop();
    stages = items;
    nodes.replaceChildren(...stages.map(([label], i) => {
      const button = node('button', label);
      button.onclick = () => { stop(); show(i); };
      return button;
    }));
    show(0);
  }

  play.onclick = () => {
    if (timer) { stop(); return; }
    show(0);
    play.textContent = 'Pause';
    timer = setInterval(() => {
      show(index + 1);
      if (index === stages.length - 1) stop();
    }, 4200);
  };
  previous.onclick = () => { stop(); show(index - 1); };
  next.onclick = () => { stop(); show(index + 1); };
  setStages(initial);
  return setStages;
}

const updateScenario = mountTrace(document.querySelector('#booking-trace'), scenarios.contention);
mountTrace(document.querySelector('#delivery-trace'), delivery);
for (const button of document.querySelectorAll('.scenario-controls button')) {
  button.onclick = () => {
    for (const item of button.parentNode.children) item.setAttribute('aria-pressed', String(item === button));
    updateScenario(scenarios[button.id]);
  };
}

const observer = new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  }
}, { threshold: .12 });
document.querySelectorAll('.reveal').forEach(section => observer.observe(section));

const status = document.querySelector('#service-status');
try {
  const response = await fetch('/api/health', { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('Unavailable');
  const { storage } = await response.json();
  status.textContent = storage === 'postgres' ? 'API READY / POSTGRESQL PERSISTENCE' : 'API READY / IN-MEMORY DEMO DATABASE';
} catch {
  status.textContent = 'BOOKING API / NOT RESPONDING TO READINESS CHECK';
}

const clock = document.querySelector('#board-clock');
function updateClock() {
  clock.textContent = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  }).format(new Date());
}
updateClock();
setInterval(updateClock, 1000);

const controls = {
  requests: document.querySelector('#request-count'),
  seats: document.querySelector('#seat-count'),
  botRate: document.querySelector('#bot-count'),
  shared: document.querySelector('#shared-count')
};
const labels = {
  requests: document.querySelector('#request-count-label'),
  seats: document.querySelector('#seat-count-label'),
  botRate: document.querySelector('#bot-count-label'),
  shared: document.querySelector('#shared-count-label')
};
for (const name of Object.keys(controls)) controls[name].addEventListener('input', () => {
  labels[name].textContent = controls[name].value + (name === 'botRate' ? '%' : '');
});
const runButton = document.querySelector('#run-simulation');
const simState = document.querySelector('#simulation-state');
const stream = document.querySelector('#request-stream');
const explanation = document.querySelector('#sim-explanation');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

runButton.addEventListener('click', () => {
  const requestTotal = Number(controls.requests.value);
  const seatCapacity = Number(controls.seats.value);
  const botTotal = Math.round(requestTotal * Number(controls.botRate.value) / 100);
  const humanTotal = requestTotal - botTotal;
  const sharedUsers = Number(controls.shared.value);
  const perIpLimit = 5;

  // Human passengers share public addresses in groups; automated traffic rotates addresses.
  const humanIpGroups = Math.ceil(humanTotal / sharedUsers);
  const humanIpAdmitted = Math.min(humanTotal, humanIpGroups * perIpLimit);
  const distributedBotIps = Math.max(1, Math.ceil(botTotal / perIpLimit));
  const botIpAdmitted = Math.min(botTotal, distributedBotIps * perIpLimit);
  const ipAdmitted = humanIpAdmitted + botIpAdmitted;
  // Expected human share of the seats after the surviving IP-limited requests race.
  const ipHumanBooked = ipAdmitted ? Math.min(humanIpAdmitted, Math.round(Math.min(seatCapacity, ipAdmitted) * humanIpAdmitted / ipAdmitted)) : 0;
  // Fair demo admits verified humans to inventory first, then bots fill only unused capacity.
  const fairHumanBooked = Math.min(humanTotal, seatCapacity);
  const botSpare = Math.max(0, seatCapacity - fairHumanBooked);
  const fairBotBooked = Math.min(botTotal, botSpare);
  document.querySelector('#ip-human').textContent = humanIpAdmitted + ' / ' + ipHumanBooked;
  document.querySelector('#ip-caption').textContent = 'Admitted past IP cap / estimated tickets';
  document.querySelector('#fair-human').textContent = humanTotal + ' / ' + fairHumanBooked;
  document.querySelector('#fair-caption').textContent = 'Verified humans queued / tickets';
  document.querySelector('#seat-outcome').textContent = seatCapacity + ' / ' + (ipHumanBooked + fairHumanBooked);
  document.querySelector('#simulation-state').textContent = 'BURST SIMULATED / ' + requestTotal + ' REQUESTS';
  const sampleSize = Math.min(requestTotal, 110);
  const dots = Array.from({ length: sampleSize }, (_, i) => {
    const bot = i < sampleSize * botTotal / requestTotal;
    const humanIndex = Math.floor(i * humanTotal / Math.max(1, sampleSize));
    const admitted = bot
      ? Math.floor(i / Math.max(1, sampleSize * botTotal / requestTotal)) < botIpAdmitted
      : Math.ceil((humanIndex + 1) / sharedUsers) * perIpLimit > humanIndex;
    const span = node('span', '', 'request-dot ' + (bot ? 'bot' : 'human') + (admitted ? ' admitted' : ' denied'));
    span.title = (bot ? 'Automated request' : 'Passenger request') + (admitted ? ', admitted' : ', delayed or throttled');
    return span;
  });
  stream.replaceChildren(...dots);
  explanation.textContent =
    'The IP-only model caps each address at ' + perIpLimit + ' requests. ' + (sharedUsers - perIpLimit) +
    ' is the modeled shared-network group size. Each shared IP can pass only ' + perIpLimit +
    ' requests, while bot traffic rotates across addresses. The IP-only row estimates human tickets if admitted requests race for seats. ' +
    'The proposed model assumes passenger verification signals work and queues identified passengers before bot traffic. It gives humans first access to ' +
    seatCapacity + ' available seats in this simulation, so bots receive ' + fairBotBooked + ' seats.';
  if (reduceMotion.matches) stream.setAttribute('data-complete', 'true');
  else {
    stream.removeAttribute('data-complete');
    stream.animate([{ opacity: .3 }, { opacity: 1 }], { duration: 450, easing: 'ease-out' });
  }
});
