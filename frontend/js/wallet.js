const endpoint = '/api/checkout/' + encodeURIComponent(location.hash.slice(1));
const status = document.getElementById('status');
const button = document.getElementById('pay');
async function showOrder() {
  const response = await fetch(endpoint);
  if (!response.ok) throw new Error('This checkout link is invalid.');
  const order = await response.json();
  document.getElementById('amount').textContent =
    order.travelClass + ' · ₹' + order.fare;
  const expired = Date.parse(order.expiresAt) <= Date.now();
  button.hidden = order.paid || expired;
  status.textContent = order.paid
    ? 'Paid. Return to the booking screen to retrieve your ticket.'
    : expired
      ? 'Your seat hold expired.'
      : 'This wallet uses demo funds. No money will leave your account.';
}
button.onclick = async () => {
  button.disabled = true;
  try {
    const response = await fetch(endpoint + '/demo-pay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!response.ok) throw new Error((await response.json()).error);
    await showOrder();
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
};
showOrder().catch((error) => {
  status.textContent = error.message;
});
