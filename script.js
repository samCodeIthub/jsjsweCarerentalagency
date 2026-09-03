// =========================================================
// weCare Admin — script.js
// Firestore-backed data layer: hostels (with per-hostel
// commission settings), rooms, bookings (with batch-number
// verification, check-in, and owner/company revenue split),
// and a student directory derived from bookings. Shared across
// index.html / hostels.html / rooms.html / bookings.html /
// students.html.
//
// getHostels()/getRooms()/getBookings() still return data
// instantly and synchronously — a live cache behind the
// scenes is kept in sync with Firestore, so none of the
// rendering/business logic below needed to change.
// =========================================================

import { db } from './firebase-config.js';
import {
  collection, doc, getDoc, setDoc, getDocs, writeBatch, onSnapshot, deleteDoc,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const META_COLLECTION = 'meta';
const SEED_STATUS_DOC = 'seedStatus';

const CLOUDINARY_CLOUD_NAME = 'wlrgu3h3';
const CLOUDINARY_UPLOAD_PRESET = 'wecare_hostels';

const HOSTELS_COLLECTION = 'hostels';
const ROOMS_COLLECTION = 'rooms';
const BOOKINGS_COLLECTION = 'bookings';
const SETTINGS_COLLECTION = 'settings';
const PAYMENT_SETTINGS_DOC = 'payment';

// Tracks which hostel (if any) the Add/Edit Hostel form is
// currently editing. null means the form is in "add" mode.
let editingHostelId = null;

const DEFAULT_HOSTELS = [
  { id: 'h1', name: 'Ambassador Hall', location: 'Near UEW South Campus', status: 'active', commissionType: 'fixed', commissionValue: 200 },
  { id: 'h2', name: 'Unity Lodge', location: 'Jopps Junction, Winneba', status: 'active', commissionType: 'fixed', commissionValue: 150 },
  { id: 'h3', name: 'Serene Villa', location: 'Behind UEW North Campus', status: 'active', commissionType: 'percent', commissionValue: 8 },
  { id: 'h4', name: 'Peace Hostel', location: 'Taffo Road, Winneba', status: 'active', commissionType: 'fixed', commissionValue: 100 },
  { id: 'h5', name: 'Golden Gate Hall', location: 'Near UEW Main Gate', status: 'active', commissionType: 'percent', commissionValue: 10 },
  { id: 'h6', name: 'Mercy Lodge', location: 'Estate Junction, Winneba', status: 'draft', commissionType: 'fixed', commissionValue: 0 },
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
  { id: 'b1', roomId: 'r1', hostel: 'Ambassador Hall', roomType: '2-in-a-Room', capacity: '2', price: 1800, companyCut: 200, ownerPayout: 1600, studentName: 'Kwame Owusu', phone: '024 555 1234', batchNumber: 'WC-7F3K9A', bookedAt: '2026-08-12', status: 'confirmed', checkedIn: true },
  { id: 'b2', roomId: 'r1', hostel: 'Ambassador Hall', roomType: '2-in-a-Room', capacity: '2', price: 1800, companyCut: 200, ownerPayout: 1600, studentName: 'Efua Mensah', phone: '', batchNumber: 'WC-2M8P4Q', bookedAt: '2026-08-14', status: 'confirmed', checkedIn: false },
  { id: 'b3', roomId: 'r4', hostel: 'Peace Hostel', roomType: '2-in-a-Room', capacity: '2', price: 1500, companyCut: 100, ownerPayout: 1400, studentName: 'Yaw Boateng', phone: '020 333 7890', batchNumber: 'WC-9R5T2H', bookedAt: '2026-08-15', status: 'confirmed', checkedIn: false },
  { id: 'b4', roomId: 'r2', hostel: 'Unity Lodge', roomType: '4-in-a-Room', capacity: '4', price: 1050, companyCut: 150, ownerPayout: 900, studentName: 'Ama Serwaa', phone: '', batchNumber: 'WC-4X7N3B', bookedAt: '2026-08-10', status: 'cancelled', checkedIn: false },
];

/* ---------------------------------------------------------
   Live cache — kept in sync by Firestore listeners (see
   startLiveSync near the bottom of this file).
--------------------------------------------------------- */
let hostelsCache = [];
let roomsCache = [];
let bookingsCache = [];
let paymentSettingsCache = { momoNetwork: 'MTN Mobile Money', momoNumber: '', momoName: '' };
const cachesReady = { hostels: false, rooms: false, bookings: false };

function getHostels() { return hostelsCache; }
function getRooms() { return roomsCache; }
function getBookings() { return bookingsCache; }
function getPaymentSettings() { return paymentSettingsCache; }

function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Saves a FULL list back to Firestore — deletes what's there
// and rewrites it, matching how setHostels/etc always worked.
async function saveCollection(name, list) {
  const colRef = collection(db, name);
  const existingSnap = await getDocs(colRef);
  const batch = writeBatch(db);
  existingSnap.forEach((docSnap) => batch.delete(docSnap.ref));
  list.forEach((item) => {
    const { id, ...data } = item;
    batch.set(doc(db, name, id || makeId()), data);
  });
  await batch.commit();
}

function setHostels(list) { hostelsCache = list; saveCollection(HOSTELS_COLLECTION, list); }
function setRooms(list) { roomsCache = list; saveCollection(ROOMS_COLLECTION, list); }
function setBookings(list) { bookingsCache = list; saveCollection(BOOKINGS_COLLECTION, list); }

// Seeds demo data ONLY the very first time this database is
// ever used — tracked with a one-time flag, not by checking
// whether collections are currently empty. This means clearing
// your real data later will NOT trigger it to come back.
async function seedDataIfEmpty() {
  const seedRef = doc(db, META_COLLECTION, SEED_STATUS_DOC);
  const seedSnap = await getDoc(seedRef);

  if (seedSnap.exists() && seedSnap.data().seeded) {
    return; // already seeded once, ever — leave real/cleared data alone
  }

  await saveCollection(HOSTELS_COLLECTION, DEFAULT_HOSTELS);
  await saveCollection(ROOMS_COLLECTION, DEFAULT_ROOMS);
  await saveCollection(BOOKINGS_COLLECTION, DEFAULT_BOOKINGS);
  await setDoc(seedRef, { seeded: true, seededAt: new Date().toISOString() });
}

function resetDemoData() {
  saveCollection(HOSTELS_COLLECTION, DEFAULT_HOSTELS);
  saveCollection(ROOMS_COLLECTION, DEFAULT_ROOMS);
  saveCollection(BOOKINGS_COLLECTION, DEFAULT_BOOKINGS);
}

// Keeps the cache (and the screen) live-updated — including
// when a change happens on a DIFFERENT browser or device.
function startLiveSync() {
  function maybeRender() {
    if (cachesReady.hostels && cachesReady.rooms && cachesReady.bookings) renderCurrentPage();
  }
  onSnapshot(collection(db, HOSTELS_COLLECTION), (snap) => {
    hostelsCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    cachesReady.hostels = true;
    maybeRender();
  });
  onSnapshot(collection(db, ROOMS_COLLECTION), (snap) => {
    roomsCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    cachesReady.rooms = true;
    maybeRender();
  });
  onSnapshot(collection(db, BOOKINGS_COLLECTION), (snap) => {
    bookingsCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    cachesReady.bookings = true;
    maybeRender();
  });
  onSnapshot(doc(db, SETTINGS_COLLECTION, PAYMENT_SETTINGS_DOC), (snap) => {
    if (snap.exists()) paymentSettingsCache = { ...paymentSettingsCache, ...snap.data() };
    renderPaymentSettingsForm();
  });
}

/* ---------------------------------------------------------
   Booking actions — shared by the Rooms page "Book a Bed"
   button and the Bookings page "Record a Booking" form
--------------------------------------------------------- */

// Excludes visually ambiguous characters (0/O, 1/I) so batch
// numbers are easy to read aloud and re-type at the front desk.
function generateBatchNumber() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return `WC-${code}`;
}

