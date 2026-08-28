// =========================================================
// weCare Admin — script.js
// Sidebar toggle, table search, and quick-add form handling
// =========================================================

document.addEventListener('DOMContentLoaded', () => {
  initSidebar();
  initTableSearch();
  initQuickAddForm();
  initAddHostelShortcut();
  initHostelSearch();
  initAddHostelForm();
  initFileDrop();
});

/* ---------------------------------------------------------
   1. Mobile sidebar (hamburger menu + scrim)
--------------------------------------------------------- */
function initSidebar() {
  const sidebar = document.getElementById('sidebar');
  const menuBtn = document.getElementById('menuBtn');
  const scrim = document.getElementById('scrim');

  if (!sidebar || !menuBtn || !scrim) return;

  const openSidebar = () => {
    sidebar.classList.add('is-open');
    scrim.classList.add('is-visible');
    menuBtn.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden'; // lock background scroll
  };

  const closeSidebar = () => {
    sidebar.classList.remove('is-open');
    scrim.classList.remove('is-visible');
    menuBtn.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  };

  const toggleSidebar = () => {
    sidebar.classList.contains('is-open') ? closeSidebar() : openSidebar();
  };

  menuBtn.addEventListener('click', toggleSidebar);
  scrim.addEventListener('click', closeSidebar);

  // Close with Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidebar.classList.contains('is-open')) {
      closeSidebar();
      menuBtn.focus();
    }
  });

  // Close the sidebar after choosing a nav link (mobile only)
  sidebar.querySelectorAll('.nav__link').forEach((link) => {
    link.addEventListener('click', () => {
      if (window.innerWidth <= 980) closeSidebar();
    });
  });

  // If the viewport grows past the mobile breakpoint, reset any open state
  window.addEventListener('resize', () => {
    if (window.innerWidth > 980) closeSidebar();
  });
}

/* ---------------------------------------------------------
   2. Live search over the inventory table
--------------------------------------------------------- */
function initTableSearch() {
  const searchInput = document.querySelector('.search input');
  const table = document.querySelector('.table');
  if (!searchInput || !table) return;

  const rows = () => table.querySelectorAll('tbody tr');

  searchInput.addEventListener('input', () => {
    const query = searchInput.value.trim().toLowerCase();

    rows().forEach((row) => {
      const hostel = row.children[0]?.textContent.toLowerCase() || '';
      const roomType = row.children[1]?.textContent.toLowerCase() || '';
      const matches = hostel.includes(query) || roomType.includes(query);
      row.style.display = matches ? '' : 'none';
    });
  });
}

/* ---------------------------------------------------------
   3. Quick Add: New Room Type — adds a row to the table
--------------------------------------------------------- */
function initQuickAddForm() {
  const form = document.getElementById('quickAddForm');
  const table = document.querySelector('.table tbody');
  if (!form || !table) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();

    const hostel = form.hostel.value;
    const capacity = form.capacity.value; // "1" | "2" | "4"
    const price = form.price.value.trim();
    const totalRooms = form.totalRooms.value.trim();

    if (!price || !totalRooms) {
      flashInvalid(form.price.closest('.field').querySelector('input, .input-prefix'));
      flashInvalid(form.totalRooms);
      return;
    }

    const capacityLabel = `${capacity}-in-a-room`;
    const studentsLabel = capacity === '1' ? '1 student' : `${capacity} students`;
    const formattedPrice = `GHS ${Number(price).toLocaleString('en-US')}`;

    const row = buildRow({
      hostel,
      roomType: capacityLabel,
      capacity: studentsLabel,
      price: formattedPrice,
      status: 'available', // new room types start out available
    });

    table.prepend(row);
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    flashSuccess(row);

    form.reset();
    form.hostel.focus();
  });
}

