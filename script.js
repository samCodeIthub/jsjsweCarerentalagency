// =========================================================
// weCare Admin — script.js
// localStorage-backed data layer: hostels, rooms, and bookings,
// shared across index.html / hostels.html / rooms.html /
// bookings.html. This is a trial/demo data layer — swap the
// storage functions below for real API calls when you move to
// a backend.
// =========================================================

const HOSTELS_KEY = 'wecare_hostels_v1';
const ROOMS_KEY = 'wecare_rooms_v1';
const BOOKINGS_KEY = 'wecare_bookings_v1';

const DEFAULT_HOSTELS = [
  { id: 'h1', name: 'Ambassador Hall', location: 'Near UEW South Campus', status: 'active' },
  { id: 'h2', name: 'Unity Lodge', location: 'Jopps Junction, Winneba', status: 'active' },
  { id: 'h3', name: 'Serene Villa', location: 'Behind UEW North Campus', status: 'active' },
  { id: 'h4', name: 'Peace Hostel', location: 'Taffo Road, Winneba', status: 'active' },
  { id: 'h5', name: 'Golden Gate Hall', location: 'Near UEW Main Gate', status: 'active' },
  { id: 'h6', name: 'Mercy Lodge', location: 'Estate Junction, Winneba', status: 'draft' },
];

const DEFAULT_ROOMS = [
  { id: 'r1', hostel: 'Ambassador Hall', capacity: '2', price: 1800, beds: 40, filled: 31 },
  { id: 'r2', hostel: 'Unity Lodge', capacity: '4', price: 1050, beds: 20, filled: 20 },
  { id: 'r3', hostel: 'Serene Villa', capacity: '1', price: 2600, beds: 8, filled: 3 },
  { id: 'r4', hostel: 'Peace Hostel', capacity: '2', price: 1500, beds: 16, filled: 15 },
  { id: 'r5', hostel: 'Golden Gate Hall', capacity: '4', price: 980, beds: 24, filled: 12 },
  { id: 'r6', hostel: 'Ambassador Hall', capacity: '1', price: 2400, beds: 10, filled: 2 },
];

const DEFAULT_BOOKINGS = [
  { id: 'b1', roomId: 'r1', hostel: 'Ambassador Hall', roomType: '2-in-a-Room', price: 1800, studentName: 'Kwame Owusu', bookedAt: '2026-08-12', status: 'confirmed' },
  { id: 'b2', roomId: 'r1', hostel: 'Ambassador Hall', roomType: '2-in-a-Room', price: 1800, studentName: 'Efua Mensah', bookedAt: '2026-08-14', status: 'confirmed' },
  { id: 'b3', roomId: 'r4', hostel: 'Peace Hostel', roomType: '2-in-a-Room', price: 1500, studentName: 'Yaw Boateng', bookedAt: '2026-08-15', status: 'confirmed' },
  { id: 'b4', roomId: 'r2', hostel: 'Unity Lodge', roomType: '4-in-a-Room', price: 1050, studentName: 'Ama Serwaa', bookedAt: '2026-08-10', status: 'cancelled' },
];

/* ---------------------------------------------------------
   Storage helpers — swap these for real API calls later
--------------------------------------------------------- */
function getHostels() {
  try { return JSON.parse(localStorage.getItem(HOSTELS_KEY)) || []; }
  catch { return []; }
}
function setHostels(list) { localStorage.setItem(HOSTELS_KEY, JSON.stringify(list)); }

function getRooms() {
  try { return JSON.parse(localStorage.getItem(ROOMS_KEY)) || []; }
  catch { return []; }
}
function setRooms(list) { localStorage.setItem(ROOMS_KEY, JSON.stringify(list)); }

function getBookings() {
  try { return JSON.parse(localStorage.getItem(BOOKINGS_KEY)) || []; }
  catch { return []; }
}
function setBookings(list) { localStorage.setItem(BOOKINGS_KEY, JSON.stringify(list)); }

function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function seedDataIfEmpty() {
  if (localStorage.getItem(HOSTELS_KEY) === null) setHostels(DEFAULT_HOSTELS);
  if (localStorage.getItem(ROOMS_KEY) === null) setRooms(DEFAULT_ROOMS);
  if (localStorage.getItem(BOOKINGS_KEY) === null) setBookings(DEFAULT_BOOKINGS);
}