// Splits a payment between the hostel owner and weCare, using
// whatever commission rule is set on that hostel at the moment
// of booking. The split is stored on the booking itself so it
// stays accurate even if the hostel's rate changes later.
function computeRevenueSplit(price, hostel) {
  const type = hostel?.commissionType || 'fixed';
  const value = Number(hostel?.commissionValue) || 0;

  let companyCut = type === 'percent'
    ? Math.round(price * (value / 100))
    : value;

  companyCut = Math.max(0, Math.min(companyCut, price)); // never negative, never more than the price
  const ownerPayout = price - companyCut;
  return { companyCut, ownerPayout };
}

function bookRoom(roomId, studentName) {
  const rooms = getRooms();
  const room = rooms.find((r) => r.id === roomId);
  if (!room) return false;
  if (Number(room.filled) >= Number(room.beds)) return false;

  room.filled = Number(room.filled) + 1;
  setRooms(rooms);

  const hostels = getHostels();
  const hostelObj = hostels.find((h) => h.name === room.hostel);
  const { companyCut, ownerPayout } = computeRevenueSplit(room.price, hostelObj);

  const bookings = getBookings();
  bookings.unshift({
    id: makeId(),
    roomId: room.id,
    hostel: room.hostel,
    roomType: room.capacity === '1' ? '1-in-a-Room' : `${room.capacity}-in-a-Room`,
    capacity: room.capacity,
    price: room.price,
    companyCut,
    ownerPayout,
    studentName,
    phone: '',
    batchNumber: generateBatchNumber(),
    bookedAt: new Date().toISOString().slice(0, 10), // date of payment
    status: 'confirmed',
    checkedIn: false,
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

// Marks a student as verified and physically checked in. Once
// checked in, a booking can no longer be cancelled — this protects
// against someone else's cancellation freeing up a bed that's
// already occupied.
function checkInBooking(bookingId) {
  const bookings = getBookings();
  const booking = bookings.find((b) => b.id === bookingId);
  if (!booking || booking.status !== 'confirmed' || booking.checkedIn) return;

  booking.checkedIn = true;
  setBookings(bookings);
}

// Undoes a check-in — for when someone was checked in by mistake.
// Not allowed on cancelled bookings, and a no-op if not checked in.
function undoCheckIn(bookingId) {
  const bookings = getBookings();
  const booking = bookings.find((b) => b.id === bookingId);
  if (!booking || booking.status === 'cancelled' || !booking.checkedIn) return;

  booking.checkedIn = false;
  setBookings(bookings);
}

// Admin has checked their Mobile Money and actually received the
// payment for this booking — this is the moment the room is
// really booked. Bed count doesn't change here since it was
// already reserved the moment the student said they'd paid.
function confirmBookingPayment(bookingId) {
  const bookings = getBookings();
  const booking = bookings.find((b) => b.id === bookingId);
  if (!booking || booking.status !== 'pending') return;

  booking.status = 'confirmed';
  setBookings(bookings);
}

// Permanently removes a booking from the database. Only ever
// called on bookings that are already cancelled — this is for
// clearing old cancelled records off the list, not for cancelling
// an active one (use cancelBooking for that).
async function deleteBookingPermanently(bookingId) {
  bookingsCache = bookingsCache.filter((b) => b.id !== bookingId);
  await deleteDoc(doc(db, BOOKINGS_COLLECTION, bookingId));
}

// Asks Cloudinary to serve a small, compressed version of a photo
// instead of the full original — fixes janky/flickering hover
// effects (and slow loads) caused by downloading a huge original
// image just to shrink it with CSS.
function cloudinaryThumb(url, width, height) {
  if (!url || !url.includes('/upload/')) return url;
  return url.replace('/upload/', `/upload/w_${width},h_${height},c_fill,g_auto,q_auto,f_auto/`);
}

// Uploads a hostel's chosen photo file to Cloudinary (free image
// hosting) and returns a public URL to save on the hostel's record.
// No admin has to touch any code for this — they just pick a
// file in the form and it's stored automatically.
// Shared uploader — used for both hostel photos and room photos.
async function uploadImageToCloudinary(file, publicId) {
  const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;
  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
  formData.append('public_id', publicId);

  const response = await fetch(url, { method: 'POST', body: formData });
  if (!response.ok) throw new Error('Cloudinary upload failed');

  const data = await response.json();
  return data.secure_url;
}

async function uploadHostelPhoto(hostelId, file) {
  return uploadImageToCloudinary(file, `hostel-${hostelId}-${Date.now()}`);
}

// Uploads several room photos (bedroom, kitchen, washroom, etc.)
// at once and returns an array of their URLs, in order.
async function uploadRoomPhotos(roomId, files) {
  const uploads = Array.from(files).map((file, index) =>
    uploadImageToCloudinary(file, `room-${roomId}-${Date.now()}-${index}`)
  );
  return Promise.all(uploads);
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
  const bookings = getBookings();

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
    ? hostels.map((h) => hostelCardHtml(h, rooms, bookings)).join('')
    : `<p class="empty-state">No hostels yet — add your first one above.</p>`;

  reapplyHostelSearch();
}

// Sums a hostel's completed (non-cancelled) bookings into a
// total, an owner payout, and weCare's cut.
function hostelRevenue(hostelName, bookings) {
  const relevant = bookings.filter((b) => b.hostel === hostelName && b.status !== 'cancelled');
  return {
    count: relevant.length,
    total: relevant.reduce((s, b) => s + (Number(b.price) || 0), 0),
    ownerPayout: relevant.reduce((s, b) => s + (Number(b.ownerPayout) || 0), 0),
    companyCut: relevant.reduce((s, b) => s + (Number(b.companyCut) || 0), 0),
  };
}

function commissionLabel(hostel) {
  const type = hostel.commissionType || 'fixed';
  const value = Number(hostel.commissionValue) || 0;
  return type === 'percent' ? `${value}% / booking` : `GHS ${value.toLocaleString('en-US')} / booking`;
}

function hostelCardHtml(hostel, rooms, bookings) {
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

  const rev = hostelRevenue(hostel.name, bookings);
  const revenueHtml = rev.count > 0
    ? `
      <div class="hostel-card__revenue">
        <p class="hostel-card__revenue-row"><span>Commission</span><strong>${commissionLabel(hostel)}</strong></p>
        <p class="hostel-card__revenue-row"><span>Total Revenue</span><strong>GHS ${rev.total.toLocaleString('en-US')}</strong></p>
        <p class="hostel-card__revenue-row"><span>Owner Payout</span><strong>GHS ${rev.ownerPayout.toLocaleString('en-US')}</strong></p>
        <p class="hostel-card__revenue-row"><span>weCare Cut</span><strong>GHS ${rev.companyCut.toLocaleString('en-US')}</strong></p>
      </div>`
    : `
      <div class="hostel-card__revenue">
        <p class="hostel-card__revenue-row"><span>Commission</span><strong>${commissionLabel(hostel)}</strong></p>
        <p class="table__muted-note">No revenue yet</p>
      </div>`;

  const coverInner = hostel.photoURL
    ? `<img src="${escapeHtml(cloudinaryThumb(hostel.photoURL, 400, 160))}" alt="${escapeHtml(hostel.name)}" class="hostel-card__photo" loading="lazy">`
    : `<svg class="hostel-card__photo-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M21 16l-5-4-4 3-3-2-4 3"/></svg>`;

  return `
    <article class="hostel-card" data-id="${hostel.id}">
      <div class="hostel-card__cover ${hostel.photoURL ? '' : coverClass}">
        <span class="pill ${pillClass}">${label}</span>
        ${coverInner}
      </div>
      <div class="hostel-card__body">
        <h3>${escapeHtml(hostel.name)}</h3>
        <p class="hostel-card__meta">${escapeHtml(hostel.location)}</p>
        <p class="hostel-card__stats">${statsText}</p>
        ${revenueHtml}
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

  const photosHtml = room.photoURLs?.length
    ? `<div class="room-card__photos">${room.photoURLs.slice(0, 4).map((url) =>
        `<img src="${escapeHtml(cloudinaryThumb(url, 150, 100))}" alt="" loading="lazy">`).join('')}</div>`
    : '';

  return `
    <article class="room-card" data-id="${room.id}" data-capacity="${room.capacity}">
      ${photosHtml}
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
   Payment Settings — the Mobile Money number/name students see
--------------------------------------------------------- */
function renderPaymentSettingsForm() {
  const form = document.getElementById('paymentSettingsForm');
  if (!form) return; // not on this page

  const settings = getPaymentSettings();
  // Don't stomp on what the admin is actively typing.
  if (document.activeElement && form.contains(document.activeElement)) return;

  if (form.momoNetwork) form.momoNetwork.value = settings.momoNetwork || 'MTN Mobile Money';
  if (form.momoNumber) form.momoNumber.value = settings.momoNumber || '';
  if (form.momoName) form.momoName.value = settings.momoName || '';
}

function initPaymentSettingsForm() {
  const form = document.getElementById('paymentSettingsForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const momoNetwork = form.momoNetwork.value;
    const momoNumber = form.momoNumber.value.trim();
    const momoName = form.momoName.value.trim();

    const btn = form.querySelector('button[type="submit"]');
    const original = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

    await setDoc(doc(db, SETTINGS_COLLECTION, PAYMENT_SETTINGS_DOC), { momoNetwork, momoNumber, momoName }, { merge: true });

    if (btn) { btn.disabled = false; btn.textContent = original; }
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

  const pending = bookings.filter((b) => b.status === 'pending');
  const confirmed = bookings.filter((b) => b.status === 'confirmed');
  const awaitingCheckIn = confirmed.filter((b) => !b.checkedIn).length;
  const checkedIn = confirmed.filter((b) => b.checkedIn).length;
  const revenue = confirmed.reduce((s, b) => s + (Number(b.price) || 0), 0);
  const ownerPayouts = confirmed.reduce((s, b) => s + (Number(b.ownerPayout) || 0), 0);
  const companyRevenue = confirmed.reduce((s, b) => s + (Number(b.companyCut) || 0), 0);

  // "Total Bookings" is every live booking (pending + confirmed) —
  // cancelled ones don't count towards it since they're not real
  // bookings any more. Money collected only counts once confirmed.
  setText('statPendingPayment', pending.length);
  setText('statTotalBookings', pending.length + confirmed.length);
  setText('statAwaitingCheckIn', awaitingCheckIn);
  setText('statCheckedIn', checkedIn);
  setText('statTotalCollected', `GHS ${revenue.toLocaleString('en-US')}`);
  setText('statOwnerPayouts', `GHS ${ownerPayouts.toLocaleString('en-US')}`);
  setText('statCompanyRevenue', `GHS ${companyRevenue.toLocaleString('en-US')}`);

  const pendingBody = document.getElementById('pendingPaymentsBody');
  if (pendingBody) {
    pendingBody.innerHTML = pending.length
      ? pending.map(pendingBookingRowHtml).join('')
      : `<tr><td colspan="7" class="empty-state">No pending payments — you're all caught up.</td></tr>`;
  }

  tbody.innerHTML = bookings.length
    ? bookings.map(bookingRowHtml).join('')
    : `<tr><td colspan="8" class="empty-state">No bookings yet — book a bed from the Rooms page or record one above.</td></tr>`;

  reapplyBookingsSearch();
}

function pendingBookingRowHtml(booking) {
  return `
    <tr data-id="${booking.id}">
      <td data-label="Batch No."><span class="batch-code">${escapeHtml(booking.batchNumber)}</span></td>
      <td data-label="Student">${escapeHtml(booking.studentName)}</td>
      <td data-label="Hostel">${escapeHtml(booking.hostel)}</td>
      <td data-label="Room Type">${escapeHtml(booking.roomType)}</td>
      <td data-label="Amount Due">GHS ${Number(booking.price).toLocaleString('en-US')}</td>
      <td data-label="Requested">${escapeHtml(booking.bookedAt)}</td>
      <td data-label="Actions" class="table__actions">
        <button class="link-btn" type="button" data-action="confirm-payment">Confirm Payment</button>
        <button class="link-btn link-btn--danger" type="button" data-action="reject-payment">Reject</button>
      </td>
    </tr>`;
}

function bookingRowHtml(booking) {
  const isCancelled = booking.status === 'cancelled';
  const isPending = booking.status === 'pending';
  const isCheckedIn = !isCancelled && !isPending && booking.checkedIn;

  let pillClass = 'pill--warning';
  let label = 'Awaiting Check-in';
  if (isCancelled) { pillClass = 'pill--draft'; label = 'Cancelled'; }
  else if (isPending) { pillClass = 'pill--warning'; label = 'Processing Payment'; }
  else if (isCheckedIn) { pillClass = 'pill--available'; label = 'Checked In'; }

  const batchHtml = isCancelled
    ? `<span class="batch-code batch-code--void">${escapeHtml(booking.batchNumber)}</span><span class="void-tag">VOID</span>`
    : `<span class="batch-code">${escapeHtml(booking.batchNumber)}</span>`;

  let actionsHtml = `<span class="table__muted-note">—</span>`;
  if (isPending) {
    actionsHtml = `
      <button class="link-btn" type="button" data-action="confirm-payment">Confirm Payment</button>
      <button class="link-btn link-btn--danger" type="button" data-action="reject-payment">Reject</button>`;
  } else if (!isCancelled && !isCheckedIn) {
    actionsHtml = `
      <button class="link-btn" type="button" data-action="check-in">Check In</button>
      <button class="link-btn link-btn--danger" type="button" data-action="cancel-booking">Cancel</button>`;
    } else if (isCheckedIn) {
    actionsHtml = `<button class="link-btn" type="button" data-action="undo-check-in">Undo Check-in</button>`;
  } else if (isCancelled) {
    actionsHtml = `<button class="link-btn link-btn--danger" type="button" data-action="delete-booking">Delete</button>`;
  }

  return `
    <tr data-id="${booking.id}" data-capacity="${booking.capacity || ''}">
      <td data-label="Batch No.">${batchHtml}</td>
      <td data-label="Student">${escapeHtml(booking.studentName)}</td>
      <td data-label="Hostel">${escapeHtml(booking.hostel)}</td>
      <td data-label="Room Type">${escapeHtml(booking.roomType)}</td>
      <td data-label="Price">GHS ${Number(booking.price).toLocaleString('en-US')}</td>
      <td data-label="Date Paid">${escapeHtml(booking.bookedAt)}</td>
      <td data-label="Status"><span class="pill ${pillClass}">${label}</span></td>
      <td data-label="Actions" class="table__actions">${actionsHtml}</td>
    </tr>`;
}

function reapplyBookingsSearch() {
  const tbody = document.getElementById('bookingsBody');
  if (!tbody) return;
  const input = document.querySelector('.search input');
  const q = input ? input.value.trim().toLowerCase() : '';
  const activeChip = document.querySelector('#bookingsFilterChips .chip.is-active');
  const filter = activeChip ? activeChip.dataset.filter : 'all';

  tbody.querySelectorAll('tr[data-id]').forEach((row) => {
    const batch = row.children[0]?.textContent.toLowerCase() || '';
    const student = row.children[1]?.textContent.toLowerCase() || '';
    const hostel = row.children[2]?.textContent.toLowerCase() || '';
    const matchesSearch = !q || student.includes(q) || hostel.includes(q) || batch.includes(q);
    const matchesFilter = filter === 'all' || row.dataset.capacity === filter;
    row.style.display = (matchesSearch && matchesFilter) ? '' : 'none';
  });
}

/* ---------------------------------------------------------
   Render: Students page (students.html)
--------------------------------------------------------- */
function renderStudentsPage() {
  const tbody = document.getElementById('studentsBody');
  if (!tbody) return; // not on this page

  const bookings = getBookings();

  const cancelled = bookings.filter((b) => b.status === 'cancelled').length;
  const pending = bookings.filter((b) => b.status === 'pending').length;
  const confirmed = bookings.filter((b) => b.status === 'confirmed');
  const checkedIn = confirmed.filter((b) => b.checkedIn).length;
  const awaiting = confirmed.filter((b) => !b.checkedIn).length;

  setText('statTotalStudents', pending + confirmed.length);
  setText('statStudentsCheckedIn', checkedIn);
  setText('statStudentsAwaiting', awaiting);
  setText('statStudentsCancelled', cancelled);

  tbody.innerHTML = bookings.length
    ? bookings.map(studentRowHtml).join('')
    : `<tr><td colspan="7" class="empty-state">No students yet — bookings will appear here automatically.</td></tr>`;

  reapplyStudentsFilterAndSearch();
}

function studentRowHtml(booking) {
  const isCancelled = booking.status === 'cancelled';
  const isPending = booking.status === 'pending';
  const isCheckedIn = !isCancelled && !isPending && booking.checkedIn;

  let statusKey = 'awaiting';
  let pillClass = 'pill--warning';
  let label = 'Awaiting Check-in';
  if (isCancelled) { statusKey = 'cancelled'; pillClass = 'pill--draft'; label = 'Cancelled'; }
  else if (isPending) { statusKey = 'pending'; pillClass = 'pill--warning'; label = 'Processing Payment'; }
  else if (isCheckedIn) { statusKey = 'checked-in'; pillClass = 'pill--available'; label = 'Checked In'; }

  const batchHtml = isCancelled
    ? `<span class="batch-code batch-code--void">${escapeHtml(booking.batchNumber)}</span><span class="void-tag">VOID</span>`
    : `<span class="batch-code">${escapeHtml(booking.batchNumber)}</span>`;

  const phoneText = booking.phone ? escapeHtml(booking.phone) : `<span class="table__muted-note">Not added</span>`;

  let statusActionsHtml = `<span class="table__muted-note">—</span>`;
  if (isPending) {
    statusActionsHtml = `<span class="table__muted-note">Verify on Bookings page</span>`;
  } else if (!isCancelled && !isCheckedIn) {
    statusActionsHtml = `
      <button class="link-btn" type="button" data-action="check-in">Check In</button>
      <button class="link-btn link-btn--danger" type="button" data-action="cancel-booking">Cancel</button>`;
    } else if (isCheckedIn) {
    statusActionsHtml = `<button class="link-btn" type="button" data-action="undo-check-in">Undo Check-in</button>`;
  } else if (isCancelled) {
    statusActionsHtml = `<button class="link-btn link-btn--danger" type="button" data-action="delete-booking">Delete</button>`;
  }

  return `
    <tr data-id="${booking.id}" data-status="${statusKey}">
      <td data-label="Student">${escapeHtml(booking.studentName)}</td>
      <td data-label="Phone">${phoneText} <button class="link-btn" type="button" data-action="edit-phone">Edit</button></td>
      <td data-label="Hostel">${escapeHtml(booking.hostel)}</td>
      <td data-label="Room Type">${escapeHtml(booking.roomType)}</td>
      <td data-label="Batch No.">${batchHtml}</td>
      <td data-label="Status"><span class="pill ${pillClass}">${label}</span></td>
      <td data-label="Actions" class="table__actions">${statusActionsHtml}</td>
    </tr>`;
}

function reapplyStudentsFilterAndSearch() {
  const tbody = document.getElementById('studentsBody');
  if (!tbody) return;
  const input = document.querySelector('.search input');
  const q = input ? input.value.trim().toLowerCase() : '';
  const activeChip = document.querySelector('#studentsFilterChips .chip.is-active');
  const filter = activeChip ? activeChip.dataset.filter : 'all';

  tbody.querySelectorAll('tr[data-id]').forEach((row) => {
    const student = row.children[0]?.textContent.toLowerCase() || '';
    const phone = row.children[1]?.textContent.toLowerCase() || '';
    const batch = row.children[4]?.textContent.toLowerCase() || '';
    const matchesSearch = !q || student.includes(q) || phone.includes(q) || batch.includes(q);
    const matchesFilter = filter === 'all' || row.dataset.status === filter;
    row.style.display = (matchesSearch && matchesFilter) ? '' : 'none';
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
  renderStudentsPage();
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

  // Clicking Cancel (type="reset") — or any programmatic form.reset() —
  // should also drop out of edit mode and restore the "Add" heading/button.
  form.addEventListener('reset', () => {
    stopEditingHostel();
    resetFileDropLabel();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = form.hostelName.value.trim();
    const location = form.hostelLocation.value.trim();
    const status = form.hostelStatus.value;
    const commissionType = form.hostelCommissionType.value;
    const commissionValue = Number(form.hostelCommissionValue.value) || 0;
    const photoFile = form.hostelPhoto?.files?.[0] || null;

    if (!name || !location) {
      flashInvalid(form.hostelName);
      flashInvalid(form.hostelLocation);
      return;
    }

    const submitBtn = document.getElementById('hostelSubmitBtn');
    const originalBtnText = submitBtn ? submitBtn.textContent : '';
    if (photoFile && submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Uploading photo…';
    }

    const hostels = getHostels();

    async function safeUploadPhoto(hostelId) {
      if (!photoFile) return '';
      try {
        return await uploadHostelPhoto(hostelId, photoFile);
      } catch (err) {
        alert('The hostel was saved, but the photo upload failed. This usually means Firebase Storage needs billing enabled (the Blaze plan) — the rest of the hostel is saved fine either way.');
        return '';
      }
    }

    if (editingHostelId) {
      const hostel = hostels.find((h) => h.id === editingHostelId);
      if (hostel) {
        hostel.name = name;
        hostel.location = location;
        hostel.status = status;
        hostel.commissionType = commissionType;
        hostel.commissionValue = commissionValue;
        // Keep the existing photo unless a new one was chosen.
        if (photoFile) {
          const uploaded = await safeUploadPhoto(hostel.id);
          if (uploaded) hostel.photoURL = uploaded;
        }
      }
      setHostels(hostels);

      const editedId = editingHostelId;
      if (submitBtn) submitBtn.disabled = false;
      form.reset(); // triggers the 'reset' listener above, which calls stopEditingHostel()
      renderCurrentPage();

      requestAnimationFrame(() => {
        const card = document.querySelector(`#hostelGrid .hostel-card[data-id="${editedId}"]`);
        if (card) {
          card.scrollIntoView({ behavior: 'smooth', block: 'center' });
          flashCardSuccess(card);
        }
      });
      return;
    }

    const newId = makeId();
    const photoURL = await safeUploadPhoto(newId);
    hostels.unshift({ id: newId, name, location, status, commissionType, commissionValue, photoURL });
    setHostels(hostels);

    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = originalBtnText; }
    form.reset();
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

// Switches the Add/Edit Hostel form into "edit" mode and
// pre-fills it with the selected hostel's current values.
function startEditingHostel(hostelId) {
  const hostel = getHostels().find((h) => h.id === hostelId);
  const form = document.getElementById('addHostelForm');
  const panel = document.getElementById('add-hostel');
  if (!hostel || !form || !panel) return;

  editingHostelId = hostelId;

  form.hostelName.value = hostel.name;
  form.hostelLocation.value = hostel.location;
  form.hostelStatus.value = hostel.status;
  form.hostelCommissionType.value = hostel.commissionType || 'fixed';
  form.hostelCommissionValue.value = hostel.commissionValue || 0;
  form.hostelCommissionType.dispatchEvent(new Event('change')); // updates the GHS/% prefix
  if (form.hostelRooms) form.hostelRooms.value = '';
  if (form.hostelDescription) form.hostelDescription.value = '';
  if (hostel.photoURL) {
    const textEl = document.querySelector('.file-drop span');
    if (textEl) textEl.innerHTML = 'Current photo on file — <b>click to replace</b>';
  } else {
    resetFileDropLabel();
  }

  const titleEl = document.getElementById('hostelFormTitle');
  if (titleEl) titleEl.textContent = 'Edit Hostel';
  const submitBtn = document.getElementById('hostelSubmitBtn');
  if (submitBtn) submitBtn.textContent = 'Save Changes';

  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  form.hostelName.focus();
}

// Restores the form to "add a new hostel" mode.
function stopEditingHostel() {
  editingHostelId = null;
  const titleEl = document.getElementById('hostelFormTitle');
  if (titleEl) titleEl.textContent = 'Add New Hostel';
  const submitBtn = document.getElementById('hostelSubmitBtn');
  if (submitBtn) submitBtn.textContent = 'Save Hostel';
}

/* ---------------------------------------------------------
   Hostels page — toggle GHS/% prefix on the commission field
--------------------------------------------------------- */
function initCommissionTypeToggle() {
  const typeSelect = document.getElementById('hostelCommissionType');
  const prefix = document.getElementById('commissionPrefix');
  if (!typeSelect || !prefix) return;

  const updatePrefix = () => {
    prefix.textContent = typeSelect.value === 'percent' ? '%' : 'GHS';
  };
  typeSelect.addEventListener('change', updatePrefix);
  updatePrefix();
}

/* ---------------------------------------------------------
   Hostels page — drag-and-drop styling for the photo field
   (cosmetic only in this trial — the file itself isn't saved)
--------------------------------------------------------- */
function initFileDrop() {
  initSingleFileDrop('hostelPhoto');
  initMultiFileDrop('roomPhotos');
}

// For the hostel form's single-photo field.
function initSingleFileDrop(inputId) {
  const fileInput = document.getElementById(inputId);
  const dropLabel = fileInput?.closest('.field')?.querySelector('.file-drop');
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
      const span = dropLabel.querySelector('span');
      if (span) span.innerHTML = `<b>${escapeHtml(file.name)}</b> selected — click to change`;
    }
  });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    const span = dropLabel.querySelector('span');
    if (file && span) span.innerHTML = `<b>${escapeHtml(file.name)}</b> selected — click to change`;
  });
}

// For the room form's multi-photo field.
function initMultiFileDrop(inputId) {
  const fileInput = document.getElementById(inputId);
  const dropLabel = fileInput?.closest('.field')?.querySelector('.file-drop');
  if (!dropLabel || !fileInput) return;

  function updateLabel() {
    const count = fileInput.files?.length || 0;
    const span = dropLabel.querySelector('span');
    if (!span) return;
    span.innerHTML = count > 0
      ? `<b>${count} photo${count > 1 ? 's' : ''} selected</b> — click to change`
      : '<b>Click to upload</b> or drag photos here — bedroom, kitchen, washroom, etc.';
  }

  ['dragenter', 'dragover'].forEach((evt) => {
    dropLabel.addEventListener(evt, (e) => { e.preventDefault(); dropLabel.classList.add('is-dragover'); });
  });
  ['dragleave', 'drop'].forEach((evt) => {
    dropLabel.addEventListener(evt, (e) => { e.preventDefault(); dropLabel.classList.remove('is-dragover'); });
  });
  dropLabel.addEventListener('drop', (e) => {
    if (e.dataTransfer?.files?.length) {
      fileInput.files = e.dataTransfer.files;
      updateLabel();
    }
  });
  fileInput.addEventListener('change', updateLabel);
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

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const hostel = form.roomHostel.value;
    const capacity = form.roomCapacity.value;
    const price = form.roomPrice.value.trim();
    const beds = form.roomBeds.value.trim();
    const photoFiles = form.roomPhotos?.files || [];

    if (!hostel || !price || !beds) {
      flashInvalid(form.roomPrice.closest('.field').querySelector('input, .input-prefix'));
      flashInvalid(form.roomBeds);
      return;
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    const originalBtnText = submitBtn ? submitBtn.textContent : '';
    if (photoFiles.length && submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Uploading photos…';
    }

    const newId = makeId();
    let photoURLs = [];
    if (photoFiles.length) {
      try {
        photoURLs = await uploadRoomPhotos(newId, photoFiles);
      } catch (err) {
        alert('The room was saved, but photo upload failed. This usually clears up on retry — you can edit the room later to add photos.');
      }
    }

    const rooms = getRooms();
    rooms.unshift({
      id: newId,
      hostel,
      capacity,
      price: Number(price),
      beds: Number(beds),
      filled: 0,
      photoURLs,
    });
    setRooms(rooms);

    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = originalBtnText; }
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
   Bookings page — room-type filter chips
--------------------------------------------------------- */
function initBookingsFilters() {
  const tbody = document.getElementById('bookingsBody');
  if (!tbody) return;

  document.querySelectorAll('#bookingsFilterChips .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#bookingsFilterChips .chip').forEach((c) => c.classList.remove('is-active'));
      chip.classList.add('is-active');
      reapplyBookingsSearch();
    });
  });
}

/* ---------------------------------------------------------
   Students page — status filter chips
--------------------------------------------------------- */
function initStudentsFilters() {
  const tbody = document.getElementById('studentsBody');
  if (!tbody) return;

  document.querySelectorAll('#studentsFilterChips .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#studentsFilterChips .chip').forEach((c) => c.classList.remove('is-active'));
      chip.classList.add('is-active');
      reapplyStudentsFilterAndSearch();
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
    if (confirm('Reset all hostels, rooms, and bookings back to the demo starting data? This affects EVERYONE using the live site.')) {
      resetDemoData();
    }
  });
}

