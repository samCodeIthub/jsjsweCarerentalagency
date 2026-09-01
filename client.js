// =========================================================
// weCare Client Portal — client.js
// Hostels/rooms/bookings now read/write Firestore, matching
// the admin's script.js — so anything added by the admin (or
// booked by any student) shows up everywhere, instantly.
// =========================================================

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  doc, getDoc, collection, onSnapshot,
  writeBatch, getDocs,
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
const cachesReady = { hostels: false, rooms: false, bookings: false };

function getHostels() { return hostelsCache; }
function getRooms() { return roomsCache; }
function getBookings() { return bookingsCache; }

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

async function clientBookRoom(roomId) {
  const client = getCurrentClient();
  if (!client) return { ok: false, message: 'You need to be logged in to book.' };

  const room = getRooms().find((r) => r.id === roomId);
  if (!room) return { ok: false, message: 'That room type no longer exists.' };
  if (Number(room.filled) >= Number(room.beds)) return { ok: false, message: 'This room type just filled up.' };

  const hostelObj = getHostels().find((h) => h.name === room.hostel);
  const { companyCut, ownerPayout } = computeRevenueSplit(room.price, hostelObj);

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
      btn.addEventListener('click', async () => {
        if (!confirm('Confirm you want to book this room? This reserves your bed and generates your batch number.')) return;
        btn.disabled = true;
        btn.textContent = 'Booking…';
        const result = await clientBookRoom(btn.dataset.bookRoom);
        if (!result.ok) {
          alert(result.message);
          btn.disabled = false;
          btn.textContent = 'Book this room';
          return;
        }
        alert(`Booked! Your batch number is ${result.booking.batchNumber}. Save this — you'll need it at check-in.`);
        closeRoomModal();
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