function resetDemoData() {
  localStorage.removeItem(HOSTELS_KEY);
  localStorage.removeItem(ROOMS_KEY);
  localStorage.removeItem(BOOKINGS_KEY);
  seedDataIfEmpty();
  renderCurrentPage();
}

/* ---------------------------------------------------------
   Booking actions — shared by the Rooms page "Book a Bed"
   button and the Bookings page "Record a Booking" form
--------------------------------------------------------- */
function bookRoom(roomId, studentName) {
  const rooms = getRooms();
  const room = rooms.find((r) => r.id === roomId);
  if (!room) return false;
  if (Number(room.filled) >= Number(room.beds)) return false;

  room.filled = Number(room.filled) + 1;
  setRooms(rooms);

  const bookings = getBookings();
  bookings.unshift({
    id: makeId(),
    roomId: room.id,
    hostel: room.hostel,
    roomType: room.capacity === '1' ? '1-in-a-Room' : `${room.capacity}-in-a-Room`,
    price: room.price,
    studentName,
    bookedAt: new Date().toISOString().slice(0, 10),
    status: 'confirmed',
  });
  setBookings(bookings);
  return true;
}

function cancelBooking(bookingId) {
  const bookings = getBookings();
  const booking = bookings.find((b) => b.id === bookingId);
  if (!booking || booking.status === 'cancelled') return;

  booking.status = 'cancelled';
  setBookings(bookings);

  const rooms = getRooms();
  const room = rooms.find((r) => r.id === booking.roomId);
  if (room && Number(room.filled) > 0) {
    room.filled = Number(room.filled) - 1;
    setRooms(rooms);
  }
}

/* ---------------------------------------------------------
   Small shared helpers
--------------------------------------------------------- */
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[m]));
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function roomStatus(room) {
  const beds = Number(room.beds) || 0;
  const filled = Number(room.filled) || 0;
  if (beds > 0 && filled >= beds) {
    return { key: 'full', pillClass: 'pill--full', label: 'Full', barClass: 'room-card__bar--full' };
  }
  if (beds > 0 && filled / beds >= 0.85) {
    return { key: 'warning', pillClass: 'pill--warning', label: '1 Spot Left', barClass: 'room-card__bar--warning' };
  }
  return { key: 'available', pillClass: 'pill--available', label: 'Available', barClass: '' };
}

function roomsForHostel(hostelName, rooms) {
  return rooms.filter((r) => r.hostel === hostelName);
}

/* ---------------------------------------------------------
   Render: Dashboard (index.html)
--------------------------------------------------------- */
function renderDashboard() {
  const tbody = document.getElementById('inventoryBody');
  if (!tbody) return; // not on this page

  const hostels = getHostels();
  const rooms = getRooms();

  const hostelSelect = document.getElementById('hostel');
  if (hostelSelect) {
    const prev = hostelSelect.value;
    hostelSelect.innerHTML = hostels.map((h) => `<option value="${escapeHtml(h.name)}">${escapeHtml(h.name)}</option>`).join('');
    if (hostels.some((h) => h.name === prev)) hostelSelect.value = prev;
  }

  setText('statTotalHostels', hostels.length);
  setText('statTotalRooms', rooms.length);
  setText('statRoomsFull', rooms.filter((r) => roomStatus(r).key === 'full').length);
  setText('statAlmostFull', rooms.filter((r) => roomStatus(r).key === 'warning').length);

  tbody.innerHTML = rooms.length
    ? rooms.map(dashboardRowHtml).join('')
    : `<tr><td colspan="7" class="empty-state">No rooms yet — add one below with Quick Add.</td></tr>`;

  reapplyTableSearch();
}

function dashboardRowHtml(room) {
  const st = roomStatus(room);
  const capacityLabel = `${room.capacity}-in-a-room`;
  const studentsLabel = room.capacity === '1' ? '1 student' : `${room.capacity} students`;

  return `
    <tr data-id="${room.id}">
      <td data-label="Hostel">${escapeHtml(room.hostel)}</td>
      <td data-label="Room Type">${capacityLabel}</td>
      <td data-label="Capacity">${studentsLabel}</td>
      <td data-label="Price">GHS ${Number(room.price).toLocaleString('en-US')}</td>
      <td data-label="Beds">${room.filled} / ${room.beds}</td>
      <td data-label="Status"><span class="pill ${st.pillClass}">${st.label}</span></td>
      <td data-label="Actions" class="table__actions">
        <button class="link-btn" type="button" data-action="edit">Edit</button>
        <button class="link-btn link-btn--danger" type="button" data-action="remove">Remove</button>
      </td>
    </tr>`;
}