/* ---------------------------------------------------------
   Shared: Edit / Remove / Book / Check In / Cancel Booking /
   Edit Phone — one delegated click handler for table rows,
   hostel cards, and room cards alike
--------------------------------------------------------- */
document.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;

  // Pending Payments (and Bookings page): admin has checked their
  // Mobile Money and actually received the payment — this is what
  // really books the room for the student.
  if (action === 'confirm-payment') {
    const row = btn.closest('tr[data-id]');
    if (row && confirm("Confirm you've received this payment on Mobile Money? This books the room for the student.")) {
      confirmBookingPayment(row.dataset.id);
      renderCurrentPage();
    }
    return;
  }

  // Pending Payments (and Bookings page): payment never came
  // through — free up the bed and mark it cancelled.
  if (action === 'reject-payment') {
    const row = btn.closest('tr[data-id]');
    if (row && confirm('Reject this booking? This frees up the bed — only do this if the payment never arrived.')) {
      cancelBooking(row.dataset.id);
      renderCurrentPage();
    }
    return;
  }

  // Bookings page: verify + check in a student
  if (action === 'check-in') {
    const row = btn.closest('tr[data-id]');
    if (row && confirm("Confirm the student's batch number matches their ID, then check them in?")) {
      checkInBooking(row.dataset.id);
      renderCurrentPage();
    }
    return;
  }

  // Undo a check-in made by mistake
  if (action === 'undo-check-in') {
    const row = btn.closest('tr[data-id]');
    if (row && confirm('Undo this check-in? The student will show as "Awaiting Check-in" again.')) {
      undoCheckIn(row.dataset.id);
      renderCurrentPage();
    }
    return;
  }

  // Bookings/Students page: permanently remove a cancelled
  // booking from the list (it's already void — this just clears
  // it off the screen). Never available on an active booking.
  if (action === 'delete-booking') {
    const row = btn.closest('tr[data-id]');
    if (!row) return;
    const booking = getBookings().find((b) => b.id === row.dataset.id);
    if (!booking || booking.status !== 'cancelled') return;
    if (confirm('Permanently delete this cancelled booking? This cannot be undone.')) {
      deleteBookingPermanently(row.dataset.id);
      renderCurrentPage();
    }
    return;
  }

  // Students page: add or update a student's phone number
  if (action === 'edit-phone') {
    const row = btn.closest('tr[data-id]');
    if (!row) return;
    const bookings = getBookings();
    const booking = bookings.find((b) => b.id === row.dataset.id);
    if (!booking) return;

    const newPhone = prompt(`Phone number for ${booking.studentName}:`, booking.phone || '');
    if (newPhone === null) return; // dismissed

    booking.phone = newPhone.trim();
    setBookings(bookings);
    renderCurrentPage();
    return;
  }

  // Bookings page: cancel a booking (frees up the bed too).
  // Blocked once a student has been checked in, to protect
  // against a bed being freed while it's actually occupied.
  if (action === 'cancel-booking') {
    const row = btn.closest('tr[data-id]');
    if (!row) return;
    const booking = getBookings().find((b) => b.id === row.dataset.id);
    if (booking && booking.checkedIn) {
      alert('This student has already checked in — cancellation is disabled to protect the record.');
      return;
    }
    if (confirm('Cancel this booking and free up the bed?')) {
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
      if (hostelCard && id === editingHostelId) {
        const form = document.getElementById('addHostelForm');
        if (form) form.reset(); // also calls stopEditingHostel() via the 'reset' listener
      }
      renderCurrentPage();
    }
    return;
  }

  if (action === 'edit') {
    if (hostelCard) {
      startEditingHostel(id);
      return;
    }
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
document.addEventListener('DOMContentLoaded', async () => {
  initSidebar();
  initFileDrop();
  initResetDemoButton();
  initNewYearResetButton();

  initQuickAddForm();
  initAddHostelForm();
  initCommissionTypeToggle();
  initRoomSearchAndFilters();
  initAddRoomForm();
  initRecordBookingForm();
  initPaymentSettingsForm();
  initBookingsFilters();
  initStudentsFilters();

  await seedDataIfEmpty();
  startLiveSync();

  // Search inputs on Dashboard / Hostels / Bookings / Students pages
  // (Rooms page search is wired inside initRoomSearchAndFilters since
  // it also handles the capacity filter chips)
  const searchInput = document.querySelector('.search input');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      reapplyTableSearch();
      reapplyHostelSearch();
      reapplyBookingsSearch();
      reapplyStudentsFilterAndSearch();
    });
  }
});

