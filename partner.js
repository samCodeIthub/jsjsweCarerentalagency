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
  doc, getDoc, collection, onSnapshot,
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

function statusLabel(b) {
  if (b.status === 'cancelled') return { label: 'Cancelled', pillClass: 'pill--draft' };
  if (b.status === 'pending') return { label: 'Awaiting Payment', pillClass: 'pill--warning' };
  if (b.checkedIn) return { label: 'Checked In', pillClass: 'pill--available' };
  return { label: 'Payment Confirmed', pillClass: 'pill--warning' };
}

function renderPartnerBookings() {
  const tbody = document.getElementById('partnerBookingsBody');
  if (!tbody) return;

  const bookings = myBookings();

  const total = bookings.length;
  const pending = bookings.filter((b) => b.status === 'pending').length;
  const checkedIn = bookings.filter((b) => b.checkedIn && b.status !== 'cancelled').length;
  // "Earned" only counts bookings the admin has actually confirmed —
  // a pending one hasn't been verified as paid yet, so it's excluded.
  const earnings = bookings
    .filter((b) => b.status !== 'pending' && b.status !== 'cancelled')
    .reduce((sum, b) => sum + (Number(b.ownerPayout) || 0), 0);

  const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setText('statPartnerTotal', total);
  setText('statPartnerPending', pending);
  setText('statPartnerCheckedIn', checkedIn);
  setText('statPartnerEarnings', `GHS ${earnings.toLocaleString('en-US')}`);

  const nameEl = document.getElementById('partnerHostelName');
  if (nameEl && currentPartner) nameEl.textContent = currentPartner.hostel || 'Your Hostel';

  if (bookings.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No bookings yet for your hostel.</td></tr>`;
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
        </tr>`;
    }).join('');
}

/* ---------------------------------------------------------
   Print — only students who have actually paid (status is
   not pending and not cancelled), with their batch number so
   the hostel can match the printed list to the right person.
--------------------------------------------------------- */
export function printPaidRecords() {
  const hostel = currentPartner?.hostel || '';
  const paid = myBookings().filter((b) => b.status !== 'pending' && b.status !== 'cancelled');

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
   Live sync + boot
--------------------------------------------------------- */
function startLiveSync() {
  onSnapshot(collection(db, BOOKINGS_COLLECTION), (snap) => {
    bookingsCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderPartnerBookings();
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

    startLiveSync();
  });
}
