// =========================================================
// weCare Client Portal — client.js
// Hostels/rooms/bookings read/write Firestore, matching the
// admin's script.js — so anything added by the admin (or
// booked by any student) shows up everywhere, instantly.
// =========================================================

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  doc, getDoc, updateDoc, collection, onSnapshot,
  writeBatch, deleteDoc,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

// =========================================================
// PAYSTACK — paste your PUBLIC key here (starts with "pk_").
// Find it in your Paystack Dashboard → Settings → API Keys & Webhooks.
// Until this is filled in, online payment will show a friendly
// message instead of crashing.
// =========================================================
const PAYSTACK_PUBLIC_KEY = 'pk_test_c0cc112a225311cb29f99a76526e27c45c5d669c';

const HOSTELS_COLLECTION = 'hostels';
const ROOMS_COLLECTION = 'rooms';
const BOOKINGS_COLLECTION = 'bookings';

/* ---------------------------------------------------------
   Live cache — kept in sync by Firestore listeners, same
   pattern as the admin's script.js.
--------------------------------------------------------- */
let hostelsCache = [];
let roomsCache = [];
let bookingsCache = [];
let paymentSettingsCache = { momoNetwork: 'MTN Mobile Money', momoNumber: '', momoName: '' };
const cachesReady = { hostels: false, rooms: false, bookings: false };
let activeCampusFilter = '';

// UEW's three campuses in Winneba, with their real map coordinates —
// used so "North Campus" etc. can rank hostels by actual distance.
const CAMPUSES = ['North Campus', 'South Campus', 'Central Campus'];
const CAMPUS_COORDS = {
  'North Campus': { lat: 5.363087, lng: -0.632150 },
  'South Campus': { lat: 5.339680, lng: -0.626243 },
  'Central Campus': { lat: 5.345888, lng: -0.625328 },
};

// Pulls a lat/lng pair out of a pasted Google Maps link, when the
// link actually contains visible coordinates. This works for a full
// link copied from the address bar or from "Share > Copy link" on a
// place pin. It will NOT work for a shortened link (maps.app.goo.gl/...)
// since those hide the coordinates until opened in a browser.
function extractLatLngFromMapLink(url) {
  if (!url) return null;
  let m = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/); // precise place pin
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
  m = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/); // map view center
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
  m = url.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/); // ?q=lat,lng
  if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
  return null;
}

// Straight-line distance between two lat/lng points, in kilometers.
function distanceKm(a, b) {
  const R = 6371;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinDLng * sinDLng;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function getHostels() { return hostelsCache; }
function getRooms() { return roomsCache; }
function getBookings() { return bookingsCache; }
function getPaymentSettings() { return paymentSettingsCache; }

function makeId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

// Saves ONE room's updated fields back to Firestore (used when
// a booking fills a bed) without touching any other room.
async function updateRoomDoc(roomId, changes) {
  const batch = writeBatch(db);
  batch.set(doc(db, ROOMS_COLLECTION, roomId), changes, { merge: true });
  await batch.commit();
}

// Adds ONE new booking document to Firestore.
async function addBookingDoc(booking) {
  const { id, ...data } = booking;
  const batch = writeBatch(db);
  batch.set(doc(db, BOOKINGS_COLLECTION, id), data);
  await batch.commit();
}

// Updates ONE booking's fields — used to flip a booking from
// "pending" to "confirmed" the moment Paystack confirms payment.
async function updateBookingDoc(bookingId, changes) {
  const batch = writeBatch(db);
  batch.set(doc(db, BOOKINGS_COLLECTION, bookingId), changes, { merge: true });
  await batch.commit();
}

// If a student closes the Paystack popup without paying, this
// undoes the bed hold and removes the never-paid booking record,
// so nothing is left cluttering the lists for a payment that
// never happened.
async function releaseUnpaidBooking(booking) {
  if (booking.roomId) {
    const room = getRooms().find((r) => r.id === booking.roomId);
    if (room) await updateRoomDoc(room.id, { filled: Math.max(0, Number(room.filled) - 1) });
  }
  await deleteDoc(doc(db, BOOKINGS_COLLECTION, booking.id));
}

// Opens the Paystack checkout popup. Handles card, Mobile Money,
// and bank transfer — whatever the student's Paystack account
// supports. amountGHS is in cedis; Paystack itself wants kobo
// (pesewas), hence the ×100.
//
// If the hostel has a Paystack Subaccount Code set (admin fills this
// in on the Hostels page, once per hostel), the hostel manager's
// share is sent straight to their own Mobile Money/bank account —
// weCare's cut (companyCutGHS) stays behind automatically. Leave it
// blank on a hostel and the full payment just goes to the main
// weCare Paystack account, same as before.
function payWithPaystack({ amountGHS, companyCutGHS, subaccountCode, email, reference, onSuccess, onClose }) {
  // If anything stops the payment window from opening, tell the
  // student and call onClose so the held bed is released and the
  // button goes back to normal (instead of getting stuck).
  const fail = (message) => {
    alert(message);
    if (onClose) onClose();
  };

  if (!window.PaystackPop) {
    return fail('The payment system failed to load. Please check your internet connection and try again.');
  }
  if (!PAYSTACK_PUBLIC_KEY || PAYSTACK_PUBLIC_KEY.startsWith('PASTE_')) {
    return fail("Online payment isn't switched on yet — the admin still needs to add the Paystack key.");
  }
  if (!email) {
    return fail('Your account has no email address, so payment cannot start. Please contact the admin.');
  }

  const options = {
    key: PAYSTACK_PUBLIC_KEY,
    email,
    amount: Math.round(amountGHS * 100),
    currency: 'GHS',
    ref: reference,
    // No "channels" list on purpose: Paystack then shows every payment
    // method switched on for your account (Mobile Money, card, bank…).
    callback: (response) => onSuccess(response),
    onClose: () => { if (onClose) onClose(); },
  };

  if (subaccountCode) {
    options.subaccount = subaccountCode;
    // weCare's cut is a flat amount taken off the top; the rest of
    // the payment goes straight to the hostel manager's subaccount.
    options.transaction_charge = Math.round((companyCutGHS || 0) * 100);
    // weCare's main account absorbs the Paystack transaction fee,
    // so the hostel manager always receives their full share.
    options.bearer = 'account';
  }

  try {
    const handler = window.PaystackPop.setup(options);
    handler.openIframe();
  } catch (err) {
    console.error('Paystack could not open:', err);
    fail('The payment window could not open (' + (err && err.message ? err.message : 'unknown error') + '). Please try again.');
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[m]));
}