// Downloads a spreadsheet (CSV) of every booking — full history,
// including cancelled ones — as a hard-copy record before a reset.
function exportBookingsToCSV(bookings) {
  const headers = ['Batch Number', 'Student Name', 'Phone', 'Hostel', 'Room Type', 'Price (GHS)', 'Date Paid', 'Status', 'Checked In'];
  const rows = bookings.map((b) => [
    b.batchNumber, b.studentName, b.phone || '', b.hostel, b.roomType,
    b.price, b.bookedAt, b.status, b.checkedIn ? 'Yes' : 'No',
  ]);

  const csvContent = [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const dateStamp = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `weCare-students-${dateStamp}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// Exports every booking to CSV, then — only after confirmation —
// frees up every bed and clears the booking list, ready for a
// fresh intake (e.g. a new academic year).
function startNewYearReset() {
  const bookings = getBookings();
  if (bookings.length === 0) {
    alert('There are no bookings to export yet.');
    return;
  }

  exportBookingsToCSV(bookings);

  const confirmed = confirm(
    `A file with all ${bookings.length} student records has just downloaded to your computer.\n\n` +
    `Once you confirm below, this will PERMANENTLY:\n` +
    `• Free up every bed in every room\n` +
    `• Clear the entire student/booking list\n\n` +
    `Make sure the downloaded file opened correctly and is saved somewhere safe before continuing. Proceed?`
  );
  if (!confirmed) return;

  const rooms = getRooms().map((r) => ({ ...r, filled: 0 }));
  setRooms(rooms);
  setBookings([]);
}

function initNewYearResetButton() {
  const btn = document.getElementById('newYearResetBtn');
  if (!btn) return;
  btn.addEventListener('click', startNewYearReset);
}