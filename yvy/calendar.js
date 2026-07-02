// Lightweight vanilla date-picker popup, attached to an existing MM/DD/YYYY text
// input (typing still works). No dependencies, no build step. Matches the app's
// design and enforces per-field rules (min/max, no weekends) directly.
//
//   attachCalendar(inputEl, {
//     locale: 'en' | 'es',
//     min: Date, max: Date,        // inclusive bounds (optional)
//     minYear, maxYear,            // year dropdown range (optional)
//     disableWeekends: boolean,    // grey out Sat/Sun
//     disable: (Date) => boolean   // custom disable predicate
//   })
(function () {
  // Short month labels keep the dropdown compact and legible in both languages
  // regardless of the rendered font.
  const MONTHS = {
    en: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
    es: ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
  };
  const DOW = { en: ['Su','Mo','Tu','We','Th','Fr','Sa'], es: ['Do','Lu','Ma','Mi','Ju','Vi','Sa'] };

  const pad = (n) => String(n).padStart(2, '0');
  const mask = (d) => `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`;
  function parseMask(v) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v || '');
    if (!m) return null;
    const d = new Date(+m[3], +m[1] - 1, +m[2]);
    return (d.getFullYear() === +m[3] && d.getMonth() === +m[1] - 1 && d.getDate() === +m[2]) ? d : null;
  }
  const sameDay = (a, b) => a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  window.attachCalendar = function (input, opts) {
    opts = opts || {};
    const locale = opts.locale === 'es' ? 'es' : 'en';
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const minYear = opts.minYear || (opts.min ? opts.min.getFullYear() : 1900);
    const maxYear = opts.maxYear || (opts.max ? opts.max.getFullYear() : today.getFullYear() + 2);

    const disabled = (d) => {
      if (opts.min && d < opts.min) return true;
      if (opts.max && d > opts.max) return true;
      if (opts.disableWeekends && (d.getDay() === 0 || d.getDay() === 6)) return true;
      if (opts.disable && opts.disable(d)) return true;
      return false;
    };

    const ff = input.closest('.ff') || input.parentElement;
    ff.classList.add('has-cal');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'calbtn';
    btn.setAttribute('aria-label', 'Open calendar');
    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/></svg>';
    ff.appendChild(btn);

    const pop = document.createElement('div');
    pop.className = 'calpop';
    pop.style.display = 'none';
    ff.appendChild(pop);

    let view = new Date(today.getFullYear(), today.getMonth(), 1);

    function render() {
      const selected = parseMask(input.value);
      const y = view.getFullYear(), m = view.getMonth();
      const startDow = new Date(y, m, 1).getDay();
      const daysInMonth = new Date(y, m + 1, 0).getDate();

      let monthOpts = '', yearOpts = '';
      MONTHS[locale].forEach((name, i) => { monthOpts += `<option value="${i}"${i === m ? ' selected' : ''}>${name}</option>`; });
      for (let yr = maxYear; yr >= minYear; yr--) yearOpts += `<option value="${yr}"${yr === y ? ' selected' : ''}>${yr}</option>`;

      let cells = '';
      for (let i = 0; i < startDow; i++) cells += '<div class="cald empty"></div>';
      for (let day = 1; day <= daysInMonth; day++) {
        const d = new Date(y, m, day);
        const dis = disabled(d);
        const cls = ['cald', dis ? 'dis' : '', sameDay(d, today) ? 'today' : '', selected && sameDay(d, selected) ? 'sel' : ''].filter(Boolean).join(' ');
        cells += `<button type="button" class="${cls}" data-day="${day}"${dis ? ' disabled' : ''}>${day}</button>`;
      }

      pop.innerHTML =
        `<div class="calhdr">
           <button type="button" class="calnav" data-nav="-1" aria-label="Previous month">&lsaquo;</button>
           <div class="calsel"><select class="calmonth" aria-label="Month">${monthOpts}</select><select class="calyear" aria-label="Year">${yearOpts}</select></div>
           <button type="button" class="calnav" data-nav="1" aria-label="Next month">&rsaquo;</button>
         </div>
         <div class="caldow">${DOW[locale].map(w => `<span>${w}</span>`).join('')}</div>
         <div class="calgrid">${cells}</div>`;
    }

    function outside(e) { if (!ff.contains(e.target)) close(); }
    function open() {
      const d = parseMask(input.value);
      if (d) view = new Date(d.getFullYear(), d.getMonth(), 1);
      render();
      pop.style.display = 'block';
      document.addEventListener('mousedown', outside, true);
    }
    function close() {
      pop.style.display = 'none';
      document.removeEventListener('mousedown', outside, true);
    }

    btn.addEventListener('click', (e) => { e.preventDefault(); pop.style.display === 'none' ? open() : close(); });

    pop.addEventListener('click', (e) => {
      const nav = e.target.closest('[data-nav]');
      if (nav) { view.setMonth(view.getMonth() + Number(nav.dataset.nav)); render(); return; }
      const day = e.target.closest('[data-day]');
      if (day && !day.disabled) {
        const d = new Date(view.getFullYear(), view.getMonth(), Number(day.dataset.day));
        input.value = mask(d);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        close();
      }
    });

    pop.addEventListener('change', (e) => {
      if (e.target.classList.contains('calmonth')) { view.setMonth(Number(e.target.value)); render(); }
      if (e.target.classList.contains('calyear')) { view.setFullYear(Number(e.target.value)); render(); }
    });

    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  };
})();
