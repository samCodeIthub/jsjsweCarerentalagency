// =========================================================
// auth-guard.js
// Protects pages by checking login status AND role.
// Include this at the top of every protected page.
// =========================================================

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

/**
 * Call this at the top of admin pages (dashboard.html, hostels.html, etc.)
 * Redirects to login.html if not logged in, or if logged in as a client.
 */
function requireAdmin() {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = 'index.html';
      return;
    }
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (!userDoc.exists() || userDoc.data().role !== 'admin') {
      window.location.href = 'login.html';
    }
  });
}

/**
 * Call this at the top of client-portal.html
 * Redirects to login.html if not logged in, or if logged in as an admin.
 */
function requireClient() {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = 'login.html';
      return;
    }
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (!userDoc.exists() || userDoc.data().role !== 'client') {
      window.location.href = 'login.html';
    }
  });
}

/**
 * Call this at the top of partner-portal.html
 * Redirects to login.html if not logged in, or if logged in as
 * an admin or a client.
 */
function requirePartner() {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = 'login.html';
      return;
    }
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (!userDoc.exists() || userDoc.data().role !== 'partner') {
      window.location.href = 'login.html';
    }
  });
}

/**
 * Call this when a "Log Out" button is clicked, on either side.
 */
function logoutUser() {
  signOut(auth).then(() => {
    window.location.href = 'login.html';
  });
}

/**
 * For pages shared by admins AND hostel managers (the QR scanner).
 * Resolves to { role, hostel } or sends the person to the home page.
 */
function requireStaff() {
  return new Promise((resolve) => {
    onAuthStateChanged(auth, async (user) => {
      if (!user) { window.location.href = 'index.html'; return; }
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      const data = userDoc.exists() ? userDoc.data() : null;
      if (!data || (data.role !== 'admin' && data.role !== 'partner')) {
        window.location.href = 'login.html';
        return;
      }
      resolve({ role: data.role, hostel: data.hostel || '' });
    });
  });
}

export { requireAdmin, requireClient, requirePartner, requireStaff, logoutUser };