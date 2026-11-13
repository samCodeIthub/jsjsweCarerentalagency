// =========================================================
// weCare Partner Portal — partner.js
// Read-only view for a hostel manager/owner: shows bookings
// for THEIR hostel only, and how much they're earning from
// each one. Mirrors the same Firestore data as script.js and
// client.js, just filtered down to one hostel.
// =========================================================

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, onSnapshot,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const BOOKINGS_COLLECTION = 'bookings';

let bookingsCache = [];
let currentPartner = null; // { id, fullName, hostel }

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[m]));
}

async function loadCurrentPartner(user) {
  const userDoc = await getDoc(doc(db, 'users', user.uid));
  if (!userDoc.exists()) return null;
  const data = userDoc.data();
  return {
    id: user.uid,
    fullName: data.fullName || '',
    hostel: data.hostel || '',
  };
}

// Only this partner's own hostel — matched by exact name, the
// same way a hostel's name is used everywhere else in the app.
function myBookings() {
  if (!currentPartner) return [];
  return bookingsCache.filter((b) => b.hostel === currentPartner.hostel);
}

// Managers only see people who have PAID for a room (not unpaid
// holds, not cancelled, not free viewings).
function paidBookings() {
  return myBookings().filter((b) => b.status === 'confirmed' && b.type !== 'viewing');
}

function statusLabel(b) {
  if (b.status === 'cancelled') return { label: 'Cancelled', pillClass: 'pill--draft' };
  if (b.status === 'pending') return { label: 'Awaiting Payment', pillClass: 'pill--warning' };
  if (b.checkedIn) return { label: 'Checked In', pillClass: 'pill--available' };
  return { label: 'Payment Confirmed', pillClass: 'pill--warning' };
}

function renderPartnerBookings() {
  const tbody = document.getElementById('partnerBookingsBody');
  if (!tbody) return;

  const bookings = paidBookings();

  const total = bookings.length;
  const pending = bookings.filter((b) => !b.checkedIn).length;
  const checkedIn = bookings.filter((b) => b.checkedIn).length;
  // "Earned" only counts bookings the admin has actually confirmed —
  // a pending one hasn't been verified as paid yet, so it's excluded.
  const earnings = bookings
    .reduce((sum, b) => sum + (Number(b.ownerPayout) || 0), 0);

  const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setText('statPartnerTotal', total);
  setText('statPartnerPending', pending);
  setText('statPartnerCheckedIn', checkedIn);
  setText('statPartnerEarnings', `GHS ${earnings.toLocaleString('en-US')}`);

  const nameEl = document.getElementById('partnerHostelName');
  if (nameEl && currentPartner) nameEl.textContent = currentPartner.hostel || 'Your Hostel';

  if (bookings.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-state">No paid bookings yet for your hostel.</td></tr>`;
    return;
  }

  tbody.innerHTML = [...bookings]
    .sort((a, b) => (b.bookedAt || '').localeCompare(a.bookedAt || ''))
    .map((b) => {
      const { label, pillClass } = statusLabel(b);
      return `
        <tr>
          <td data-label="Batch No."><span class="batch-code">${escapeHtml(b.batchNumber)}</span></td>
          <td data-label="Student">${escapeHtml(b.studentName)}</td>
          <td data-label="Room Type">${escapeHtml(b.roomType)}</td>
          <td data-label="Price">GHS ${Number(b.price).toLocaleString('en-US')}</td>
          <td data-label="Your Payout">GHS ${Number(b.ownerPayout || 0).toLocaleString('en-US')}</td>
          <td data-label="Date">${escapeHtml(b.bookedAt)}</td>
          <td data-label="Status"><span class="pill ${pillClass}">${label}</span></td>
          <td data-label="Check-in">${b.checkedIn
            ? '<span class="pill pill--available">✓ Checked in</span>'
            : `<button class="btn btn--primary" type="button" data-checkin="${escapeHtml(b.id)}">Check in</button>`}</td>
        </tr>`;
    }).join('');
}