// Asks Cloudinary to serve a small, compressed, CROPPED version of
// a photo instead of the full original — used for thumbnails where
// a fixed frame size matters more than showing the whole image.
function cloudinaryThumb(url, width, height) {
  if (!url || !url.includes('/upload/')) return url;
  return url.replace('/upload/', `/upload/w_${width},h_${height},c_fill,g_auto,q_auto,f_auto/`);
}

// Like cloudinaryThumb, but NEVER crops — just shrinks the photo
// down if it's larger than maxWidth, keeping its original shape
// and full contents intact. Used for the full-size lightbox view.
function cloudinaryFull(url, maxWidth) {
  if (!url || !url.includes('/upload/')) return url;
  return url.replace('/upload/', `/upload/w_${maxWidth},c_limit,q_auto,f_auto/`);
}

/* ---------------------------------------------------------
   Client identity — from Firebase Auth + the "users" collection
--------------------------------------------------------- */
let currentClientProfile = null;
function getCurrentClient() { return currentClientProfile; }

async function loadCurrentClientProfile(user) {
  const userDoc = await getDoc(doc(db, 'users', user.uid));
  if (!userDoc.exists()) return null;
  const data = userDoc.data();
  return {
    id: user.uid,
    fullName: data.fullName || '',
    email: data.email || user.email || '',
    phone: data.phone || '',
  };
}

/* ---------------------------------------------------------
   Hostel viewings — a student can pay a small fee to book a
   visit to see the hostel in person. Visits always happen on
   a Friday, so this works out which upcoming Friday that is.
--------------------------------------------------------- */
const VIEWING_FEE = 50;

function nextFridayDate() {
  const d = new Date();
  const day = d.getDay(); // 0 = Sunday ... 5 = Friday ... 6 = Saturday
  const diff = day <= 5 ? 5 - day : 5 - day + 7;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

async function clientBookViewing(hostelId) {
  const client = getCurrentClient();
  if (!client) return { ok: false, message: 'You need to be logged in to book a viewing.' };

  const hostel = getHostels().find((h) => h.id === hostelId);
  if (!hostel) return { ok: false, message: 'That hostel no longer exists.' };

  const viewing = {
    id: makeId(),
    type: 'viewing',
    roomId: '',
    hostel: hostel.name,
    roomType: 'Hostel Viewing',
    capacity: '',
    price: VIEWING_FEE,
    companyCut: VIEWING_FEE,
    ownerPayout: 0,
    studentId: client.id,
    studentName: client.fullName,
    phone: client.phone,
    batchNumber: generateBatchNumber(),
    bookedAt: new Date().toISOString().slice(0, 10),
    moveInDate: nextFridayDate(),
    moveOutDate: '',
    // Viewing fee is paid in person at the visit, not online — so
    // this is booked as 'confirmed' right away rather than waiting
    // on a payment step.
    status: 'confirmed',
    checkedIn: false,
  };

  await addBookingDoc(viewing);
  return { ok: true, booking: viewing };
}

/* ---------------------------------------------------------
   Booking logic
--------------------------------------------------------- */
function generateBatchNumber() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return `WC-${code}`;
}

