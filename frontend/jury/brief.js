const scenarios = {
  contention: [
    ['Request', 'Two groups select overlapping seats', 'Family A requests seats 13 and 14. Family B requests seats 14 and 15. Both requests reach the Express API.'],
    ['Lock', 'PostgreSQL serializes bookings for the train', 'The first request locks the train row within a database transaction. The second waits for the transaction to finish.'],
    ['Hold', 'The first group reserves both seats', 'The API verifies that both seats are free and assigns a shared token with a five-minute expiry.'],
    ['Reject', 'The second group can choose again', 'The API returns a conflict for seat 14. Seat 15 stays available because the service validates the entire selection before writing.']
  ],
  recovery: [
    ['Hold', 'Choose seats for each traveller', 'Passenger A and Passenger B share one hold. Each seat has a separate traveller form.'],
    ['Checkout', 'The server prices the group', 'The server calculates the fare from the selected class and number of seats. The QR opens the demo wallet.'],
    ['Commit', 'Payment and booking settle together', 'One database transaction creates the two ticket records, releases the holds, and marks the order paid.'],
    ['Drop', 'The browser discards the confirmation', 'The Operations Lab simulates an acknowledgement lost after the commit. The database still has both tickets.'],
    ['Recover', 'Refresh and retrieve the same PNRs', 'The service recognizes the original hold token and returns the existing bookings. No second ticket is created.']
  ]
};
const delivery = [
  ['GitHub', 'Push the code to GitHub', 'GitHub Actions starts the workflow for a push to main or a pull request.'],
  ['Checks', 'Verify the booking rules', 'Syntax checks, API tests and Chromium browser tests cover holds, QR checkout, recovery and cancellations.'],
  ['PostgreSQL', 'Race overlapping seat requests', 'A real PostgreSQL instance verifies that one request wins and the competing group leaves no partial hold.'],
  ['Docker', 'Build a release candidate', 'The workflow packages the same source into a container. A database readiness probe checks the running service.'],
  ['Staging', 'Repeat checkout against the container', 'Desktop and mobile browser runs exercise the release candidate against PostgreSQL. CI captures startup and health details.'],
  ['Registry', 'Publish the verified image', 'A successful main-branch run publishes the image to GitHub Container Registry with the Git commit as its tag.']
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
  status.textContent = storage === 'postgres' ? 'Ready · Connected to PostgreSQL.' : 'Ready · Using the in-memory demo database.';
} catch {
  status.textContent = 'The booking API did not respond to the readiness check.';
}
