import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDkZWc8uoy5G1Av5OjL-CiLGqn8WCOZktk",
  authDomain: "wecare-rental-agency.firebaseapp.com",
  projectId: "wecare-rental-agency",
  storageBucket: "wecare-rental-agency.firebasestorage.app",
  messagingSenderId: "718818968304",
  appId: "1:718818968304:web:89c2da40fd3a0936ef3835"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);