function reapplyTableSearch() {
  const input = document.querySelector('.search input');
  const tbody = document.getElementById('inventoryBody');
  if (!input || !tbody) return;
  const q = input.value.trim().toLowerCase();
  tbody.querySelectorAll('tr[data-id]').forEach((row) => {
    const hostel = row.children[0]?.textContent.toLowerCase() || '';
    const type = row.children[1]?.textContent.toLowerCase() || '';
    row.style.display = (!q || hostel.includes(q) || type.includes(q)) ? '' : 'none';
  });
}

/* ---------------------------------------------------------
   Render: Hostels page (hostels.html)
--------------------------------------------------------- */
function renderHostelsPage() {
  const grid = document.getElementById('hostelGrid');
  if (!grid) return; // not on this page

  const hostels = getHostels();
  const rooms = getRooms();

  const activeListings = hostels.filter((h) => h.status === 'active').length;
  const draftListings = hostels.filter((h) => h.status === 'draft').length;
  const fullyBooked = hostels.filter((h) => {
    const hRooms = roomsForHostel(h.name, rooms);
    return hRooms.length > 0 && hRooms.every((r) => roomStatus(r).key === 'full');
  }).length;

  setText('statTotalHostels', hostels.length);
  setText('statActiveListings', activeListings);
  setText('statDraftListings', draftListings);
  setText('statFullyBooked', fullyBooked);

  grid.innerHTML = hostels.length
    ? hostels.map((h) => hostelCardHtml(h, rooms)).join('')
    : `<p class="empty-state">No hostels yet — add your first one above.</p>`;

  reapplyHostelSearch();
}

function hostelCardHtml(hostel, rooms) {
  const hRooms = roomsForHostel(hostel.name, rooms);
  const totalBeds = hRooms.reduce((sum, r) => sum + (Number(r.beds) || 0), 0);
  const fullyBooked = hRooms.length > 0 && hRooms.every((r) => roomStatus(r).key === 'full');

  let coverClass = 'hostel-card__cover--teal';
  let pillClass = 'pill--available';
  let label = 'Active';
  if (hostel.status === 'draft') {
    coverClass = 'hostel-card__cover--muted'; pillClass = 'pill--draft'; label = 'Draft';
  } else if (fullyBooked) {
    coverClass = 'hostel-card__cover--red'; pillClass = 'pill--full'; label = 'Full';
  }

  let statsText;
  if (hRooms.length === 0) {
    statsText = hostel.status === 'draft' ? 'Not yet published' : 'No room types yet';
  } else {
    statsText = `${totalBeds} beds · ${hRooms.length} room type${hRooms.length > 1 ? 's' : ''}`;
  }

  return `
    <article class="hostel-card" data-id="${hostel.id}">
      <div class="hostel-card__cover ${coverClass}">
        <span class="pill ${pillClass}">${label}</span>
        <svg class="hostel-card__photo-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M21 16l-5-4-4 3-3-2-4 3"/></svg>
      </div>
      <div class="hostel-card__body">
        <h3>${escapeHtml(hostel.name)}</h3>
        <p class="hostel-card__meta">${escapeHtml(hostel.location)}</p>
        <p class="hostel-card__stats">${statsText}</p>
      </div>
      <div class="hostel-card__actions">
        <button class="link-btn" type="button" data-action="edit">Edit</button>
        <button class="link-btn link-btn--danger" type="button" data-action="remove">Remove</button>
      </div>
    </article>`;
}

function reapplyHostelSearch() {
  const input = document.querySelector('.search input');
  const grid = document.getElementById('hostelGrid');
  if (!input || !grid) return;
  const q = input.value.trim().toLowerCase();
  grid.querySelectorAll('.hostel-card').forEach((card) => {
    const name = card.querySelector('h3')?.textContent.toLowerCase() || '';
    const meta = card.querySelector('.hostel-card__meta')?.textContent.toLowerCase() || '';
    card.style.display = (!q || name.includes(q) || meta.includes(q)) ? '' : 'none';
  });
}

