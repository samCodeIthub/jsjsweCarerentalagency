// =========================================================
// weCare Client Portal — client.js
// Hostels/rooms/bookings still read/write localStorage for
// now (Firestore migration is a separate step) — but client
// IDENTITY now comes from Firebase Auth + Firestore, since
// login/registration moved there.
// =========================================================

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const HOSTELS_KEY = 'wecare_hostels_v1';
const ROOMS_KEY = 'wecare_rooms_v1';
const BOOKINGS_KEY = 'wecare_bookings_v1';

/* ---------------------------------------------------------
   Storage helpers (mirrors admin script.js) — hostels, rooms,
   and bookings are still on localStorage until the Firestore
   data migration step.
--------------------------------------------------------- */
function getHostels() { try { return JSON.parse(localStorage.getItem(HOSTELS_KEY)) || []; } catch { return []; } }
function getRooms() { try { return JSON.parse(localStorage.getItem(ROOMS_KEY)) || []; } catch { return []; } }
function setRooms(list) { localStorage.setItem(ROOMS_KEY, JSON.stringify(list)); }
function getBookings() { try { return JSON.parse(localStorage.getItem(BOOKINGS_KEY)) || []; } catch { return []; } }
function setBookings(list) { localStorage.setItem(BOOKINGS_KEY, JSON.stringify(list)); }

function makeId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[m]));
}

/* ---------------------------------------------------------
   Client identity — now sourced from Firebase Auth + the
   "users" Firestore collection (role/fullName/phone etc.),
   populated once on page load and cached here.
--------------------------------------------------------- */
let currentClientProfile = null;

function getCurrentClient() {
  return currentClientProfile;
}

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

function clientBookRoom(roomId) {
  const client = getCurrentClient();
  if (!client) return { ok: false, message: 'You need to be logged in to book.' };

  const rooms = getRooms();
  const room = rooms.find((r) => r.id === roomId);
  if (!room) return { ok: false, message: 'That room type no longer exists.' };
  if (Number(room.filled) >= Number(room.beds)) return { ok: false, message: 'This room type just filled up.' };

  room.filled = Number(room.filled) + 1;
  setRooms(rooms);

  const hostelObj = getHostels().find((h) => h.name === room.hostel);
  const { companyCut, ownerPayout } = computeRevenueSplit(room.price, hostelObj);

  const bookings = getBookings();
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
    status: 'confirmed',
    checkedIn: false,
  };
  bookings.unshift(booking);
  setBookings(bookings);
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

    return `
      <article class="hostel-card" data-id="${escapeHtml(h.id)}">
        <div class="hostel-card__block">${escapeHtml(initial)}</div>
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
      return `
        <div class="client-modal__room">
          <div>
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
        if (!confirm('Confirm you want to book this room? This reserves your bed and generates your batch number.')) return;
        const result = clientBookRoom(btn.dataset.bookRoom);
        if (!result.ok) {
          alert(result.message);
          return;
        }
        alert(`Booked! Your batch number is ${result.booking.batchNumber}. Save this — you'll need it at check-in.`);
        closeRoomModal();
        renderHostelGrid('');
        renderMyBookings();
      });
    });
  }

  document.getElementById('roomModal').style.display = 'flex';
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
        <p class="booking-ticket__code">${escapeHtml(b.batchNumber)}</p>
      </div>
      <div class="booking-ticket__right">
        <p class="booking-ticket__price">GHS ${Number(b.price).toLocaleString()}</p>
        ${b.status === 'cancelled'
          ? '<span class="pill pill--full">Cancelled</span>'
          : b.checkedIn
            ? '<span class="pill pill--available">Checked in</span>'
            : '<span class="pill pill--warning">Awaiting check-in</span>'}
      </div>
    </div>
  `).join('');
}

/* ---------------------------------------------------------
   Boot the portal — waits for Firebase to confirm who's
   logged in, loads their profile, THEN renders the page.
--------------------------------------------------------- */
export function initClientPortal() {
  onAuthStateChanged(auth, async (user) => {
    if (!user) return; // auth-guard.js handles the redirect
    currentClientProfile = await loadCurrentClientProfile(user);

    const welcome = document.getElementById('welcomeName');
    if (currentClientProfile && welcome) {
      welcome.textContent = `Hi, ${currentClientProfile.fullName.split(' ')[0]}`;
    }

    renderHostelGrid('');
    renderMyBookings();
  });
}

// Expose the functions the inline script on client-portal.html needs
window.renderHostelGrid = renderHostelGrid;
window.closeRoomModal = closeRoomModal;