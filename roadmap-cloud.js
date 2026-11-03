import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  doc, getDocFromServer, getFirestore, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

const app = initializeApp({
  apiKey: "AIzaSyAbeNZ1Cd8Lyh3XJLZT4IABM1XlKQhS-ds",
  authDomain: "dashboard1-ef52e.firebaseapp.com",
  projectId: "dashboard1-ef52e",
  storageBucket: "dashboard1-ef52e.firebasestorage.app",
  messagingSenderId: "497688144498",
  appId: "1:497688144498:web:2c8f5da949d2e656b8f0eb"
});
const auth = getAuth(app);
const database = getFirestore(app);

export function connect(onUser) {
  return onAuthStateChanged(auth, onUser, (error) => onUser(null, error));
}

export function login() {
  return signInWithPopup(auth, new GoogleAuthProvider());
}

export function logout() {
  return signOut(auth);
}

export async function load(uid) {
  const snapshot = await getDocFromServer(doc(database, "users", uid, "plans", "roadmap"));
  if (!snapshot.exists()) return { plan: null, revision: 0 };
  const data = snapshot.data();
  if (data.schemaVersion !== 1 || !Number.isSafeInteger(data.revision) || data.revision < 1) {
    throw new Error("Nieobsługiwana wersja planu w bazie. Dane nie zostały nadpisane.");
  }
  return { plan: data.plan, revision: data.revision };
}

export async function save(uid, plan, revision) {
  const reference = doc(database, "users", uid, "plans", "roadmap");
  await runTransaction(database, async (transaction) => {
    const snapshot = await transaction.get(reference);
    const actualRevision = snapshot.exists() ? snapshot.data().revision : 0;
    if (actualRevision !== revision) {
      throw new Error("Plan zmieniono na innym urządzeniu lub w innej karcie. Skopiuj niezapisane zmiany i wczytaj plan z bazy.");
    }
    transaction.set(reference, {
      schemaVersion: 1, revision: revision + 1, plan, updatedAt: serverTimestamp()
    });
  });
  return revision + 1;
}