/* ---------------------------------------------------------
   Render: Rooms page (rooms.html)
--------------------------------------------------------- */
function renderRoomsPage() {
  const grid = document.getElementById('roomGrid');
  if (!grid) return; // not on this page

  const hostels = getHostels();
  const rooms = getRooms();

  const roomSelect = document.getElementById('roomHostel');
  if (roomSelect) {
    const prev = roomSelect.value;
    roomSelect.innerHTML = hostels.map((h) => `<option value="${escapeHtml(h.name)}">${escapeHtml(h.name)}</option>`).join('');
    if (hostels.some((h) => h.name === prev)) roomSelect.value = prev;
  }

  const totalBeds = rooms.reduce((s, r) => s + (Number(r.beds) || 0), 0);
  const bedsFilled = rooms.reduce((s, r) => s + (Number(r.filled) || 0), 0);
  const roomTypesFull = rooms.filter((r) => roomStatus(r).key === 'full').length;

  setText('statRoomTypes', rooms.length);
  setText('statTotalBeds', totalBeds);
  setText('statBedsFilled', bedsFilled);
  setText('statRoomTypesFull', roomTypesFull);

  grid.innerHTML = rooms.length
    ? rooms.map(roomCardHtml).join('')
    : `<p class="empty-state">No room types yet — add one above.</p>`;

  reapplyRoomFilterAndSearch();
}

function roomCardHtml(room) {
  const st = roomStatus(room);
  const beds = Number(room.beds) || 0;
  const filled = Number(room.filled) || 0;
  const pct = beds ? Math.round((filled / beds) * 100) : 0;
  const title = room.capacity === '1' ? '1-in-a-Room · Private' : `${room.capacity}-in-a-Room · Shared`;
  const isFull = st.key === 'full';

  return `
    <article class="room-card" data-id="${room.id}" data-capacity="${room.capacity}">
      <div class="room-card__top">
        <span class="pill ${st.pillClass}">${st.label}</span>
        <span class="room-card__cap">${room.capacity} / room</span>
      </div>
      <h3>${title}</h3>
      <p class="room-card__hostel">${escapeHtml(room.hostel)}</p>
      <div class="room-card__occupancy">
        <div class="room-card__bar ${st.barClass}"><span style="width:${pct}%"></span></div>
        <p>${filled} / ${beds} beds filled</p>
      </div>
      <p class="room-card__price">GHS ${Number(room.price).toLocaleString('en-US')} <span>/ semester</span></p>
      <div class="room-card__actions-row">
        <button class="link-btn link-btn--book" type="button" data-action="book" ${isFull ? 'disabled' : ''}>
          ${isFull ? 'Fully Booked' : '+ Book a Bed'}
        </button>
        <div>
          <button class="link-btn" type="button" data-action="edit">Edit</button>
          <button class="link-btn link-btn--danger" type="button" data-action="remove">Remove</button>
        </div>
      </div>
    </article>`;
}

function reapplyRoomFilterAndSearch() {
  const grid = document.getElementById('roomGrid');
  if (!grid) return;
  const input = document.querySelector('.search input');
  const q = input ? input.value.trim().toLowerCase() : '';
  const activeChip = document.querySelector('.filter-chips .chip.is-active');
  const filter = activeChip ? activeChip.dataset.filter : 'all';

  grid.querySelectorAll('.room-card').forEach((card) => {
    const title = card.querySelector('h3')?.textContent.toLowerCase() || '';
    const hostel = card.querySelector('.room-card__hostel')?.textContent.toLowerCase() || '';
    const matchesSearch = !q || title.includes(q) || hostel.includes(q);
    const matchesFilter = filter === 'all' || card.dataset.capacity === filter;
    card.style.display = (matchesSearch && matchesFilter) ? '' : 'none';
  });
}

