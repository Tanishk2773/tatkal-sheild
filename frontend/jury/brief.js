const booking = [
  ['Hold', 'Seat held', 'The booking service checks the seat and creates a five-minute hold for the signed-in passenger.'],
  ['Commit', 'Booking committed', 'The service validates the hold, writes the confirmed seat and PNR, and releases the hold in one transaction.'],
  ['Drop', 'Reply discarded', 'In the drill, the browser deliberately discards the successful acknowledgement after the server has committed the booking.'],
  ['Retry', 'Passenger reconnects', 'After a refresh in the same tab, the browser restores the pending confirmation and resends it with the original hold token.'],
  ['Recover', 'Same PNR returned', 'The server matches the passenger and token to the existing booking. The passenger can also find the ticket in their account.']
];
const delivery = [
  ['Git', 'Local version control', 'Record the change', 'A Git commit identifies the exact source for a booking fix and its tests. On GitHub a pull request lets the team review them together.'],
  ['Actions', 'CI workflow configured', 'Check the change', 'On pull requests and pushes to main, GitHub Actions installs locked dependencies, runs syntax checks and executes the booking tests.'],
  ['PostgreSQL', 'CI integration check configured', 'Race for the same seat', 'In a fresh PostgreSQL service, two simultaneous holds must produce one winner. Confirmation retries must return the original PNR.'],
  ['Docker', 'Temporary staging configured', 'Exercise the release candidate', 'The workflow builds an image, starts it against the CI database and verifies its health endpoint and homepage. Staging lasts for the job.'],
  ['Deliver', 'Continuous delivery configured', 'Publish the tested image', 'On a passing push to main, a separate job publishes that same image to GitHub Container Registry with the commit SHA as its tag.']
];

function walkthrough({ rows, track, play, render, previous, next }) {
  let index = 0;
  let timer;
  const label = play.textContent;
  function stop() {
    clearInterval(timer);
    timer = undefined;
    play.textContent = label;
  }
  function show(position) {
    index = position;
    buttons.forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
    render(rows[index], index);
    if (previous) previous.disabled = index === 0;
    if (next) next.disabled = index === rows.length - 1;
    if (index === rows.length - 1) stop();
  }
  const buttons = rows.map(([name], i) => {
    const button = document.createElement('button');
    button.textContent = name;
    button.addEventListener('click', () => { stop(); show(i); });
    track.append(button);
    return button;
  });
  play.addEventListener('click', () => {
    if (timer) return stop();
    if (index === rows.length - 1) show(0);
    play.textContent = 'Pause';
    timer = setInterval(() => show(index + 1), 4500);
  });
  previous?.addEventListener('click', () => { stop(); show(index - 1); });
  next?.addEventListener('click', () => { stop(); show(index + 1); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  show(0);
}
const byId = id => document.getElementById(id);
walkthrough({ rows: booking, track: document.querySelector('#trace .line'), play: byId('play'),
  previous: byId('previous'), next: byId('next'), render: ([, title, detail], index) => {
    byId('counter').textContent = 'Booking step ' + (index + 1) + ' of ' + booking.length;
    byId('step').textContent = title;
    byId('detail').textContent = detail;
  }
});
walkthrough({ rows: delivery, track: byId('pipeline'), play: byId('delivery-play'),
  render: ([, status, title, detail]) => {
    byId('delivery-status').textContent = status;
    byId('delivery-title').textContent = title;
    byId('delivery-detail').textContent = detail;
  }
});