function computeRevenueSplit(price, hostel) {
  const type = hostel?.commissionType || 'fixed';
  const value = Number(hostel?.commissionValue) || 0;
  let companyCut = type === 'percent' ? Math.round(price * (value / 100)) : value;
  companyCut = Math.max(0, Math.min(companyCut, price));
  return { companyCut, ownerPayout: price - companyCut };
}

async function clientBookRoom(roomId, moveInDate) {
  const client = getCurrentClient();
  if (!client) return { ok: false, message: 'You need to be logged in to book.' };
  if (!cachesReady.hostels || !cachesReady.rooms || !cachesReady.bookings) {
    return { ok: false, message: 'Still loading — please wait a moment and try again.' };
  }

  const room = getRooms().find((r) => r.id === roomId);
  if (!room) return { ok: false, message: 'That room type no longer exists.' };
  if (Number(room.filled) >= Number(room.beds)) return { ok: false, message: 'This room type just filled up.' };

  const hostelObj = getHostels().find((h) => h.name === room.hostel);
  const { companyCut, ownerPayout } = computeRevenueSplit(room.price, hostelObj);
  const moveOutDate = hostelObj?.moveOutDate || '';

  const booking = {
    id: makeId(),
    roomId: room.id,
    hostel: room.hostel,
    roomType: room.capacity === '1' ? '1-in-a-Room' : `${room.capacity}-in-a-Room`,
    capacity: room.capacity,
    price: room.price,
    companyCut,
    ownerPayout,
    studentId: client.id,
    studentName: client.fullName,
    phone: client.phone,
    batchNumber: generateBatchNumber(),
    bookedAt: new Date().toISOString().slice(0, 10),
    moveInDate,
    moveOutDate,
    // The bed is reserved right away so nobody else can take it
    // while the Paystack popup is open. If payment succeeds this
    // flips to 'confirmed'; if the student closes the popup without
    // paying, releaseUnpaidBooking() frees the bed again.
    status: 'pending',
    checkedIn: false,
  };

  await updateRoomDoc(room.id, { filled: Number(room.filled) + 1 });
  await addBookingDoc(booking);

  return { ok: true, booking };
}

/* ---------------------------------------------------------
   Campus filter chips — fixed to UEW's three campuses.
   Clicking one also sorts the results, closest-first, using
   whatever Google Maps link the admin pasted for each hostel.
--------------------------------------------------------- */
function renderCampusFilterChips() {
  const wrap = document.getElementById('locationFilterChips');
  if (!wrap) return;

  const options = ['', ...CAMPUSES];
  wrap.innerHTML = options.map((campus) => {
    const label = campus === '' ? 'All Campuses' : campus;
    const isActive = activeCampusFilter === campus;
    return `<button type="button" class="chip${isActive ? ' is-active' : ''}" data-campus="${escapeHtml(campus)}">${escapeHtml(label)}</button>`;
  }).join('');

  wrap.querySelectorAll('[data-campus]').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeCampusFilter = btn.dataset.campus;
      renderCampusFilterChips();
      renderHostelGrid(document.getElementById('hostelSearch')?.value || '');
    });
  });
}

