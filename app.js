let cur = 1, selProvider = '', hasSig = false;

// ── NAVIGATION ─────────────────────────────────────────────────
function go(n) {
  if (cur === 1 && n === 2) {
    const fn = document.getElementById('mfirst').value.trim();
    const ln = document.getElementById('mlast').value.trim();
    const dob = document.getElementById('mdob').value;
    if (!fn || !ln) { mark('mfirst', !fn); mark('mlast', !ln); return; }
    if (!isValidDate(dob)) { mark('mdob', true); return; }
  }
  document.getElementById('s'+cur).classList.remove('on');
  cur = n;
  document.getElementById('s'+cur).classList.add('on');
  setProg(n);
  window.scrollTo({top:0,behavior:'smooth'});
  // The canvas lives inside step 3 (display:none until shown). getBoundingClientRect
  // returns 0×0 on a hidden element, so the initial resizeCanvas() at load left the
  // canvas with width=0/height=0 on desktop — strokes had nowhere to render.
  if (n === 3) requestAnimationFrame(resizeCanvas);
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

// ── DATE MASK (MM/DD/YYYY, auto-slash) ──────────────────────────
function formatDateMask(digits) {
  digits = digits.replace(/\D/g,'').slice(0,8);
  let out = digits.slice(0,2);
  if (digits.length >= 3) out += '/' + digits.slice(2,4);
  if (digits.length >= 5) out += '/' + digits.slice(4,8);
  return out;
}
function attachDateMask(el) {
  el.addEventListener('input', e => {
    const before = el.value;
    const isDelete = e.inputType && e.inputType.startsWith('delete');
    const formatted = formatDateMask(before);
    el.value = formatted;
    // place caret at end while typing forward
    if (!isDelete) el.setSelectionRange(formatted.length, formatted.length);
  });
  el.addEventListener('paste', e => {
    e.preventDefault();
    const t = (e.clipboardData || window.clipboardData).getData('text');
    el.value = formatDateMask(t);
  });
}
document.querySelectorAll('input[data-mask="date"]').forEach(attachDateMask);

function isValidDate(mmddyyyy) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(mmddyyyy);
  if (!m) return false;
  const [_, mm, dd, yyyy] = m;
  const d = new Date(+yyyy, +mm-1, +dd);
  return d && d.getFullYear() === +yyyy && d.getMonth() === +mm-1 && d.getDate() === +dd;
}
function maskToIso(mmddyyyy) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(mmddyyyy);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : '';
}
function todayMask() {
  const d = new Date();
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return `${mm}/${dd}/${d.getFullYear()}`;
}
document.getElementById('sigdate').value = todayMask();

// ── URL PARAM PREFILL ───────────────────────────────────────────
// Accepts: ?name=John+Smith&dob=01/15/1980&cin=ABC123
//   Also:  ?fn=John&ln=Smith (explicit first/last)
// DOB tolerates MM/DD/YYYY, MM-DD-YYYY, YYYY-MM-DD, M/D/YYYY
function normalizeDob(raw) {
  const s = String(raw).trim();
  let m;
  if ((m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s))) return s;
  if ((m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s))) return `${m[1]}/${m[2]}/${m[3]}`;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) return `${m[2]}/${m[3]}/${m[1]}`;
  if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s)))
    return `${m[1].padStart(2,'0')}/${m[2].padStart(2,'0')}/${m[3]}`;
  return '';
}

(function prefillFromUrl() {
  const p = new URLSearchParams(window.location.search);
  if (![...p.keys()].length) return;

  const name = (p.get('name') || '').trim();
  const fn   = (p.get('fn')   || '').trim();
  const ln   = (p.get('ln')   || '').trim();
  const dob  = (p.get('dob')  || '').trim();
  const cin  = (p.get('cin')  || '').trim();

  if (fn || ln) {
    if (fn) document.getElementById('mfirst').value = fn;
    if (ln) document.getElementById('mlast').value  = ln;
  } else if (name) {
    const parts = name.split(/\s+/);
    document.getElementById('mfirst').value = parts[0] || '';
    document.getElementById('mlast').value  = parts.slice(1).join(' ') || '';
  }

  if (dob) {
    const norm = normalizeDob(dob);
    if (norm) document.getElementById('mdob').value = norm;
  }
  if (cin) document.getElementById('mcin').value = cin;
})();

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
  const dob  = maskToIso(document.getElementById('mdob').value);
  const cin  = document.getElementById('mcin').value;
  const date = maskToIso(document.getElementById('sigdate').value) || maskToIso(todayMask());
  if (!dob) return showErr('Please enter a valid date of birth (MM/DD/YYYY).');
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
  document.getElementById('sigdate').value = todayMask();
  document.querySelectorAll('input[name=c]').forEach(el=>el.checked=false);
  document.querySelectorAll('.pc').forEach(c=>c.classList.remove('sel'));
  selProvider=''; hasSig=false;
  clearSig();
  const sub = document.getElementById('subbtn');
  sub.disabled = false;
  sub.textContent = 'Submit attestation';
  cur=1; go(1);
}
