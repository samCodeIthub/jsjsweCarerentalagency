// =========================================================
// login.js
// Shared login/registration for both admins and students.
// Uses Firebase Auth for login, and a "users" collection in
// Firestore to know whether someone is an admin or a client.
// =========================================================

import { auth, db } from './firebase-config.js';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  doc, getDoc, setDoc,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

/* ---------------------------------------------------------
   LOGIN — works for both admins and clients.
   After success, checks Firestore to see which one this is,
   and sends them to the right page.
--------------------------------------------------------- */
async function loginUser(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  const userDoc = await getDoc(doc(db, 'users', cred.user.uid));

  if (!userDoc.exists()) {
    throw new Error('No profile found for this account. Contact the admin.');
  }

  const role = userDoc.data().role;
  if (role === 'admin') {
    window.location.href = 'index.html';
  } else {
    window.location.href = 'client-portal.html';
  }
}

/* ---------------------------------------------------------
   REGISTER — always creates a CLIENT account.
   Admin accounts are created manually in Firebase, never here.
--------------------------------------------------------- */
async function registerClient(fullName, email, phone, password) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);

  await setDoc(doc(db, 'users', cred.user.uid), {
    role: 'client',
    fullName,
    email,
    phone,
    createdAt: new Date().toISOString().slice(0, 10),
  });

  window.location.href = 'client-portal.html';
}

/* ---------------------------------------------------------
   Wire up the login page's forms
--------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
  const tabLogin = document.getElementById('tabLogin');
  const tabRegister = document.getElementById('tabRegister');
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');

  function showLogin() {
    tabLogin.classList.add('is-active'); tabRegister.classList.remove('is-active');
    loginForm.hidden = false; registerForm.hidden = true;
  }
  function showRegister() {
    tabRegister.classList.add('is-active'); tabLogin.classList.remove('is-active');
    registerForm.hidden = false; loginForm.hidden = true;
  }
  tabLogin.addEventListener('click', showLogin);
  tabRegister.addEventListener('click', showRegister);

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('loginError');
    errorEl.style.display = 'none';
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;

    try {
      await loginUser(email, password);
    } catch (err) {
      errorEl.textContent = 'Login failed: incorrect email or password.';
      errorEl.style.display = 'block';
    }
  });

  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('registerError');
    errorEl.style.display = 'none';

    const fullName = document.getElementById('regName').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const phone = document.getElementById('regPhone').value.trim();
    const password = document.getElementById('regPassword').value;
    const confirm = document.getElementById('regConfirm').value;

    if (password !== confirm) {
      errorEl.textContent = 'Passwords do not match.';
      errorEl.style.display = 'block';
      return;
    }

    try {
      await registerClient(fullName, email, phone, password);
    } catch (err) {
      errorEl.textContent = err.message.includes('email-already-in-use')
        ? 'An account with this email already exists.'
        : 'Something went wrong. Please try again.';
      errorEl.style.display = 'block';
    }
  });
});