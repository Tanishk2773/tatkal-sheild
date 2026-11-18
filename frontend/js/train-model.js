const section = document.querySelector('.model-section');
const world = section.querySelector('.model-world');
const stage = section.querySelector('.model-stage');
const train = section.querySelector('.model-consist');
const angle = document.querySelector('#model-angle');
const motion = matchMedia('(prefers-reduced-motion: reduce)');
let arrival;

angle.addEventListener('input', () => {
  world.style.setProperty('--angle', angle.value + 'deg');
  stage.style.setProperty('--scenery-shift', motion.matches ? '0px' : (Number(angle.value) + 24) * -.44 + 'px');
});

function arrive() {
  arrival?.cancel();
  if (motion.matches) return;
  arrival = train.animate([
    { transform: 'translateX(-660px)' },

    { transform: 'translateX(0)' }
  ], { duration: 2700, easing: 'cubic-bezier(.19,.68,.23,1)' });
}

const observer = new IntersectionObserver(([entry]) => {
  if (!entry.isIntersecting) return;
  observer.disconnect();
  arrive();
}, { threshold: .3 });
observer.observe(stage);
document.querySelector('#model-replay').addEventListener('click', () => {
  observer.disconnect();
  arrive();
});
motion.addEventListener('change', () => {
  if (motion.matches) {
    arrival?.cancel();
    stage.style.removeProperty('--scenery-shift');
  }
});


