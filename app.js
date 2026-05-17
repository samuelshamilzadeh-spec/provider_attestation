let cur = 1, selProvider = '', hasSig = false;

// ── NAVIGATION ─────────────────────────────────────────────────
function go(n) {
  if (cur === 1 && n === 2) {
    const fn = document.getElementById('mfirst').value.trim();
    const ln = document.getElementById('mlast').value.trim();
    const dob = document.getElementById('mdob').value;
    if (!fn || !ln) { mark('mfirst', !fn); mark('mlast', !ln); return; }
    if (!dob) { mark('mdob', true); return; }
  }
  document.getElementById('s'+cur).classList.remove('on');
  cur = n;
  document.getElementById('s'+cur).classList.add('on');
  setProg(n);
  window.scrollTo({top:0,behavior:'smooth'});
}

function mark(id, bad) {
  const el = document.getElementById(id);
  el.classList.toggle('err', bad);
  el.addEventListener('input', () => el.classList.remove('err'), {once:true});
}

function setProg(n) {
  for (let i=1;i<=3;i++){
    const d=document.getElementById('d'+i), l=document.getElementById('l'+i);
    d.className='pdot'+(i===n?' on':i<n?' dn':'');
    d.textContent=i<n?'✓':i;
    l.className='plbl'+(i===n?' on':'');
  }
}

// ── PROVIDER PICKER ─────────────────────────────────────────────
function selProv(el, name) {
  document.querySelectorAll('.pc').forEach(c=>c.classList.remove('sel'));
  el.classList.add('sel');
  selProvider = name;
}

// ── SIGNATURE PAD ───────────────────────────────────────────────
const canvas = document.getElementById('sigpad');
const ctx = canvas.getContext('2d');

function resizeCanvas() {
  const r = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(r.width * dpr);
  canvas.height = Math.round(r.height * dpr);
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.strokeStyle = '#183866';
  ctx.lineWidth = 1.8;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}
resizeCanvas();
window.addEventListener('resize', () => {
  resizeCanvas();
  hasSig = false;
  document.getElementById('sighint').style.opacity='1';
});

let drawing = false;

function getPos(e) {
  const r = canvas.getBoundingClientRect();
  const src = e.touches ? e.touches[0] : e;
  return {x: src.clientX - r.left, y: src.clientY - r.top};
}
canvas.addEventListener('mousedown', e=>{drawing=true;const p=getPos(e);ctx.beginPath();ctx.moveTo(p.x,p.y)});
canvas.addEventListener('mousemove', e=>{if(!drawing)return;hasSig=true;document.getElementById('sighint').style.opacity='0';const p=getPos(e);ctx.lineTo(p.x,p.y);ctx.stroke()});
canvas.addEventListener('mouseup', ()=>drawing=false);
canvas.addEventListener('mouseleave', ()=>drawing=false);
canvas.addEventListener('touchstart', e=>{e.preventDefault();drawing=true;const p=getPos(e);ctx.beginPath();ctx.moveTo(p.x,p.y)}, {passive:false});
canvas.addEventListener('touchmove', e=>{e.preventDefault();if(!drawing)return;hasSig=true;document.getElementById('sighint').style.opacity='0';const p=getPos(e);ctx.lineTo(p.x,p.y);ctx.stroke()}, {passive:false});
canvas.addEventListener('touchend', ()=>drawing=false);
canvas.addEventListener('touchcancel', ()=>drawing=false);

function clearSig(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  hasSig=false;
  document.getElementById('sighint').style.opacity='1';
}

document.getElementById('sigdate').valueAsDate = new Date();

// ── ERROR HANDLING ──────────────────────────────────────────────
function showErr(msg){const e=document.getElementById('errmsg');e.textContent=msg;e.style.display='block';e.scrollIntoView({behavior:'smooth',block:'center'})}
function clearErr(){document.getElementById('errmsg').style.display='none'}

// ── SUBMIT ──────────────────────────────────────────────────────
async function doSubmit() {
  clearErr();
  if (!selProvider) return showErr('Please select a provider before submitting.');
  if (!hasSig) return showErr('Provider signature is required.');

  const firstName = document.getElementById('mfirst').value.trim();
  const lastName  = document.getElementById('mlast').value.trim();
  const memberName = (firstName+' '+lastName).trim();
  const dob  = document.getElementById('mdob').value;
  const cin  = document.getElementById('mcin').value;
  const date = document.getElementById('sigdate').value;
  const checked = [...document.querySelectorAll('input[name=c]:checked')].map(el=>el.value);
  const signature = canvas.toDataURL('image/png');

  const btn = document.getElementById('subbtn');
  btn.disabled = true;
  btn.textContent = 'Submitting…';

  try {
    const res = await fetch('/api/submit', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({memberName, firstName, lastName, dob, cin, criteria: checked, provider: selProvider, date, signature})
    });
    const data = await res.json().catch(()=>({error:'Invalid server response'}));
    if (!res.ok || data.error) throw new Error(data.error || 'Submission failed');

    document.getElementById('s3').classList.remove('on');
    document.getElementById('sok').classList.add('on');
    window.scrollTo({top:0,behavior:'smooth'});

  } catch(err) {
    showErr('Submission failed: ' + err.message);
    btn.disabled = false;
    btn.textContent = 'Submit attestation';
  }
}

// ── RESET ────────────────────────────────────────────────────────
function reset() {
  document.getElementById('sok').classList.remove('on');
  document.querySelectorAll('input[type=text],input[type=date]').forEach(el=>el.value='');
  document.querySelectorAll('input[name=c]').forEach(el=>el.checked=false);
  document.querySelectorAll('.pc').forEach(c=>c.classList.remove('sel'));
  selProvider=''; hasSig=false;
  clearSig();
  document.getElementById('sigdate').valueAsDate=new Date();
  const sub = document.getElementById('subbtn');
  sub.disabled = false;
  sub.textContent = 'Submit attestation';
  cur=1; go(1);
}