/* ---------------------------------------------------------
   Rendering — Browse Hostels grid
--------------------------------------------------------- */
function renderHostelGrid(filterText) {
  const grid = document.getElementById('clientHostelGrid');
  if (!grid) return;

  const hostels = getHostels().filter((h) => h.status === 'active');
  const rooms = getRooms();
  const q = (filterText || '').trim().toLowerCase();
  let filtered = hostels.filter((h) =>
    (!q || h.name.toLowerCase().includes(q) || h.location.toLowerCase().includes(q)) &&
    (!activeCampusFilter || h.campus === activeCampusFilter)
  );

  // When a campus is selected, rank hostels closest-first using the
  // Google Maps link on each one. Hostels with no usable coordinates
  // (e.g. a shortened link) are kept, just placed after the ranked ones.
  if (activeCampusFilter && CAMPUS_COORDS[activeCampusFilter]) {
    const target = CAMPUS_COORDS[activeCampusFilter];
    filtered = filtered
      .map((h) => ({ h, dist: (() => {
        const coords = extractLatLngFromMapLink(h.mapLink);
        return coords ? distanceKm(coords, target) : Infinity;
      })() }))
      .sort((a, b) => a.dist - b.dist)
      .map((x) => x.h);
  }

  if (filtered.length === 0) {
    grid.innerHTML = `<p class="table__muted-note">No hostels match your search.</p>`;
    return;
  }

  grid.innerHTML = filtered.map((h) => {
    const hostelRooms = rooms.filter((r) => r.hostel === h.name);
    const totalBeds = hostelRooms.reduce((sum, r) => sum + Number(r.beds || 0), 0);
    const filledBeds = hostelRooms.reduce((sum, r) => sum + Number(r.filled || 0), 0);
    const openBeds = Math.max(0, totalBeds - filledBeds);
    const lowestPrice = hostelRooms.length
      ? Math.min(...hostelRooms.map((r) => Number(r.price) || Infinity))
      : null;
    const initial = h.name.trim().charAt(0).toUpperCase();
    // Note: this uses a client-only class name (client-hostel-photo)
    // so it can never collide with the admin stylesheet's own
    // .hostel-card__photo rule (styles.css and client-styles.css
    // are both loaded on this page).
    const blockInner = h.photoURL
      ? `<img src="${escapeHtml(cloudinaryThumb(h.photoURL, 300, 96))}" alt="${escapeHtml(h.name)}" class="client-hostel-photo" loading="lazy">`
      : escapeHtml(initial);

    return `
      <article class="hostel-card" data-id="${escapeHtml(h.id)}">
        <div class="hostel-card__block">${blockInner}</div>
        <div class="hostel-card__body">
          <h3>${escapeHtml(h.name)}</h3>
          <p class="hostel-card__location">${escapeHtml(h.location)}</p>
          ${h.mapLink ? `<a class="hostel-card__maplink" href="${escapeHtml(h.mapLink)}" target="_blank" rel="noopener">View on Google Maps</a>` : ''}
          <div class="hostel-card__meta">
            ${openBeds > 0 ? `<span class="pill pill--available">${openBeds} beds open</span>` : `<span class="pill pill--full">Full</span>`}
            ${lowestPrice ? `<span>From GHS ${lowestPrice.toLocaleString()}</span>` : ''}
          </div>
        </div>
        <button class="btn btn--primary btn--block" type="button" data-view-hostel="${escapeHtml(h.id)}">
          View rooms
        </button>
      </article>
    `;
  }).join('');

  grid.querySelectorAll('[data-view-hostel]').forEach((btn) => {
    btn.addEventListener('click', () => openRoomModal(btn.dataset.viewHostel));
  });
}

/* ---------------------------------------------------------
   Room picker modal
--------------------------------------------------------- */
function openRoomModal(hostelId) {
  const hostel = getHostels().find((h) => h.id === hostelId);
  if (!hostel) return;

  document.getElementById('modalHostelName').textContent = hostel.name;
  const locationEl = document.getElementById('modalHostelLocation');
  locationEl.innerHTML = hostel.mapLink
    ? `${escapeHtml(hostel.location)} · <a href="${escapeHtml(hostel.mapLink)}" target="_blank" rel="noopener">View on Google Maps</a>`
    : escapeHtml(hostel.location);

  const rooms = getRooms().filter((r) => r.hostel === hostel.name);
  const list = document.getElementById('modalRoomList');

  const viewingOfferHtml = `
    <div class="viewing-offer">
      <p>Want to see this hostel in person before booking?</p>
      <button class="btn btn--ghost btn--block" type="button" id="bookViewingBtn">Book a Viewing — GHS ${VIEWING_FEE} (Fridays)</button>
    </div>
  `;

  if (rooms.length === 0) {
    list.innerHTML = viewingOfferHtml + `<p class="table__muted-note">No room types listed yet for this hostel.</p>`;
  } else {
    list.innerHTML = viewingOfferHtml + rooms.map((r) => {
      const open = Math.max(0, Number(r.beds) - Number(r.filled));
      const label = r.capacity === '1' ? '1 student / room' : `${r.capacity} students / room`;
      const photosHtml = r.photoURLs?.length
        ? `<div class="client-modal__room-photos">${r.photoURLs.map((url, i) =>
            `<img src="${escapeHtml(cloudinaryThumb(url, 220, 150))}" alt="" loading="lazy" data-lightbox-room="${escapeHtml(r.id)}" data-lightbox-index="${i}">`).join('')}</div>`
        : '';
      return `
        <div class="client-modal__room">
          ${photosHtml}
          <div class="client-modal__room-info">
            <p class="client-modal__room-type">${escapeHtml(label)}</p>
            <p class="client-modal__room-price">GHS ${Number(r.price).toLocaleString()} / semester</p>
            <p class="client-modal__room-open">${open > 0 ? `${open} bed${open === 1 ? '' : 's'} open` : 'Full'}</p>
          </div>
          <button class="btn btn--primary" type="button" data-book-room="${escapeHtml(r.id)}" ${open <= 0 ? 'disabled' : ''}>
            ${open > 0 ? 'Book this room' : 'Full'}
          </button>
        </div>
      `;
    }).join('');

    list.querySelectorAll('[data-book-room]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const room = rooms.find((r) => r.id === btn.dataset.bookRoom);
        if (room) renderPaymentStep(hostel, room);
      });
    });

    // Lightbox thumbnails use cloudinaryFull (NOT cloudinaryThumb) —
    // the full-size viewer must never crop the photo, only shrink it.
    list.querySelectorAll('[data-lightbox-room]').forEach((thumb) => {
      thumb.addEventListener('click', () => {
        const room = rooms.find((r) => r.id === thumb.dataset.lightboxRoom);
        if (!room?.photoURLs?.length) return;
        const fullSizeUrls = room.photoURLs.map((url) => cloudinaryFull(url, 1200));
        openLightbox(fullSizeUrls, Number(thumb.dataset.lightboxIndex));
      });
    });
  }

  document.getElementById('bookViewingBtn')?.addEventListener('click', () => {
    renderViewingStep(hostel);
  });

  document.getElementById('roomModal').style.display = 'flex';
}