/* ---------------------------------------------------------
   Render: Bookings page (bookings.html)
--------------------------------------------------------- */
function renderBookingsPage() {
  const tbody = document.getElementById('bookingsBody');
  if (!tbody) return; // not on this page

  const bookings = getBookings();
  const rooms = getRooms();

  const roomSelect = document.getElementById('bookingRoom');
  if (roomSelect) {
    const prev = roomSelect.value;
    const available = rooms.filter((r) => Number(r.filled) < Number(r.beds));
    roomSelect.innerHTML = available.length
      ? available.map((r) => {
        const label = `${r.hostel} — ${r.capacity}-in-a-Room (${r.beds - r.filled} left)`;
        return `<option value="${r.id}">${escapeHtml(label)}</option>`;
      }).join('')
      : `<option value="">No rooms with open beds</option>`;
    if (available.some((r) => r.id === prev)) roomSelect.value = prev;
  }

  const confirmed = bookings.filter((b) => b.status === 'confirmed');
  const cancelled = bookings.filter((b) => b.status === 'cancelled');
  const revenue = confirmed.reduce((s, b) => s + (Number(b.price) || 0), 0);

  setText('statTotalBookings', bookings.length);
  setText('statConfirmedBookings', confirmed.length);
  setText('statCancelledBookings', cancelled.length);
  setText('statRevenue', `GHS ${revenue.toLocaleString('en-US')}`);

  tbody.innerHTML = bookings.length
    ? bookings.map(bookingRowHtml).join('')
    : `<tr><td colspan="7" class="empty-state">No bookings yet — book a bed from the Rooms page or record one above.</td></tr>`;

  reapplyBookingsSearch();
}

function bookingRowHtml(booking) {
  const isCancelled = booking.status === 'cancelled';
  const pillClass = isCancelled ? 'pill--draft' : 'pill--available';
  const label = isCancelled ? 'Cancelled' : 'Confirmed';

  return `
    <tr data-id="${booking.id}">
      <td data-label="Student">${escapeHtml(booking.studentName)}</td>
      <td data-label="Hostel">${escapeHtml(booking.hostel)}</td>
      <td data-label="Room Type">${escapeHtml(booking.roomType)}</td>
      <td data-label="Price">GHS ${Number(booking.price).toLocaleString('en-US')}</td>
      <td data-label="Booked On">${escapeHtml(booking.bookedAt)}</td>
      <td data-label="Status"><span class="pill ${pillClass}">${label}</span></td>
      <td data-label="Actions" class="table__actions">
        ${isCancelled
    ? `<span class="table__muted-note">—</span>`
    : `<button class="link-btn link-btn--danger" type="button" data-action="cancel-booking">Cancel</button>`}
      </td>
    </tr>`;
}

function reapplyBookingsSearch() {
  const input = document.querySelector('.search input');
  const tbody = document.getElementById('bookingsBody');
  if (!input || !tbody) return;
  const q = input.value.trim().toLowerCase();
  tbody.querySelectorAll('tr[data-id]').forEach((row) => {
    const student = row.children[0]?.textContent.toLowerCase() || '';
    const hostel = row.children[1]?.textContent.toLowerCase() || '';
    row.style.display = (!q || student.includes(q) || hostel.includes(q)) ? '' : 'none';
  });
}

/* ---------------------------------------------------------
   Render everything relevant to whichever page is loaded
--------------------------------------------------------- */
function renderCurrentPage() {
  renderDashboard();
  renderHostelsPage();
  renderRoomsPage();
  renderBookingsPage();
}

/* ---------------------------------------------------------
   Mobile sidebar (hamburger menu + scrim)
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
    document.body.style.overflow = 'hidden';
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

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidebar.classList.contains('is-open')) {
      closeSidebar();
      menuBtn.focus();
    }
  });

  sidebar.querySelectorAll('.nav__link').forEach((link) => {
    link.addEventListener('click', () => {
      if (window.innerWidth <= 980) closeSidebar();
    });
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 980) closeSidebar();
  });
}

/* ---------------------------------------------------------
   Quick Add: New Room Type (Dashboard)
--------------------------------------------------------- */
function initQuickAddForm() {
  const form = document.getElementById('quickAddForm');
  if (!form) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();

    const hostel = form.hostel.value;
    const capacity = form.capacity.value;
    const price = form.price.value.trim();
    const totalRooms = form.totalRooms.value.trim();

    if (!hostel || !price || !totalRooms) {
      flashInvalid(form.price.closest('.field').querySelector('input, .input-prefix'));
      flashInvalid(form.totalRooms);
      return;
    }

    const rooms = getRooms();
    rooms.unshift({
      id: makeId(),
      hostel,
      capacity,
      price: Number(price),
      beds: Number(totalRooms),
      filled: 0,
    });
    setRooms(rooms);

    form.reset();
    renderCurrentPage();

    requestAnimationFrame(() => {
      const newRow = document.querySelector('#inventoryBody tr[data-id]');
      if (newRow) {
        newRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
        flashSuccess(newRow);
      }
    });
  });
}

