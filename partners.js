// =========================================================
// weCare Admin — partners.js
// Lets the admin create and remove hostel-manager (partner)
// accounts from the browser, without touching Firebase.
// =========================================================

import { db, firebaseConfig } from './firebase-config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  collection, doc, setDoc, deleteDoc, onSnapshot, query, where,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

let hostelsCache = [];
let partnersCache = [];

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[m]));
}

function populateHostelDropdown() {
  const select = document.getElementById('partnerHostelSelect');
  if (!select) return;
  const current = select.value;
  select.innerHTML = `<option value="">Select a hostel…</option>` +
    hostelsCache.map((h) => `<option value="${escapeHtml(h.name)}">${escapeHtml(h.name)}</option>`).join('');
  if (current) select.value = current;
}

function renderPartnersList() {
  const tbody = document.getElementById('partnersBody');
  if (!tbody) return;

  if (partnersCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-state">No partner accounts yet — add one above.</td></tr>`;
    return;
  }

  tbody.innerHTML = partnersCache.map((p) => `
    <tr data-id="${escapeHtml(p.id)}">
      <td data-label="Name">${escapeHtml(p.fullName || '—')}</td>
      <td data-label="Email">${escapeHtml(p.email || '—')}</td>
      <td data-label="Hostel">${escapeHtml(p.hostel || '—')}</td>
      <td data-label="Actions" class="table__actions">
        <button class="link-btn link-btn--danger" type="button" data-action="remove-partner">Remove Access</button>
      </td>
    </tr>`).join('');

  tbody.querySelectorAll('[data-action="remove-partner"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('tr');
      const id = row?.dataset.id;
      if (!id) return;
      const ok = confirm(
        "Remove this partner's access? They will no longer be able to log in.\n\n" +
        "Note: this only removes their role here — their Firebase sign-in account itself " +
        "still exists. If you also want to delete that entirely, do it in Firebase Authentication."
      );
      if (!ok) return;
      await deleteDoc(doc(db, 'users', id));
    });
  });
}

function startLiveSync() {
  onSnapshot(collection(db, 'hostels'), (snap) => {
    hostelsCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    populateHostelDropdown();
  });
  onSnapshot(query(collection(db, 'users'), where('role', '==', 'partner')), (snap) => {
    partnersCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderPartnersList();
  });
}

/* ---------------------------------------------------------
   Creating a partner account WITHOUT logging the admin out.
   Firebase's createUserWithEmailAndPassword signs in AS the new
   user on whatever app instance it's called on — so this spins
   up a second, temporary, separate Firebase app just to create
   the account, then signs that instance back out. The admin's
   own login (on the main app) is never touched.
--------------------------------------------------------- */
async function createPartnerAccount(fullName, email, password, hostel) {
  const secondaryApp = initializeApp(firebaseConfig, `partner-creator-${Date.now()}`);
  const secondaryAuth = getAuth(secondaryApp);

  const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
  await setDoc(doc(db, 'users', cred.user.uid), {
    role: 'partner',
    fullName,
    email,
    hostel,
    createdAt: new Date().toISOString().slice(0, 10),
  });
  await signOut(secondaryAuth);
}

function initPartnerForm() {
  const form = document.getElementById('addPartnerForm');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fullName = form.partnerName.value.trim();
    const email = form.partnerEmail.value.trim();
    const password = form.partnerPassword.value;
    const hostel = form.partnerHostelSelect.value;

    if (!fullName || !email || !password || !hostel) {
      alert('Please fill in every field, including which hostel they manage.');
      return;
    }
    if (password.length < 6) {
      alert('Password must be at least 6 characters.');
      return;
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating…';

    try {
      await createPartnerAccount(fullName, email, password, hostel);
      alert(`Partner account created.\n\nGive them this to log in:\nEmail: ${email}\nPassword: ${password}`);
      form.reset();
    } catch (err) {
      alert(err.message.includes('email-already-in-use')
        ? 'An account with this email already exists.'
        : 'Something went wrong creating the account. Please try again.');
    }

    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initPartnerForm();
  startLiveSync();
});
