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
  GoogleAuthProvider,
  signInWithPopup,
  deleteUser,
  signOut,
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
  } else if (role === 'partner') {
    window.location.href = 'partner-portal.html';
  } else {
    window.location.href = 'client-portal.html';
  }
}

/* ---------------------------------------------------------
   GOOGLE SIGN-IN — for students. Signing in with Google either
   logs in an existing account, or (the first time) creates a
   new CLIENT profile automatically. Since Google handles the
   password, students never get locked out.
--------------------------------------------------------- */
// mode = 'login'  -> only for people who already have an account.
//                    If there's none, tell them to sign up instead.
// mode = 'signup' -> creates the account if new, or just logs in if
//                    they already have one.
async function loginWithGoogle(mode) {
  const provider = new GoogleAuthProvider();
  const cred = await signInWithPopup(auth, provider);
  const userRef = doc(db, 'users', cred.user.uid);
  const userDoc = await getDoc(userRef);

  if (!userDoc.exists() && mode === 'login') {
    // Google just created a bare sign-in for them — undo it, since
    // they never actually signed up here.
    try { await deleteUser(cred.user); } catch (e) { await signOut(auth); }
    const err = new Error('no-account');
    err.code = 'no-account';
    throw err;
  }

  if (!userDoc.exists()) {
    // New student signing up with Google — ask for a phone number
    // so the admin and hostel managers can reach them.
    let phone = '';
    while (!phone) {
      phone = (window.prompt('Welcome! Please enter your phone number (e.g. 024 555 1234):') || '').trim();
    }
    await setDoc(userRef, {
      role: 'client',
      fullName: cred.user.displayName || '',
      email: cred.user.email || '',
      phone,
      createdAt: new Date().toISOString().slice(0, 10),
    });
    window.location.href = 'client-portal.html';
    return;
  }

  const role = userDoc.data().role;
  if (role === 'admin') {
    window.location.href = 'index.html';
  } else if (role === 'partner') {
    window.location.href = 'partner-portal.html';
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

  function wireGoogleButton(buttonId, mode, errorId) {
    const btn = document.getElementById(buttonId);
    if (!btn) return;
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const errorEl = document.getElementById(errorId);
      if (errorEl) errorEl.style.display = 'none';
      try {
        await loginWithGoogle(mode);
      } catch (err) {
        console.error('Google sign-in error:', err);
        if (err.code === 'no-account') {
          showRegister();
          const regError = document.getElementById('registerError');
          regError.textContent = "You don't have an account yet. Sign up below or tap \"Sign up with Google\".";
          regError.style.display = 'block';
        } else if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') {
          // They just closed the popup — nothing to report.
        } else if (errorEl) {
          errorEl.textContent = 'Google sign-in failed (' + (err.code || err.message) + '). Please try again.';
          errorEl.style.display = 'block';
        }
        btn.disabled = false;
      }
    });
  }
  wireGoogleButton('googleLoginBtn', 'login', 'loginError');
  wireGoogleButton('googleSignupBtn', 'signup', 'registerError');

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