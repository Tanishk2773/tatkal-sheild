// A layered travel-poster scene. Coordinates are in poster space so the
// locomotive, wheels and contact wire keep their proportions at any size.
const canvas = document.querySelector('#landscape');
const ctx = canvas.getContext('2d');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const width = 760;
const height = 390;
let frame;

function rect(x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}
function circle(x, y, radius, color) {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}
function shape(points, color, stroke = false, weight = 1) {
  ctx.beginPath();
  points.forEach(([x,y], index) => index ? ctx.lineTo(x,y) : ctx.moveTo(x,y));
  if (stroke) {
    ctx.strokeStyle = color;
    ctx.lineWidth = weight;
    ctx.stroke();
  } else {
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }
}
function carriage(x) {
  rect(x,197,146,44,'#dfd2a5');
  rect(x+2,193,142,5,'#526464');
  rect(x,225,146,5,'#be542e');
  rect(x,235,146,9,'#30474b');
  for(let i=0;i<9;i++) {
    rect(x+9+i*15,204,10,11,'#27464d');
    rect(x+10+i*15,205,4,7,'#87aaa2');
  }
  for(const offset of [16,29,116,129]) circle(x+offset,245,6,'#172e33');
}
function express(offset) {
  ctx.save();
  ctx.translate(offset,0);
  for(let x=-188;x<420;x+=153) carriage(x);
  shape([[425,200],[439,187],[519,187],[548,202],[575,228],[574,240],[425,240]],'#e7dec2');
  shape([[435,202],[448,191],[516,191],[537,203],[512,206]],'#294851');
  shape([[517,207],[542,205],[555,218],[530,217]],'#294851');
  shape([[425,220],[512,223],[570,232],[575,235],[574,239],[425,230]],'#c6512f');
  rect(428,234,88,7,'#83908a');
  for(const x of [439,452,529,542]) circle(x,245,6,'#203537');
  for(let i=0;i<7;i++) rect(438+i*5,210,2,8,'#697d75');
  rect(564,224,6,3,'#fff4c8');
  shape([[450,186],[475,174],[493,184],[472,185]],'#374a49',true,2);
  rect(467,172,21,2,'#374a49');
  ctx.restore();
}
function landscape(progress) {
  const sky=ctx.createLinearGradient(0,0,0,height);
  sky.addColorStop(0,'#93b6b3');
  sky.addColorStop(.52,'#f4cf9e');
  sky.addColorStop(1,'#e9ab79');
  rect(0,0,width,height,sky);
  circle(550,100,55,'#ffe4ad');
  for (const [x,y] of [[114,64],[132,56],[151,63],[610,89]]) {
    shape([[x-5,y-2],[x,y],[x+5,y-3]],'#536e6b',true,1.5);
  }
  shape([[0,131],[80,142],[173,87],[225,117],[252,104],[314,147],[395,115],[433,122],[493,86],[530,92],[610,147],[684,109],[760,139],[760,390],[0,390]],'#9da99a');
  shape([[0,131],[80,173],[170,140],[226,157],[279,141],[334,180],[400,160],[435,167],[540,119],[578,131],[610,124],[677,157],[760,126],[760,390],[0,390]],'#708e83');
  shape([[0,181],[85,164],[159,184],[231,173],[325,212],[421,202],[512,171],[571,185],[653,158],[760,177],[760,390],[0,390]],'#466f68');
  shape([[0,241],[138,215],[241,227],[365,255],[452,235],[546,240],[675,204],[760,220],[760,390],[0,390]],'#315c56');
  // Cut the arch openings into the silhouette with a single continuous path.
  ctx.fillStyle='#273e40';
  ctx.beginPath(); ctx.moveTo(-10,251); ctx.lineTo(790,251); ctx.lineTo(790,390);
  for(let x=780;x>-10;x-=100) {
    ctx.lineTo(x,390); ctx.lineTo(x,320);
    ctx.bezierCurveTo(x,255,x-77,255,x-77,320); ctx.lineTo(x-77,390);
  }
  ctx.lineTo(-10,390); ctx.closePath(); ctx.fill();
  rect(0,249,width,6,'#192e32');
  rect(0,256,width,3,'#ad9774');
  for (const x of [70,334,658]) {
    rect(x,139,3,110,'#405957');
    shape([[x,151],[x+32,168],[x,164]],'#405957',true,1.4);
  }
  shape([[0,159],[102,168],[230,175],[366,168],[500,176],[690,168],[760,171]],'#4b6260',true,1);
  express(-740*Math.pow(1-progress,2.4));
  shape([[0,330],[48,338],[104,321],[176,345],[254,355],[344,349],[453,379],[533,362],[628,355],[711,320],[760,305],[760,390],[0,390]],'#1c4743');
  for(let i=0;i<43;i++) {
    const x=(i*127)%800-20, y=365+Math.sin(x*.013)*14;
    shape([[x-10,y+7],[x,y-18-i%12],[x+11,y+7]],'#153936');
  }
  rect(0,385,width,5,'#153936');
}
function resize() {
  const scale = Math.min(window.devicePixelRatio || 1,2) * canvas.clientWidth / width;
  canvas.width=Math.max(1,Math.round(width*scale));
  canvas.height=Math.max(1,Math.round(height*scale));
  ctx.setTransform(canvas.width/width,0,0,canvas.height/height,0,0);
  landscape(1);
}
function arrive() {
  cancelAnimationFrame(frame);
  if (reducedMotion.matches) return landscape(1);
  const start=performance.now();
  function animate(now) {
    const progress=Math.min(1,(now-start)/3600);
    landscape(progress);
    if(progress<1) frame=requestAnimationFrame(animate);
  }
  frame=requestAnimationFrame(animate);
}
resize();
window.addEventListener('resize',resize);
new ResizeObserver(resize).observe(canvas);
reducedMotion.addEventListener('change',arrive);
document.querySelector('#replay').addEventListener('click',arrive);
arrive();
