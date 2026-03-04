// firebase-config.js
// Cấu hình Firebase của ứng dụng web
const firebaseConfig = { 
  apiKey: "AIzaSyAlIi5GMCitFd0jjzg9-mCIxVaPZTYmwTI", 
  authDomain: "cocatube-71263.firebaseapp.com", 
  projectId: "cocatube-71263", 
  storageBucket: "cocatube-71263.firebasestorage.app", 
  messagingSenderId: "327359182773", 
  appId: "1:327359182773:web:70cefcc72d805505f9cbfc", 
  measurementId: "G-XJ4K503CL6" 
};

// Khởi tạo Firebase Compat
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

const auth = firebase.auth();
const db = firebase.firestore();

// Enable multi-tab synchronization for Firestore persistence
db.enablePersistence({ synchronizeTabs: true }).catch((err) => {
    if (err.code == 'failed-precondition') {
        console.warn('Persistence failed-precondition: Multiple tabs potentially conflicting.');
    } else if (err.code == 'unimplemented') {
        console.warn('Environment does not support Firestore persistence');
    }
});

// Export to window for global access
window.firebaseAuth = auth;
window.firebaseDb = db;
