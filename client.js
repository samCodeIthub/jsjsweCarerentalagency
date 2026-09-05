// =========================================================
// weCare Client Portal — client.js
// Hostels/rooms/bookings read/write Firestore, matching the
// admin's script.js — so anything added by the admin (or
// booked by any student) shows up everywhere, instantly.
// =========================================================

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  doc, getDoc, collection, onSnapshot,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

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
    // while the admin verifies the Mobile Money payment — but the
    // booking only becomes real once they confirm it on their end.
    status: 'pending',
    checkedIn: false,
  };

  await updateRoomDoc(room.id, { filled: Number(room.filled) + 1 });
  await addBookingDoc(booking);

  return { ok: true, booking };
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
  const filtered = hostels.filter((h) =>
    !q || h.name.toLowerCase().includes(q) || h.location.toLowerCase().includes(q)
  );

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
  document.getElementById('modalHostelLocation').textContent = hostel.location;

  const rooms = getRooms().filter((r) => r.hostel === hostel.name);
  const list = document.getElementById('modalRoomList');

  if (rooms.length === 0) {
    list.innerHTML = `<p class="table__muted-note">No room types listed yet for this hostel.</p>`;
  } else {
    list.innerHTML = rooms.map((r) => {
      const open = Math.max(0, Number(r.beds) - Number(r.filled));
      const label = r.capacity === '1' ? '1 student / room' : `${r.capacity} students / room`;
      const photosHtml = r.photoURLs?.length
        ? `<div class="client-modal__room-photos">${r.photoURLs.map((url, i) =>
            `<img src="${escapeHtml(cloudinaryThumb(url, 100, 70))}" alt="" loading="lazy" data-lightbox-room="${escapeHtml(r.id)}" data-lightbox-index="${i}">`).join('')}</div>`
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

  document.getElementById('roomModal').style.display = 'flex';
}

/* ---------------------------------------------------------
   Payment step — shown inside the room modal after a student
   picks a room. Nothing is booked yet; the bed is only reserved
   once they say they've sent the money, and the admin still has
   to confirm the payment before it counts as a real booking.
--------------------------------------------------------- */
function renderPaymentStep(hostel, room) {
  const list = document.getElementById('modalRoomList');
  if (!list) return;

  const settings = getPaymentSettings();
  const label = room.capacity === '1' ? '1 student / room' : `${room.capacity} students / room`;
  const hasNumber = Boolean(settings.momoNumber);

  list.innerHTML = `
    <div class="payment-step">
      <p class="payment-step__room">${escapeHtml(label)} — ${escapeHtml(hostel.name)}</p>
      <p class="payment-step__price">GHS ${Number(room.price).toLocaleString()} / semester</p>
      <div class="payment-step__momo">
        <p class="ticket__label">SEND MOBILE MONEY TO</p>
        <p class="payment-step__number">${hasNumber ? escapeHtml(settings.momoNumber) : 'Contact the admin for a number'}</p>
        ${hasNumber ? `<p class="payment-step__name">${escapeHtml(settings.momoName || '')}${settings.momoName && settings.momoNetwork ? ' · ' : ''}${escapeHtml(settings.momoNetwork || '')}</p>` : ''}
      </div>
      <div class="field">
        <label for="moveInDate">Move-in date</label>
        <input type="date" id="moveInDate" required>
      </div>
      ${hostel.moveOutDate ? `<p class="table__muted-note">Move-out date for this hostel: <strong>${escapeHtml(hostel.moveOutDate)}</strong></p>` : ''}
      <p class="table__muted-note">Send the exact amount above, then tap the button below. We'll verify the payment and confirm your bed — you'll see it update under "My Bookings".</p>
      <button class="btn btn--primary btn--block" type="button" id="confirmSentBtn" ${hasNumber ? '' : 'disabled'}>I've Sent the Payment</button>
      <button class="btn btn--ghost btn--block" type="button" id="backToRoomsBtn">Back</button>
    </div>
  `;

  document.getElementById('backToRoomsBtn').addEventListener('click', () => openRoomModal(hostel.id));

  const sendBtn = document.getElementById('confirmSentBtn');
  if (!sendBtn) return;
  sendBtn.addEventListener('click', async () => {
    const moveInDate = document.getElementById('moveInDate').value;

    if (!moveInDate) {
      alert('Please choose your move-in date.');
      return;
    }

    sendBtn.disabled = true;
    sendBtn.textContent = 'Processing…';
    const result = await clientBookRoom(room.id, moveInDate);
    if (!result.ok) {
      alert(result.message);
      sendBtn.disabled = false;
      sendBtn.textContent = "I've Sent the Payment";
      return;
    }
    list.innerHTML = `
      <div class="payment-step">
        <p class="payment-step__processing">Processing your payment&hellip;</p>
        <p class="table__muted-note">Your batch number is <strong>${escapeHtml(result.booking.batchNumber)}</strong> — save this.
          Once we confirm your payment, this will show as "Awaiting Check-in" under My Bookings.</p>
        <button class="btn btn--primary btn--block" type="button" id="paymentDoneBtn">Done</button>
      </div>
    `;
    document.getElementById('paymentDoneBtn').addEventListener('click', closeRoomModal);
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
        ${b.moveInDate ? `<p>Stay: ${escapeHtml(b.moveInDate)} → ${escapeHtml(b.moveOutDate)}</p>` : ''}
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
      </div>
    </div>
  `).join('');
}

/* ---------------------------------------------------------
   Live sync — mirrors the admin's script.js pattern
--------------------------------------------------------- */
function startLiveSync() {
  const searchInput = document.getElementById('hostelSearch');
  function currentSearch() { return searchInput ? searchInput.value : ''; }

  function maybeRender() {
    if (!cachesReady.hostels || !cachesReady.rooms || !cachesReady.bookings) return;
    renderHostelGrid(currentSearch());
    renderMyBookings();
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
window.closeRoomModal = closeRoomModal;
window.initLightbox = initLightbox;