/* ---------------------------------------------------------
   Hostels page — "Add New Hostel" jump + form submission
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
  if (!form) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();

    const name = form.hostelName.value.trim();
    const location = form.hostelLocation.value.trim();
    const status = form.hostelStatus.value;

    if (!name || !location) {
      flashInvalid(form.hostelName);
      flashInvalid(form.hostelLocation);
      return;
    }

    const hostels = getHostels();
    hostels.unshift({ id: makeId(), name, location, status });
    setHostels(hostels);

    form.reset();
    resetFileDropLabel();
    renderCurrentPage();

    requestAnimationFrame(() => {
      const newCard = document.querySelector('#hostelGrid .hostel-card[data-id]');
      if (newCard) {
        newCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
        flashCardSuccess(newCard);
      }
    });
  });
}

/* ---------------------------------------------------------
   Hostels page — drag-and-drop styling for the photo field
   (cosmetic only in this trial — the file itself isn't saved)
--------------------------------------------------------- */
function initFileDrop() {
  const dropLabel = document.querySelector('.file-drop');
  const fileInput = document.getElementById('hostelPhoto');
  if (!dropLabel || !fileInput) return;

  ['dragenter', 'dragover'].forEach((evt) => {
    dropLabel.addEventListener(evt, (e) => { e.preventDefault(); dropLabel.classList.add('is-dragover'); });
  });
  ['dragleave', 'drop'].forEach((evt) => {
    dropLabel.addEventListener(evt, (e) => { e.preventDefault(); dropLabel.classList.remove('is-dragover'); });
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
  if (textEl) textEl.innerHTML = `<b>${escapeHtml(fileName)}</b> selected — click to change`;
}

function resetFileDropLabel() {
  const textEl = document.querySelector('.file-drop span');
  if (textEl) textEl.innerHTML = '<b>Click to upload</b> or drag a photo here';
}

/* ---------------------------------------------------------
   Rooms page — search input + filter chips
--------------------------------------------------------- */
function initRoomSearchAndFilters() {
  const grid = document.getElementById('roomGrid');
  if (!grid) return;

  const input = document.querySelector('.search input');
  if (input) input.addEventListener('input', reapplyRoomFilterAndSearch);

  document.querySelectorAll('.filter-chips .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filter-chips .chip').forEach((c) => c.classList.remove('is-active'));
      chip.classList.add('is-active');
      reapplyRoomFilterAndSearch();
    });
  });
}

/* ---------------------------------------------------------
   Rooms page — "Add New Room Type" jump + form submission
--------------------------------------------------------- */
function initAddRoomForm() {
  const openLink = document.getElementById('openAddRoomBtn');
  const panel = document.getElementById('add-room');
  if (openLink && panel) {
    openLink.addEventListener('click', (e) => {
      e.preventDefault();
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      panel.querySelector('#roomHostel')?.focus();
    });
  }

  const form = document.getElementById('addRoomForm');
  if (!form) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();

    const hostel = form.roomHostel.value;
    const capacity = form.roomCapacity.value;
    const price = form.roomPrice.value.trim();
    const beds = form.roomBeds.value.trim();

    if (!hostel || !price || !beds) {
      flashInvalid(form.roomPrice.closest('.field').querySelector('input, .input-prefix'));
      flashInvalid(form.roomBeds);
      return;
    }

    const rooms = getRooms();
    rooms.unshift({
      id: makeId(),
      hostel,
      capacity,
      price: Number(price),
      beds: Number(beds),
      filled: 0,
    });
    setRooms(rooms);

    form.reset();
    renderCurrentPage();

    requestAnimationFrame(() => {
      const newCard = document.querySelector('#roomGrid .room-card[data-id]');
      if (newCard) {
        newCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
        flashCardSuccess(newCard);
      }
    });
  });
}

