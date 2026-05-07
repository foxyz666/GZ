import { initializeApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {
  apiKey: "AIzaSyDyEHv26JBY6fYluOKncSQTdOUsiEF0XOg",
  authDomain: "gamezone-5a20c.firebaseapp.com",
  databaseURL: "https://gamezone-5a20c-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "gamezone-5a20c",
  storageBucket: "gamezone-5a20c.firebasestorage.app",
  messagingSenderId: "20310163238",
  appId: "1:20310163238:web:6fea1b78aa471d22668be7",
  measurementId: "G-SKB0ESZNH8"
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export default app;