/* ---------------------------------------------------------
   Viewing step — shown inside the room modal when a student
   wants to book a visit to see the hostel in person. The
   viewing fee is paid physically, in person, when they meet —
   no online payment for this step.
--------------------------------------------------------- */
function renderViewingStep(hostel) {
  const list = document.getElementById('modalRoomList');
  if (!list) return;

  const visitDate = nextFridayDate();

  list.innerHTML = `
    <div class="payment-step">
      <p class="payment-step__room">Hostel Viewing — ${escapeHtml(hostel.name)}</p>
      <p class="payment-step__price">GHS ${VIEWING_FEE} viewing fee</p>
      <p class="table__muted-note">Viewings happen every Friday. Your visit will be on <strong>${escapeHtml(visitDate)}</strong>.</p>
      <p class="table__muted-note">Pay the GHS ${VIEWING_FEE} viewing fee in person when you meet us for the visit.</p>
      <p class="table__muted-note">We will call or WhatsApp you on <strong>${escapeHtml(getCurrentClient().phone)}</strong>. Wrong number? Fix it in <a href="#" onclick="closeRoomModal();openProfile();return false;">My Profile</a>.</p>
      <button class="btn btn--primary btn--block" type="button" id="confirmViewingBtn">Confirm Viewing</button>
      <button class="btn btn--ghost btn--block" type="button" id="backToRoomsBtnViewing">Back</button>
    </div>
  `;

  document.getElementById('backToRoomsBtnViewing').addEventListener('click', () => openRoomModal(hostel.id));

  const confirmBtn = document.getElementById('confirmViewingBtn');
  if (!confirmBtn) return;

  confirmBtn.addEventListener('click', async () => {
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Booking…';
    let result;
    try {
      result = await clientBookViewing(hostel.id);
    } catch (err) {
      console.error('Viewing could not be saved:', err);
      result = { ok: false, message: 'Your viewing could not be saved (' + (err.code || err.message) + '). Please tell the admin.' };
    }
    if (!result.ok) {
      alert(result.message);
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Confirm Viewing';
      return;
    }

    list.innerHTML = `
      <div class="payment-step">
        <p class="payment-step__processing">Viewing booked!</p>
        <p class="table__muted-note">Your batch number is <strong>${escapeHtml(result.booking.batchNumber)}</strong> — save this.
          Your viewing is on <strong>${escapeHtml(result.booking.moveInDate)}</strong>. Pay GHS ${VIEWING_FEE} in person when you meet us.</p>
        <button class="btn btn--primary btn--block" type="button" id="viewingDoneBtn">Done</button>
      </div>
    `;
    document.getElementById('viewingDoneBtn').addEventListener('click', closeRoomModal);
  });
}