/* ---------------------------------------------------------
   Bookings page — "Record a Booking" form
--------------------------------------------------------- */
function initRecordBookingForm() {
  const form = document.getElementById('recordBookingForm');
  if (!form) return;

  form.addEventListener('submit', (e) => {
    e.preventDefault();

    const roomId = form.bookingRoom.value;
    const studentName = form.bookingStudent.value.trim();

    if (!roomId || !studentName) {
      flashInvalid(form.bookingStudent);
      return;
    }

    const ok = bookRoom(roomId, studentName);
    if (!ok) {
      alert('That room just filled up — pick another one.');
      renderCurrentPage();
      return;
    }

    form.reset();
    renderCurrentPage();

    requestAnimationFrame(() => {
      const newRow = document.querySelector('#bookingsBody tr[data-id]');
      if (newRow) {
        newRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
        flashSuccess(newRow);
      }
    });
  });
}

/* ---------------------------------------------------------
   Reset demo data (footer link on every page)
--------------------------------------------------------- */
function initResetDemoButton() {
  const btn = document.getElementById('resetDemoBtn');
  if (!btn) return;

  btn.addEventListener('click', () => {
    if (confirm('Reset all hostels, rooms, and bookings back to the demo starting data?')) {
      resetDemoData();
    }
  });
}

/* ---------------------------------------------------------
   Shared: Edit / Remove / Book / Cancel Booking — one
   delegated click handler for table rows, hostel cards, and
   room cards alike
--------------------------------------------------------- */
document.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;

  // Bookings page: cancel a booking (frees up the bed too)
  if (action === 'cancel-booking') {
    const row = btn.closest('tr[data-id]');
    if (row && confirm('Cancel this booking and free up the bed?')) {
      cancelBooking(row.dataset.id);
      renderCurrentPage();
    }
    return;
  }

  const row = btn.closest('tr[data-id]');
  const hostelCard = btn.closest('.hostel-card[data-id]');
  const roomCard = btn.closest('.room-card[data-id]');
  const container = row || hostelCard || roomCard;
  if (!container) return;

  const id = container.dataset.id;

  if (action === 'remove') {
    let confirmText = 'Remove this item?';
    let doRemove;
    if (row) {
      confirmText = 'Remove this room type from the inventory?';
      doRemove = () => setRooms(getRooms().filter((r) => r.id !== id));
    } else if (hostelCard) {
      confirmText = 'Remove this hostel from your portfolio?';
      doRemove = () => setHostels(getHostels().filter((h) => h.id !== id));
    } else if (roomCard) {
      confirmText = 'Remove this room type? This will unlist it for students.';
      doRemove = () => setRooms(getRooms().filter((r) => r.id !== id));
    }
    if (doRemove && confirm(confirmText)) {
      doRemove();
      renderCurrentPage();
    }
    return;
  }

  if (action === 'edit') {
    const name = container.querySelector('h3')?.textContent
      || container.children[0]?.textContent
      || 'this item';
    alert(`Editing "${name}" — hook this up to your edit flow.`);
    return;
  }

  if (action === 'book') {
    const rooms = getRooms();
    const room = rooms.find((r) => r.id === id);
    if (!room || Number(room.filled) >= Number(room.beds)) return;

    const studentName = prompt('Student name for this booking:', '');
    if (!studentName || !studentName.trim()) return; // cancelled or empty

    bookRoom(id, studentName.trim());
    renderCurrentPage();
  }
});

/* ---------------------------------------------------------
   Small visual feedback helpers
--------------------------------------------------------- */
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

function flashCardSuccess(card) {
  card.style.transition = 'box-shadow 0.6s ease';
  card.style.boxShadow = '0 0 0 3px rgba(14, 140, 115, 0.35)';
  setTimeout(() => { card.style.boxShadow = ''; }, 900);
}

/* ---------------------------------------------------------
   Boot
--------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
  seedDataIfEmpty();

  initSidebar();
  initFileDrop();
  initResetDemoButton();

  initQuickAddForm();
  initAddHostelForm();
  initRoomSearchAndFilters();
  initAddRoomForm();
  initRecordBookingForm();

  renderCurrentPage();

  // Search inputs on Dashboard / Hostels / Bookings pages (Rooms page
  // search is wired inside initRoomSearchAndFilters since it also
  // handles the capacity filter chips)
  const searchInput = document.querySelector('.search input');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      reapplyTableSearch();
      reapplyHostelSearch();
      reapplyBookingsSearch();
    });
  }
});