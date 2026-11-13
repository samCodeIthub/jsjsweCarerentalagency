// weCare shared extras: dark/light switch + contact footer (client & partner pages)
(function () {
  var CONTACT = {
    brand: 'weCare Rental Agency',
    tagline: 'Hostels, apartments & community',
    whatsapp: '0209952614',      // shown as 020 995 2614
    email: ''                    // <- put the business email here
  };

  /* ---------- Dark / light ---------- */
  var css = '' +
  'html[data-theme="dark"]{color-scheme:dark;--surface:#16211F;--bg:#0E1614;--ink:#E7F0ED;--ink-soft:#B6C6C1;--muted:#8CA09A;--border:#27352F;' +
  '--teal-pale:#12302A;--teal-light:#1C4A3F;--amber-pale:#3A2E10;--amber-text:#F0C45A;--red-pale:#3A1A20;--red-text:#F29AA8;--shadow-card:0 1px 3px rgba(0,0,0,.5);--shadow-pop:0 10px 30px rgba(0,0,0,.55)}' +
  'html[data-theme="dark"] input,html[data-theme="dark"] select,html[data-theme="dark"] textarea{background:#1B2A27;color:var(--ink);border-color:var(--border)}' +
  'html[data-theme="dark"] .profile-form input:disabled{background:#14201D;color:#8CA09A}' +
  'html[data-theme="dark"] .profile-stats div,html[data-theme="dark"] .profile-list li{background:var(--bg)}' +
  'html[data-theme="dark"] .profile-stats span,html[data-theme="dark"] .profile-list span{color:var(--muted)}' +
  'html[data-theme="dark"] .cal__cell--has{background:#1C4A3F}' +
  'html[data-theme="dark"] .btn--ghost{color:var(--ink);border-color:var(--border);background:transparent}' +
  '.theme-toggle{width:38px;height:38px;border-radius:50%;border:1px solid var(--border);background:var(--surface);color:var(--ink);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;flex:none;padding:0}' +
  '.theme-toggle:hover{background:var(--teal-pale)}' +
  '.theme-toggle svg{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}' +
  '.theme-toggle .i-sun{display:none}html[data-theme="dark"] .theme-toggle .i-sun{display:block}html[data-theme="dark"] .theme-toggle .i-moon{display:none}' +
  '.wc-footer{margin-top:40px;padding:34px 24px 26px;background:#0B5D4C;color:#E8F5F1;font-family:Poppins,Inter,sans-serif}' +
  '.wc-footer__in{max-width:1000px;margin:0 auto;display:flex;flex-wrap:wrap;gap:28px;justify-content:space-between;align-items:flex-start}' +
  '.wc-footer__brand{display:flex;gap:12px;align-items:center}.wc-footer__brand img{width:54px;height:41px;background:#fff;border-radius:10px;padding:5px}' +
  '.wc-footer__brand b{display:block;font-size:1.05rem;color:#fff}.wc-footer__brand span{font-size:.8rem;letter-spacing:.12em;text-transform:uppercase;color:#BFE3D8}' +
  '.wc-footer h4{font-size:.8rem;letter-spacing:.12em;text-transform:uppercase;color:#BFE3D8;margin-bottom:10px;font-weight:600}' +
  '.wc-footer__links{display:flex;flex-wrap:wrap;gap:10px}' +
  '.wc-footer__links a{display:inline-flex;align-items:center;gap:8px;padding:9px 16px;border-radius:999px;background:rgba(255,255,255,.12);color:#fff;text-decoration:none;font-size:.9rem;font-weight:500}' +
  '.wc-footer__links a:hover{background:rgba(255,255,255,.22)}.wc-footer__links a.wa{background:#25D366;color:#073B1D;font-weight:600}' +
  '.wc-footer__copy{max-width:1000px;margin:22px auto 0;padding-top:16px;border-top:1px solid rgba(255,255,255,.18);font-size:.78rem;color:#BFE3D8;text-align:center}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  function applyTheme(t) { document.documentElement.setAttribute('data-theme', t); }
  var theme = 'light';
  try { theme = localStorage.getItem('wecareTheme') || 'light'; } catch (e) {}
  applyTheme(theme);

  function mountToggle() {
    var btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'theme-toggle'; btn.setAttribute('aria-label', 'Switch light / dark mode'); btn.title = 'Light / dark mode';
    btn.innerHTML = '<svg class="i-moon" viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>' +
      '<svg class="i-sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
    btn.addEventListener('click', function () {
      theme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      applyTheme(theme);
      try { localStorage.setItem('wecareTheme', theme); } catch (e) {}
    });
    var logout = document.querySelector('.client-header__user #logoutBtn, .topbar #logoutBtn');
    if (logout) { logout.parentNode.insertBefore(btn, logout); return; }
    var actions = document.querySelector('.topbar__actions');
    if (actions) {
      var av = actions.querySelector('.avatar');
      actions.insertBefore(btn, av || null);
    }
  }

  /* ---------- Contact footer (student & partner pages only) ---------- */
  function mountFooter() {
    if (!document.getElementById('hostelSearch') && !document.getElementById('printPaidBtn')) return;
    var intl = '233' + CONTACT.whatsapp.slice(1);
    var pretty = CONTACT.whatsapp.replace(/^(\d{3})(\d{3})(\d{4})$/, '$1 $2 $3');
    var f = document.createElement('footer');
    f.className = 'wc-footer';
    f.innerHTML =
      '<div class="wc-footer__in">' +
      '<div class="wc-footer__brand"><img src="logo-mark.svg" alt=""><div><b>' + CONTACT.brand + '</b><span>' + CONTACT.tagline + '</span></div></div>' +
      '<div><h4>Contact us</h4><div class="wc-footer__links">' +
      '<a class="wa" href="https://wa.me/' + intl + '" target="_blank" rel="noopener">WhatsApp ' + pretty + '</a>' +
      '<a href="tel:' + CONTACT.whatsapp + '">Call ' + pretty + '</a>' +
      (CONTACT.email ? '<a href="mailto:' + CONTACT.email + '">' + CONTACT.email + '</a>' : '') +
      '</div></div></div>' +
      '<p class="wc-footer__copy">© ' + new Date().getFullYear() + ' ' + CONTACT.brand + '. All rights reserved.</p>';
    var old = document.querySelector('.page-footer');
    if (old) old.replaceWith(f); else document.body.appendChild(f);
  }

  function init() { mountToggle(); mountFooter(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
