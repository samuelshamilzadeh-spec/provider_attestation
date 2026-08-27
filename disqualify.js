/* Shared "patient does not qualify" prompt.
 *
 * Used by both clinician forms — the Stand Out Care form (index.html) and the
 * Yeled V'Yalda visit form (yvy/visit.html) — so the two flows always ask for
 * the same things in the same words. Self-contained: it builds its own DOM on
 * first use and depends only on the .dq-* rules in /style.css, never on
 * yvy.css, which the Stand Out page doesn't load.
 *
 * Served on the partner domain too — see SHARED_PATHS in middleware.js.
 *
 * API (window.PADisqualify):
 *   confirmNoCriteria(opts) -> Promise<'back'|'disqualify'>
 *   open(opts)              -> Promise<boolean>   (true once submitted)
 *     opts.patientName   display only
 *     opts.patientDob    ISO or MM/DD/YYYY, display only
 *     opts.examDate      ISO, prefills the exam-date field
 *     opts.provider      preselects the provider, when the page already knows
 *     opts.providers     array of selectable provider names
 *     opts.recipients    who gets the email, as a phrase ("the office")
 *     opts.submit        async ({provider, examDate, reasonCode, notes}) => any
 *                        throw to show the message in the dialog
 */
(function () {
  'use strict';

  // Mirror of DISQUALIFY_REASONS in lib/disqualify.js — the server re-resolves
  // the code to its own label, so these are for display only. Keep in sync.
  var REASONS = [
    { code: 'no_criteria',  label: 'Does not meet any SCN eligibility criteria' },
    { code: 'declined',     label: 'Patient declined the visit or the service' },
    { code: 'no_show',      label: 'Patient did not show for the scheduled visit' },
    { code: 'unreachable',  label: 'Unable to reach the patient' },
    { code: 'wrong_info',   label: 'Patient information is incorrect or does not match' },
    { code: 'not_enrolled', label: 'Not enrolled in Medicaid / not eligible for SCN services' },
    { code: 'duplicate',    label: 'Duplicate — an attestation already exists for this patient' },
    { code: 'other',        label: 'Other' }
  ];

  var DEFAULT_PROVIDERS = ['Esther Sobel', 'Osnat Cohen', 'Jennifer Kahan'];
  // Who the notification actually reaches differs per flow, so each page says
  // so in its own words rather than the dialog guessing.
  var DEFAULT_RECIPIENTS = 'the office';

  // ── date helpers (kept local so this file drops into either page) ──────────
  function maskDate(v) {
    var d = String(v || '').replace(/\D/g, '').slice(0, 8);
    var o = d.slice(0, 2);
    if (d.length >= 3) o += '/' + d.slice(2, 4);
    if (d.length >= 5) o += '/' + d.slice(4, 8);
    return o;
  }
  function isoToMask(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    return m ? m[2] + '/' + m[3] + '/' + m[1] : String(iso || '');
  }
  function maskToIso(s) {
    var m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s || '').trim());
    if (!m) return '';
    var d = new Date(+m[3], +m[1] - 1, +m[2]);
    if (d.getFullYear() !== +m[3] || d.getMonth() !== +m[1] - 1 || d.getDate() !== +m[2]) return '';
    return m[3] + '-' + m[1] + '-' + m[2];
  }
  function todayMask() {
    var d = new Date();
    return String(d.getMonth() + 1).padStart(2, '0') + '/' +
           String(d.getDate()).padStart(2, '0') + '/' + d.getFullYear();
  }

  // ── overlay plumbing ──────────────────────────────────────────────────────
  var overlay = null, panel = null, onEscape = null, lastFocus = null;

  function ensureOverlay() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.className = 'dq-ov';
    overlay.setAttribute('hidden', '');
    panel = document.createElement('div');
    panel.className = 'dq-modal';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    // Backdrop click cancels, but never a click that started inside the panel
    // (a drag out of a textarea shouldn't discard a half-typed reason).
    overlay.addEventListener('mousedown', function (e) {
      if (e.target === overlay && onEscape) onEscape();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlay && !overlay.hasAttribute('hidden') && onEscape) onEscape();
    });
  }

  function openOverlay(cancelFn) {
    ensureOverlay();
    lastFocus = document.activeElement;
    onEscape = cancelFn;
    overlay.removeAttribute('hidden');
    document.body.classList.add('dq-locked');
  }

  function closeOverlay() {
    if (!overlay) return;
    onEscape = null;
    overlay.setAttribute('hidden', '');
    panel.innerHTML = '';
    document.body.classList.remove('dq-locked');
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
    lastFocus = null;
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // ── 1. "nothing is checked" prompt ────────────────────────────────────────
  function confirmNoCriteria(opts) {
    var recipients = (opts && opts.recipients) || DEFAULT_RECIPIENTS;
    return new Promise(function (resolve) {
      function finish(answer) { closeOverlay(); resolve(answer); }
      openOverlay(function () { finish('back'); });

      panel.appendChild(el('h2', 'dq-title', 'No eligibility criteria are checked'));
      panel.appendChild(el('p', 'dq-sub',
        'An attestation needs at least one criterion. If this member genuinely ' +
        'has none, record why instead — ' + recipients + ' will be notified and ' +
        'no attestation will be signed.'));

      var foot = el('div', 'dq-foot');
      var back = el('button', 'btn', '← Go back and review');
      back.type = 'button';
      back.addEventListener('click', function () { finish('back'); });
      var dq = el('button', 'btn btn-p', 'Patient does not qualify');
      dq.type = 'button';
      dq.addEventListener('click', function () { finish('disqualify'); });
      foot.appendChild(back);
      foot.appendChild(dq);
      panel.appendChild(foot);

      panel.setAttribute('aria-label', 'No eligibility criteria are checked');
      back.focus();
    });
  }

  // ── 2. the reason form ────────────────────────────────────────────────────
  function open(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var busy = false;
      function cancel() { if (!busy) { closeOverlay(); resolve(false); } }
      openOverlay(cancel);

      var recipients = opts.recipients || DEFAULT_RECIPIENTS;
      panel.setAttribute('aria-label', 'Patient does not qualify');
      panel.appendChild(el('h2', 'dq-title', 'Patient does not qualify'));
      panel.appendChild(el('p', 'dq-sub',
        'No attestation will be signed and no PDF will be generated. ' +
        'These details will be emailed to ' + recipients + '.'));

      if (opts.patientName) {
        var who = el('div', 'dq-who');
        who.appendChild(el('strong', null, opts.patientName));
        if (opts.patientDob) who.appendChild(el('span', null, ' · DOB ' + isoToMask(opts.patientDob)));
        panel.appendChild(who);
      }

      var body = el('div', 'dq-body');

      // Provider
      var provWrap = el('div', 'dq-f');
      provWrap.appendChild(el('label', null, 'Provider'));
      var prov = document.createElement('select');
      prov.appendChild(new Option('Select a provider…', ''));
      (opts.providers || DEFAULT_PROVIDERS).forEach(function (name) {
        prov.appendChild(new Option(name, name));
      });
      if (opts.provider) prov.value = opts.provider;
      provWrap.appendChild(prov);
      body.appendChild(provWrap);

      // Exam date
      var dateWrap = el('div', 'dq-f');
      dateWrap.appendChild(el('label', null, 'Exam date'));
      var date = document.createElement('input');
      date.type = 'text';
      date.inputMode = 'numeric';
      date.maxLength = 10;
      date.placeholder = 'MM/DD/YYYY';
      date.value = opts.examDate ? isoToMask(opts.examDate) : todayMask();
      date.addEventListener('input', function (e) {
        var del = e.inputType && e.inputType.indexOf('delete') === 0;
        var f = maskDate(date.value);
        date.value = f;
        if (!del) date.setSelectionRange(f.length, f.length);
      });
      dateWrap.appendChild(date);
      body.appendChild(dateWrap);

      // Reason
      var reasonWrap = el('div', 'dq-f');
      reasonWrap.appendChild(el('label', null, 'Reason the patient does not qualify'));
      var reason = document.createElement('select');
      reason.appendChild(new Option('Select a reason…', ''));
      REASONS.forEach(function (r) { reason.appendChild(new Option(r.label, r.code)); });
      reasonWrap.appendChild(reason);
      body.appendChild(reasonWrap);

      // Notes — required only for "Other", where the note IS the reason.
      var notesWrap = el('div', 'dq-f');
      var notesLabel = el('label', null, 'Additional notes (optional)');
      notesWrap.appendChild(notesLabel);
      var notes = document.createElement('textarea');
      notes.rows = 3;
      notes.maxLength = 2000;
      notes.placeholder = 'Anything the office should know.';
      notesWrap.appendChild(notes);
      body.appendChild(notesWrap);

      reason.addEventListener('change', function () {
        var other = reason.value === 'other';
        notesLabel.textContent = other ? 'Describe the reason' : 'Additional notes (optional)';
        notes.placeholder = other ? 'Why does this patient not qualify?' : 'Anything the office should know.';
        if (other) notes.focus();
      });

      panel.appendChild(body);

      var err = el('div', 'dq-err');
      panel.appendChild(err);
      function showErr(msg) { err.textContent = msg; err.style.display = 'block'; }
      function clearErr() { err.style.display = 'none'; }

      var foot = el('div', 'dq-foot');
      var cancelBtn = el('button', 'btn', 'Cancel');
      cancelBtn.type = 'button';
      cancelBtn.addEventListener('click', cancel);
      var submitBtn = el('button', 'btn btn-p', 'Submit');
      submitBtn.type = 'button';
      foot.appendChild(cancelBtn);
      foot.appendChild(submitBtn);
      panel.appendChild(foot);

      submitBtn.addEventListener('click', async function () {
        if (busy) return;
        clearErr();
        if (!prov.value) return showErr('Please select a provider.');
        var iso = maskToIso(date.value);
        if (!iso) return showErr('Please enter a valid exam date (MM/DD/YYYY).');
        if (!reason.value) return showErr('Please choose a reason.');
        if (reason.value === 'other' && !notes.value.trim()) return showErr('Please describe the reason.');

        busy = true;
        submitBtn.disabled = true;
        cancelBtn.disabled = true;
        submitBtn.textContent = 'Submitting…';
        try {
          await opts.submit({
            provider: prov.value,
            examDate: iso,
            reasonCode: reason.value,
            notes: notes.value.trim()
          });
          closeOverlay();
          resolve(true);
        } catch (e) {
          busy = false;
          submitBtn.disabled = false;
          cancelBtn.disabled = false;
          submitBtn.textContent = 'Submit';
          showErr(e && e.message ? e.message : 'Submission failed.');
        }
      });

      (opts.provider ? reason : prov).focus();
    });
  }

  window.PADisqualify = { REASONS: REASONS, open: open, confirmNoCriteria: confirmNoCriteria };
})();
