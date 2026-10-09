// Small DOM helpers: escaping, bottom sheets (with Android back-button support) and toasts.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------- sheets
//
// Sheets stack on top of each other. While any sheet is open there is exactly
// one extra history entry, so the Android back button/gesture closes the top
// sheet instead of leaving the app.

const stack = [];
let pendingBacks = 0;

window.addEventListener('popstate', () => {
  if (pendingBacks) {
    pendingBacks--;
    if (!pendingBacks && stack.length) history.pushState({ sheet: 1 }, '');
    return;
  }
  if (!stack.length) return;
  removeSheet(stack[stack.length - 1]);
  if (stack.length) history.pushState({ sheet: 1 }, '');
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && stack.length) closeSheet(stack[stack.length - 1]);
});

/**
 * Opens a bottom sheet.
 *   title: string | () => string
 *   body:  () => html string, or null to close the sheet (e.g. its project was deleted)
 *   mount: (bodyEl, sheet) => void   — wire up form controls after each render
 *   live:  re-render whenever data changes (for read-only sheets; forms keep their input).
 *          May be a function, checked before each refresh.
 */
export function openSheet({ title, body, mount, live = false, className = '' }) {
  const el = document.createElement('div');
  el.className = `sheet-wrap ${className}`;
  el.innerHTML = `
    <div class="sheet-backdrop" data-sheet-close></div>
    <section class="sheet" role="dialog" aria-modal="true">
      <header class="sheet-h">
        <h2></h2>
        <button class="icon-btn" data-sheet-close aria-label="Close">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
        </button>
      </header>
      <div class="sheet-body"></div>
    </section>`;
  const sheet = {
    el, title, body, mount, live,
    bodyEl: el.querySelector('.sheet-body'),
    close: () => closeSheet(sheet),
    refresh: () => stack.includes(sheet) && renderSheet(sheet),
  };
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-sheet-close]')) sheet.close();
  });

  if (!stack.length && !pendingBacks) history.pushState({ sheet: 1 }, '');
  stack.push(sheet);
  document.getElementById('sheets').append(el);
  document.body.classList.add('has-sheet');
  if (!renderSheet(sheet)) return sheet;
  requestAnimationFrame(() => el.classList.add('open'));
  return sheet;
}

function renderSheet(sheet) {
  const html = sheet.body();
  if (html == null) {
    closeSheet(sheet);
    return false;
  }
  sheet.el.querySelector('.sheet-h h2').textContent = typeof sheet.title === 'function' ? sheet.title() : sheet.title;
  sheet.el.querySelector('.sheet').setAttribute('aria-label', sheet.el.querySelector('.sheet-h h2').textContent);
  sheet.bodyEl.innerHTML = html;
  sheet.mount?.(sheet.bodyEl, sheet);
  return true;
}

export function refreshSheets() {
  for (const s of [...stack]) {
    if (stack.includes(s) && (typeof s.live === 'function' ? s.live() : s.live)) renderSheet(s);
  }
}

export function closeSheet(sheet) {
  if (!stack.includes(sheet)) return;
  removeSheet(sheet);
  if (!stack.length) {
    pendingBacks++;
    history.back();
  }
}

export const closeAllSheets = () => [...stack].reverse().forEach(closeSheet);

function removeSheet(sheet) {
  stack.splice(stack.indexOf(sheet), 1);
  sheet.el.classList.remove('open');
  sheet.el.classList.add('closing');
  setTimeout(() => sheet.el.remove(), 220);
  if (!stack.length) document.body.classList.remove('has-sheet');
}

/** A small confirmation sheet. Resolves true/false. */
export function confirmSheet({ title, message, confirm = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    const s = openSheet({
      title,
      className: 'sheet-compact',
      body: () => `
        <p class="confirm-msg">${esc(message)}</p>
        <div class="btn-row">
          <button class="btn" data-answer="no">Cancel</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-answer="yes">${esc(confirm)}</button>
        </div>`,
      mount: (b) => b.querySelectorAll('[data-answer]').forEach((btn) =>
        btn.addEventListener('click', () => {
          answered = true;
          s.close();
          resolve(btn.dataset.answer === 'yes');
        })),
    });
    // Closed by backdrop / back button.
    const obs = new MutationObserver(() => {
      if (!s.el.isConnected || s.el.classList.contains('closing')) {
        obs.disconnect();
        if (!answered) resolve(false);
      }
    });
    obs.observe(s.el, { attributes: true });
  });
}

// ---------------------------------------------------------------- toasts

let toastTimer;

export function toast(message, { action, onAction, duration = 4500 } = {}) {
  const host = document.getElementById('toasts');
  clearTimeout(toastTimer);
  host.innerHTML = `<div class="toast" role="status"><span>${esc(message)}</span>${action ? `<button>${esc(action)}</button>` : ''}</div>`;
  const el = host.firstElementChild;
  requestAnimationFrame(() => el.classList.add('show'));
  el.querySelector('button')?.addEventListener('click', () => {
    onAction?.();
    hide();
  });
  const hide = () => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 200);
  };
  toastTimer = setTimeout(hide, duration);
}