function buildRow({ hostel, roomType, capacity, price, status }) {
  const statusMap = {
    available: { pillClass: 'pill--available', label: 'Available' },
    full: { pillClass: 'pill--full', label: 'Full' },
    warning: { pillClass: 'pill--warning', label: '1 Spot Left' },
  };
  const { pillClass, label } = statusMap[status] || statusMap.available;

  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td data-label="Hostel">${hostel}</td>
    <td data-label="Room Type">${roomType}</td>
    <td data-label="Capacity">${capacity}</td>
    <td data-label="Price">${price}</td>
    <td data-label="Status"><span class="pill ${pillClass}">${label}</span></td>
    <td data-label="Actions" class="table__actions">
      <button class="link-btn" type="button">Edit</button>
      <button class="link-btn link-btn--danger" type="button">Remove</button>
    </td>
  `;

  return tr;
}

// Event delegation so Edit/Remove work for table rows AND hostel cards,
// including ones added dynamically after page load
document.addEventListener('click', (e) => {
  const removeBtn = e.target.closest('.link-btn--danger');
  if (removeBtn) {
    const row = removeBtn.closest('tr');
    const card = removeBtn.closest('.hostel-card');
    const target = row || card;
    const confirmText = card ? 'Remove this hostel from your portfolio?' : 'Remove this room type from the inventory?';

    if (target && confirm(confirmText)) {
      target.style.transition = 'opacity 0.2s ease';
      target.style.opacity = '0';
      setTimeout(() => target.remove(), 200);
    }
    return;
  }

  const editBtn = e.target.closest('.link-btn:not(.link-btn--danger)');
  if (editBtn && (editBtn.closest('.table__actions') || editBtn.closest('.hostel-card__actions'))) {
    const row = editBtn.closest('tr');
    const card = editBtn.closest('.hostel-card');
    const name = row?.children[0]?.textContent || card?.querySelector('h3')?.textContent || 'this item';
    alert(`Editing "${name}" — hook this up to your edit flow.`);
  }
});

function flashInvalid(el) {
  if (!el) return;
  el.style.transition = 'box-shadow 0.15s ease';
  el.style.boxShadow = '0 0 0 3px rgba(209, 73, 91, 0.35)';
  el.focus();
  setTimeout(() => { el.style.boxShadow = ''; }, 1200);
}

function flashSuccess(row) {
  row.style.transition = 'background-color 0.6s ease';
  row.style.backgroundColor = '#F0F9F6';
  setTimeout(() => { row.style.backgroundColor = ''; }, 900);
}

/* ---------------------------------------------------------
   5. Hostels page — search hostel cards
--------------------------------------------------------- */
function initHostelSearch() {
  const searchInput = document.querySelector('.search input');
  const grid = document.querySelector('.hostel-grid');
  if (!searchInput || !grid) return;

  searchInput.addEventListener('input', () => {
    const query = searchInput.value.trim().toLowerCase();
    grid.querySelectorAll('.hostel-card').forEach((card) => {
      const name = card.querySelector('h3')?.textContent.toLowerCase() || '';
      const meta = card.querySelector('.hostel-card__meta')?.textContent.toLowerCase() || '';
      const matches = name.includes(query) || meta.includes(query);
      card.style.display = matches ? '' : 'none';
    });
  });
}

/* ---------------------------------------------------------
   6. Hostels page — "Add New Hostel" jump + form submission
--------------------------------------------------------- */
function initAddHostelShortcutLink() {
  const link = document.getElementById('openAddHostelBtn');
  const panel = document.getElementById('add-hostel');
  if (!link || !panel) return;

  link.addEventListener('click', (e) => {
    e.preventDefault();
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    panel.querySelector('#hostelName')?.focus();
  });
}

function initAddHostelForm() {
  initAddHostelShortcutLink();

  const form = document.getElementById('addHostelForm');
  const grid = document.querySelector('.hostel-grid');
  if (!form || !grid) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();

    const name = form.hostelName.value.trim();
    const location = form.hostelLocation.value.trim();
    const status = form.hostelStatus.value; // "active" | "draft"
    const rooms = form.hostelRooms.value.trim();

    if (!name || !location) {
      flashInvalid(form.hostelName);
      flashInvalid(form.hostelLocation);
      return;
    }

    const card = buildHostelCard({ name, location, status, rooms });
    grid.prepend(card);
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    flashCardSuccess(card);

    form.reset();
    resetFileDropLabel();
  });
}

function buildHostelCard({ name, location, status, rooms }) {
  const statusMap = {
    active: { coverClass: 'hostel-card__cover--teal', pillClass: 'pill--available', label: 'Active' },
    draft: { coverClass: 'hostel-card__cover--muted', pillClass: 'pill--draft', label: 'Draft' },
  };
  const { coverClass, pillClass, label } = statusMap[status] || statusMap.active;
  const statsText = rooms ? `${rooms} rooms · 1 room type` : 'Not yet published';

  const article = document.createElement('article');
  article.className = 'hostel-card';
  article.innerHTML = `
    <div class="hostel-card__cover ${coverClass}">
      <span class="pill ${pillClass}">${label}</span>
      <svg class="hostel-card__photo-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M21 16l-5-4-4 3-3-2-4 3"/></svg>
    </div>
    <div class="hostel-card__body">
      <h3></h3>
      <p class="hostel-card__meta"></p>
      <p class="hostel-card__stats">${statsText}</p>
    </div>
    <div class="hostel-card__actions">
      <button class="link-btn" type="button">Edit</button>
      <button class="link-btn link-btn--danger" type="button">Remove</button>
    </div>
  `;
  // Set text via textContent (not innerHTML) to avoid any markup injection from form input
  article.querySelector('h3').textContent = name;
  article.querySelector('.hostel-card__meta').textContent = location;

  return article;
}

function flashCardSuccess(card) {
  card.style.transition = 'box-shadow 0.6s ease';
  card.style.boxShadow = '0 0 0 3px rgba(14, 140, 115, 0.35)';
  setTimeout(() => { card.style.boxShadow = ''; }, 900);
}

/* ---------------------------------------------------------
   7. Hostels page — drag-and-drop styling for the photo field
--------------------------------------------------------- */
function initFileDrop() {
  const dropLabel = document.querySelector('.file-drop');
  const fileInput = document.getElementById('hostelPhoto');
  if (!dropLabel || !fileInput) return;

  ['dragenter', 'dragover'].forEach((evt) => {
    dropLabel.addEventListener(evt, (e) => {
      e.preventDefault();
      dropLabel.classList.add('is-dragover');
    });
  });

  ['dragleave', 'drop'].forEach((evt) => {
    dropLabel.addEventListener(evt, (e) => {
      e.preventDefault();
      dropLabel.classList.remove('is-dragover');
    });
  });

  dropLabel.addEventListener('drop', (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file) {
      fileInput.files = e.dataTransfer.files;
      updateFileDropLabel(file.name);
    }
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) updateFileDropLabel(file.name);
  });
}

function updateFileDropLabel(fileName) {
  const textEl = document.querySelector('.file-drop span');
  if (textEl) textEl.innerHTML = `<b>${fileName}</b> selected — click to change`;
}

function resetFileDropLabel() {
  const textEl = document.querySelector('.file-drop span');
  if (textEl) textEl.innerHTML = '<b>Click to upload</b> or drag a photo here';
}

/* ---------------------------------------------------------
   4. "Add New Hostel" button — jumps to the quick-add panel
   (Swap this for a modal/dedicated page later if you build one)
--------------------------------------------------------- */
function initAddHostelShortcut() {
  const btn = document.getElementById('addHostelBtn');
  const form = document.getElementById('quickAddForm');
  if (!btn || !form) return;

  btn.addEventListener('click', () => {
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    form.hostel.focus();
  });
}