// Check-in button: marks the booking as checked in (only for this
// manager's own hostel — the database rules enforce that too).
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-checkin]');
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    await updateDoc(doc(db, BOOKINGS_COLLECTION, btn.dataset.checkin), { checkedIn: true });
  } catch (err) {
    console.error('Check-in failed', err);
    alert('Could not check in (' + (err.code || err.message) + ').');
    btn.disabled = false;
    btn.textContent = 'Check in';
  }
});

/* ---------------------------------------------------------
   Print — only students who have actually paid (status is
   not pending and not cancelled), with their batch number so
   the hostel can match the printed list to the right person.
--------------------------------------------------------- */
export function printPaidRecords() {
  const hostel = currentPartner?.hostel || '';
  const paid = paidBookings();

  const rows = paid.map((b) => `
    <tr>
      <td>${escapeHtml(b.studentName)}</td>
      <td>${escapeHtml(b.batchNumber)}</td>
      <td>${escapeHtml(b.roomType)}</td>
      <td>GHS ${Number(b.price).toLocaleString('en-US')}</td>
      <td>${escapeHtml(b.bookedAt)}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Paid Students — ${escapeHtml(hostel)}</title>
<style>
  body { font-family: Arial, sans-serif; padding: 24px; color: #111; }
  h1 { font-size: 18px; margin-bottom: 4px; }
  p.meta { color: #555; margin-bottom: 20px; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #ddd; font-size: 13px; }
  th { background: #f4f4f4; }
</style>
</head>
<body>
  <h1>Paid Students — ${escapeHtml(hostel)}</h1>
  <p class="meta">Printed ${new Date().toLocaleDateString()} · ${paid.length} student${paid.length === 1 ? '' : 's'}</p>
  <table>
    <thead><tr><th>Student Name</th><th>Batch Number</th><th>Room Type</th><th>Amount</th><th>Date Paid</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="5">No paid bookings yet.</td></tr>'}</tbody>
  </table>
</body>
</html>`;

  const win = window.open('', '_blank');
  if (!win) {
    alert('Please allow pop-ups for this site so the list can open for printing.');
    return;
  }
  win.document.write(html);
  win.document.close();
  win.focus();
  win.print();
}


/* ---------------------------------------------------------
   My rooms — the manager puts rooms up for students to see.
   weCare adds a fixed GHS 200 on top of their price. The
   manager's own price is kept as ownerPrice, so their payout
   is always exactly what they typed.
--------------------------------------------------------- */
const ROOMS_COLLECTION = 'rooms';
const MANAGER_FEE = 200;
const CLOUDINARY_CLOUD_NAME = 'wlrgu3h3';
const CLOUDINARY_UPLOAD_PRESET = 'wecare_hostels';
let roomsCache = [];

function thumb(url, w, h) {
  return String(url).replace('/upload/', `/upload/c_fill,w_${w},h_${h},q_auto,f_auto/`);
}

async function uploadPhoto(file, publicId) {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
  fd.append('public_id', publicId);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, { method: 'POST', body: fd });
  if (!res.ok) throw new Error('Photo upload failed');
  return (await res.json()).secure_url;
}

function myRooms() {
  if (!currentPartner) return [];
  return roomsCache.filter((r) => r.hostel === currentPartner.hostel);
}

function renderMyRooms() {
  const grid = document.getElementById('mgrRoomGrid');
  if (!grid) return;
  const rooms = myRooms();
  if (!rooms.length) {
    grid.innerHTML = '<p class="empty-state">No rooms yet. Put your first room up above.</p>';
    return;
  }
  grid.innerHTML = rooms.map((r) => {
    const title = r.unitName || (r.capacity === '1' ? '1-in-a-Room · Private' : `${r.capacity}-in-a-Room · Shared`);
    const shown = Number(r.price) || 0;
    const mine = r.ownerPrice != null ? Number(r.ownerPrice) : shown;
    const photos = (r.photoURLs || []).slice(0, 4).map((u) => `<img src="${escapeHtml(thumb(u, 150, 100))}" alt="" loading="lazy">`).join('');
    const canRemove = Number(r.filled || 0) === 0 && r.addedBy === 'partner';
    return `
      <article class="room-card">
        ${photos ? `<div class="room-card__photos">${photos}</div>` : ''}
        <h3>${escapeHtml(title)}</h3>
        <p class="room-card__hostel">${Number(r.filled || 0)} / ${Number(r.beds || 0)} booked</p>
        <p class="room-card__price">You get GHS ${mine.toLocaleString('en-US')} <span>· students pay GHS ${shown.toLocaleString('en-US')} / ${escapeHtml(r.pricePeriod || 'semester')}</span></p>
        ${canRemove ? `<button class="link-btn link-btn--danger" type="button" data-remove-room="${escapeHtml(r.id)}">Remove</button>`
          : '<p class="room-card__hostel">Has bookings or was added by weCare, ask admin to remove.</p>'}
      </article>`;
  }).join('');
}