/* ---------------------------------------------------------
   Payment step — shown inside the room modal after a student
   picks a room. Payment goes through Paystack; the bed is
   confirmed the instant payment succeeds — no manual admin
   confirmation step needed anymore.
--------------------------------------------------------- */
function renderPaymentStep(hostel, room) {
  const list = document.getElementById('modalRoomList');
  if (!list) return;

  const label = room.capacity === '1' ? '1 student / room' : `${room.capacity} students / room`;
  const priceLabel = Number(room.price).toLocaleString();

  list.innerHTML = `
    <div class="payment-step">
      <p class="payment-step__room">${escapeHtml(label)} — ${escapeHtml(hostel.name)}</p>
      <p class="payment-step__price">GHS ${priceLabel} / semester</p>
      <div class="field">
        <label for="moveInDate">Move-in date</label>
        <input type="date" id="moveInDate" required>
      </div>
      ${hostel.moveOutDate ? `<p class="table__muted-note">Move-out date for this hostel: <strong>${escapeHtml(hostel.moveOutDate)}</strong></p>` : ''}
      <p class="table__muted-note">Pay securely online with Paystack (card, Mobile Money, or bank). Your bed is booked the instant payment goes through.</p>
      <button class="btn btn--primary btn--block" type="button" id="payNowBtn">Pay GHS ${priceLabel} Now</button>
      <button class="btn btn--ghost btn--block" type="button" id="backToRoomsBtn">Back</button>
    </div>
  `;

  document.getElementById('backToRoomsBtn').addEventListener('click', () => openRoomModal(hostel.id));

  const payBtn = document.getElementById('payNowBtn');
  if (!payBtn) return;
  const resetBtn = () => { payBtn.disabled = false; payBtn.textContent = `Pay GHS ${priceLabel} Now`; };

  payBtn.addEventListener('click', async () => {
    const moveInDate = document.getElementById('moveInDate').value;
    if (!moveInDate) {
      alert('Please choose your move-in date.');
      return;
    }

    payBtn.disabled = true;
    payBtn.textContent = 'Opening payment…';
    let result;
    try {
      result = await clientBookRoom(room.id, moveInDate);
    } catch (err) {
      console.error('Booking could not be saved:', err);
      result = { ok: false, message: 'Your booking could not be saved (' + (err.code || err.message) + '). Please tell the admin.' };
    }
    if (!result.ok) {
      alert(result.message);
      resetBtn();
      return;
    }

    const client = getCurrentClient();
    payWithPaystack({
      amountGHS: room.price,
      companyCutGHS: result.booking.companyCut,
      subaccountCode: hostel.paystackSubaccount || '',
      email: client.email,
      reference: result.booking.batchNumber,
      onSuccess: async () => {
        await updateBookingDoc(result.booking.id, { status: 'confirmed' });
        list.innerHTML = `
          <div class="payment-step">
            <p class="payment-step__processing">Payment successful!</p>
            <p class="table__muted-note">Your batch number is <strong>${escapeHtml(result.booking.batchNumber)}</strong> — save this. Your bed is booked.</p>
            <button class="btn btn--primary btn--block" type="button" id="paymentDoneBtn">Done</button>
          </div>
        `;
        document.getElementById('paymentDoneBtn').addEventListener('click', closeRoomModal);
      },
      onClose: async () => {
        await releaseUnpaidBooking(result.booking);
        resetBtn();
      },
    });
  });
}

/* ---------------------------------------------------------
   Photo lightbox — click a room thumbnail to browse full-size
--------------------------------------------------------- */
let lightboxPhotos = [];
let lightboxIndex = 0;

function openLightbox(photos, startIndex) {
  lightboxPhotos = photos;
  lightboxIndex = startIndex;
  renderLightboxImage();
  document.getElementById('photoLightbox').style.display = 'flex';
}

function renderLightboxImage() {
  const img = document.getElementById('lightboxImage');
  const counter = document.getElementById('lightboxCounter');
  img.src = lightboxPhotos[lightboxIndex];
  counter.textContent = `${lightboxIndex + 1} / ${lightboxPhotos.length}`;
}

function lightboxNext() {
  lightboxIndex = (lightboxIndex + 1) % lightboxPhotos.length;
  renderLightboxImage();
}

function lightboxPrev() {
  lightboxIndex = (lightboxIndex - 1 + lightboxPhotos.length) % lightboxPhotos.length;
  renderLightboxImage();
}

function closeLightbox() {
  document.getElementById('photoLightbox').style.display = 'none';
}

