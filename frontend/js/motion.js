const poster = document.querySelector('.poster');
const motion = matchMedia('(prefers-reduced-motion: no-preference)');
const precisionPointer = matchMedia('(hover: hover) and (pointer: fine)');
const halo = document.createElement('span');
halo.className = 'pointer-halo';
halo.setAttribute('aria-hidden', 'true');
document.body.append(halo);

const reveals = new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (entry.isIntersecting) {
      entry.target.classList.add('in-view');
      reveals.unobserve(entry.target);
    }
  }
}, { threshold: 0.05 });
document.querySelectorAll('.reveal').forEach(node => reveals.observe(node));

function resetTilt() {
  poster.style.setProperty('--tilt-x', '0deg');
  poster.style.setProperty('--tilt-y', '0deg');
}
poster.addEventListener('pointermove', event => {
  if (!motion.matches || !precisionPointer.matches) return;
  const box = poster.getBoundingClientRect();
  poster.style.setProperty('--tilt-x', ((0.5 - (event.clientY - box.top) / box.height) * 22) + 'deg');
  poster.style.setProperty('--tilt-y', (((event.clientX - box.left) / box.width - 0.5) * 24) + 'deg');
});
poster.addEventListener('pointerleave', resetTilt);
let reveal;
document.querySelector('#replay').addEventListener('click', () => {
  if (!motion.matches) return;
  reveal?.cancel();
  reveal = poster.animate([
    { clipPath: 'inset(0 32% 0 0)' },
    { clipPath: 'inset(0)' }
  ], { duration: 650, easing: 'ease-out' });
});

let scrollFrame;
function updateParallax() {
  scrollFrame = null;
  poster.style.setProperty('--travel', motion.matches ? Math.min(scrollY * 0.32, 55) + 'px' : '0px');
}
window.addEventListener('scroll', () => {
  if (!scrollFrame && motion.matches) scrollFrame = requestAnimationFrame(updateParallax);
}, { passive: true });
motion.addEventListener('change', () => {
  reveal?.cancel();
  resetTilt();
  updateParallax();
});

document.addEventListener('pointermove', event => {
  if (!motion.matches || !precisionPointer.matches) return;
  halo.style.transform = 'translate(' + event.clientX + 'px,' + event.clientY + 'px)';
  const interactive = event.target.closest('a,button:not(:disabled),select,input,summary,.poster');
  halo.classList.add('active');
  halo.classList.toggle('interactive', Boolean(interactive));
});
document.documentElement.addEventListener('pointerleave', () => halo.classList.remove('active'));
document.addEventListener('keydown', () => halo.classList.remove('active'));