function initRoomForm() {
  const form = document.getElementById('mgrRoomForm');
  if (!form) return;
  const priceEl = document.getElementById('mrPrice');
  const preview = document.getElementById('mrPreview');
  priceEl.addEventListener('input', () => {
    const v = Number(priceEl.value);
    preview.textContent = v > 0
      ? `Students will see: GHS ${(v + MANAGER_FEE).toLocaleString('en-US')} (your GHS ${v.toLocaleString('en-US')} + GHS ${MANAGER_FEE} weCare fee). You get GHS ${v.toLocaleString('en-US')}.`
      : 'Students will see: GHS 200 more than your price.';
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentPartner || !currentPartner.hostel) { alert('Your account has no hostel yet. Ask the admin.'); return; }
    const ownerPrice = Number(priceEl.value);
    const beds = Number(document.getElementById('mrBeds').value);
    if (!(ownerPrice > 0) || !(beds > 0)) { alert('Please fill in your price and how many rooms.'); return; }

    const btn = document.getElementById('mrSubmit');
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Saving…';
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const files = document.getElementById('mrPhotos').files;
    let photoURLs = [];
    try {
      if (files.length) {
        btn.textContent = 'Uploading photos…';
        photoURLs = await Promise.all([...files].map((f, i) => uploadPhoto(f, `room-${id}-${Date.now()}-${i}`)));
      }
    } catch (err) {
      if (!confirm('Photos could not upload. Put the room up without photos?')) {
        btn.disabled = false; btn.textContent = original; return;
      }
    }
    try {
      await setDoc(doc(db, ROOMS_COLLECTION, id), {
        id,
        hostel: currentPartner.hostel,
        capacity: document.getElementById('mrCapacity').value,
        unitName: document.getElementById('mrUnitName').value.trim(),
        pricePeriod: document.getElementById('mrPeriod').value,
        ownerPrice,
        price: ownerPrice + MANAGER_FEE,
        beds,
        filled: 0,
        photoURLs,
        addedBy: 'partner',
      });
      form.reset();
      preview.textContent = 'Students will see: GHS 200 more than your price.';
    } catch (err) {
      console.error(err);
      alert('Could not save the room (' + (err.code || err.message) + ').');
    }
    btn.disabled = false;
    btn.textContent = original;
  });

  document.getElementById('mgrRoomGrid').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-remove-room]');
    if (!b) return;
    if (!confirm('Remove this room? Students will no longer see it.')) return;
    try { await deleteDoc(doc(db, ROOMS_COLLECTION, b.dataset.removeRoom)); }
    catch (err) { alert('Could not remove (' + (err.code || err.message) + ').'); }
  });
}

/* ---------------------------------------------------------
   Live sync + boot
--------------------------------------------------------- */
function startLiveSync() {
  onSnapshot(collection(db, BOOKINGS_COLLECTION), (snap) => {
    bookingsCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderPartnerBookings();
  });
  onSnapshot(collection(db, ROOMS_COLLECTION), (snap) => {
    roomsCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderMyRooms();
  });
}

export function initPartnerPortal() {
  onAuthStateChanged(auth, async (user) => {
    if (!user) return; // auth-guard.js handles the redirect
    currentPartner = await loadCurrentPartner(user);

    const welcome = document.getElementById('welcomeName');
    if (currentPartner && welcome) {
      welcome.textContent = `Hi, ${currentPartner.fullName.split(' ')[0] || 'there'}`;
    }

    initRoomForm();
    startLiveSync();
  });
}