function initLightbox() {
  document.getElementById('lightboxCloseBtn').addEventListener('click', closeLightbox);
  document.getElementById('lightboxNextBtn').addEventListener('click', lightboxNext);
  document.getElementById('lightboxPrevBtn').addEventListener('click', lightboxPrev);
  document.addEventListener('keydown', (e) => {
    if (document.getElementById('photoLightbox').style.display !== 'flex') return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowRight') lightboxNext();
    if (e.key === 'ArrowLeft') lightboxPrev();
  });
}

function closeRoomModal() {
  document.getElementById('roomModal').style.display = 'none';
}

/* ---------------------------------------------------------
   My Bookings — ticket-stub cards
--------------------------------------------------------- */
function renderMyBookings() {
  const client = getCurrentClient();
  const list = document.getElementById('myBookingsList');
  if (!client || !list) return;

  const mine = getBookings().filter((b) => b.studentId === client.id);

  if (mine.length === 0) {
    list.innerHTML = `<div class="empty-state">You haven't booked a room yet — browse hostels above to get started.</div>`;
    return;
  }

  list.innerHTML = mine.map((b) => `
    <div class="booking-ticket">
      <div class="booking-ticket__main">
        <h3>${escapeHtml(b.hostel)}</h3>
        <p>${escapeHtml(b.roomType)} · Booked ${escapeHtml(b.bookedAt)}</p>
        ${b.type === 'viewing'
          ? `<p>Viewing date: ${escapeHtml(b.moveInDate)}</p>`
          : b.moveInDate ? `<p>Stay: ${escapeHtml(b.moveInDate)} → ${escapeHtml(b.moveOutDate)}</p>` : ''}
        <p class="booking-ticket__code">${escapeHtml(b.batchNumber)}</p>
      </div>
      <div class="booking-ticket__right">
        <p class="booking-ticket__price">GHS ${Number(b.price).toLocaleString()}</p>
        ${b.status === 'cancelled'
          ? '<span class="pill pill--full">Cancelled</span>'
          : b.status === 'pending'
            ? '<span class="pill pill--warning">Processing Payment</span>'
            : b.checkedIn
              ? '<span class="pill pill--available">Checked in</span>'
              : '<span class="pill pill--warning">Awaiting check-in</span>'}
        ${b.status === 'confirmed' ? `<button class="btn btn--ghost" type="button" data-qr="${escapeHtml(b.batchNumber)}" style="margin-top:8px;">Show QR</button>` : ''}
      </div>
    </div>
  `).join('');

  list.querySelectorAll('[data-qr]').forEach((btn) => {
    btn.addEventListener('click', () => showBookingQr(mine.find((b) => b.batchNumber === btn.dataset.qr)));
  });
}

function showBookingQr(b) {
  if (!b) return;
  const box = document.getElementById('qrBox');
  box.innerHTML = '';
  if (typeof QRCode === 'undefined') { box.textContent = 'QR could not load. Check your internet and try again.'; }
  else {
    new QRCode(box, { text: 'WECARE:' + b.batchNumber + ':' + b.studentName, width: 220, height: 220, correctLevel: QRCode.CorrectLevel.M });
  }
  document.getElementById('qrCaption').textContent = b.studentName + ' · ' + b.hostel + ' · ' + b.batchNumber;
  document.getElementById('qrDownloadBtn').onclick = () => {
    const canvas = box.querySelector('canvas');
    const img = box.querySelector('img');
    const url = canvas ? canvas.toDataURL('image/png') : (img ? img.src : '');
    if (!url) return;
    const a = document.createElement('a');
    a.href = url; a.download = 'weCare-' + b.batchNumber + '.png'; a.click();
  };
  document.getElementById('qrModal').style.display = 'flex';
}

/* ---------------------------------------------------------
   My Profile — edit name/phone, see viewings & bookings history
--------------------------------------------------------- */
function renderProfile() {
  const client = getCurrentClient();
  const box = document.getElementById('profileBox');
  if (!client || !box) return;
  // Don't wipe the form while the student is typing in it
  if (box.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') {
    renderProfileHistory();
    return;
  }
  box.innerHTML = `
    <form id="profileForm" class="profile-form">
      <label>Full name<input type="text" id="profName" required value="${escapeHtml(client.fullName)}"></label>
      <label>Phone number<input type="tel" id="profPhone" required value="${escapeHtml(client.phone)}" placeholder="e.g. 024 555 1234"></label>
      <p class="table__muted-note">Use the <strong>same number you pay with (Mobile Money)</strong>. It must be a number we can <strong>call and WhatsApp</strong>. You can change it here anytime.</p>
      <label>Email<input type="email" value="${escapeHtml(client.email)}" disabled></label>
      <p class="profile-form__msg" id="profMsg"></p>
      <button class="btn btn--primary" type="submit" id="profSaveBtn">Save details</button>
    </form>
    <div id="profileHistory"></div>`;
  document.getElementById('profileForm').addEventListener('submit', saveProfile);
  renderProfileHistory();
}

function renderProfileHistory() {
  const client = getCurrentClient();
  const el = document.getElementById('profileHistory');
  if (!client || !el) return;
  const mine = getBookings().filter((b) => b.studentId === client.id && b.status !== 'cancelled');
  const viewings = mine.filter((b) => b.type === 'viewing');
  const rooms = mine.filter((b) => b.type !== 'viewing');
  const today = new Date().toISOString().slice(0, 10);
  const visited = viewings.filter((b) => b.moveInDate && b.moveInDate < today);
  const hostelsSeen = [...new Set(viewings.map((b) => b.hostel))];
  el.innerHTML = `
    <div class="profile-stats">
      <div><strong>${viewings.length}</strong><span>Viewings booked</span></div>
      <div><strong>${visited.length}</strong><span>Viewings done</span></div>
      <div><strong>${rooms.length}</strong><span>Room bookings</span></div>
    </div>
    ${viewings.length ? `<h3 class="profile-h">Hostels you've viewed</h3>
      <ul class="profile-list">${viewings.map((b) => `<li><strong>${escapeHtml(b.hostel)}</strong><span>${escapeHtml(b.moveInDate)}${b.moveInDate < today ? ' · done' : ' · coming up'}</span></li>`).join('')}</ul>` : ''}
    ${rooms.length ? `<h3 class="profile-h">Hostels you've booked</h3>
      <ul class="profile-list">${rooms.map((b) => `<li><strong>${escapeHtml(b.hostel)}</strong><span>${escapeHtml(b.roomType)} · ${escapeHtml(b.bookedAt)}</span></li>`).join('')}</ul>` : ''}
    ${(!viewings.length && !rooms.length) ? '<p class="table__muted-note">Nothing yet — your viewings and bookings will show here.</p>' : ''}`;
}

async function saveProfile(e) {
  e.preventDefault();
  const client = getCurrentClient();
  const msg = document.getElementById('profMsg');
  const btn = document.getElementById('profSaveBtn');
  const fullName = document.getElementById('profName').value.trim();
  const phone = document.getElementById('profPhone').value.trim();
  if (!fullName || !phone) { msg.textContent = 'Please fill in your name and phone number.'; return; }
  btn.disabled = true; msg.textContent = 'Saving…';
  try {
    await updateDoc(doc(db, 'users', client.id), { fullName, phone });
    client.fullName = fullName; client.phone = phone;
    const welcome = document.getElementById('welcomeName');
    if (welcome) welcome.textContent = 'Hi, ' + fullName.split(' ')[0];
    msg.textContent = 'Saved ✓';
  } catch (err) {
    console.error('Profile save failed:', err);
    msg.textContent = 'Could not save (' + (err.code || err.message) + ').';
  }
  btn.disabled = false;
}

/* ---------------------------------------------------------
   Live sync — mirrors the admin's script.js pattern
--------------------------------------------------------- */
function startLiveSync() {
  const searchInput = document.getElementById('hostelSearch');
  function currentSearch() { return searchInput ? searchInput.value : ''; }

  function maybeRender() {
    if (!cachesReady.hostels || !cachesReady.rooms || !cachesReady.bookings) return;
    renderCampusFilterChips();
    renderHostelGrid(currentSearch());
    renderMyBookings();
    renderProfile();
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
  onSnapshot(doc(db, 'settings', 'payment'), (snap) => {
    if (snap.exists()) paymentSettingsCache = { ...paymentSettingsCache, ...snap.data() };
  });
}

/* ---------------------------------------------------------
   Boot the portal
--------------------------------------------------------- */
export function initClientPortal() {
  onAuthStateChanged(auth, async (user) => {
    if (!user) return; // auth-guard.js handles the redirect
    currentClientProfile = await loadCurrentClientProfile(user);

    const welcome = document.getElementById('welcomeName');
    if (currentClientProfile && welcome) {
      welcome.textContent = `Hi, ${currentClientProfile.fullName.split(' ')[0]}`;
    }

    startLiveSync();
  });
}

window.renderHostelGrid = renderHostelGrid;
function openProfile() { renderProfile(); document.getElementById('profileModal').style.display = 'flex'; }
function closeProfile() { document.getElementById('profileModal').style.display = 'none'; }
window.openProfile = openProfile;
window.closeProfile = closeProfile;
window.closeRoomModal = closeRoomModal;
window.initLightbox = initLightbox;