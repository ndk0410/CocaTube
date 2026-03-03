// Nhập các hàm cần thiết từ các SDK cần thiết
import { initializeApp } from "firebase/app" ;   
import { getAnalytics } from "firebase/analytics" ;   
// Việc cần làm: Thêm SDK cho các sản phẩm Firebase mà bạn muốn sử dụng
// https://firebase.google.com/docs/web/setup#available-libraries

// Cấu hình Firebase của ứng dụng web của bạn
// Đối với Firebase JS SDK phiên bản 7.20.0 trở lên, measurementId là tùy chọn.
const firebaseConfig = { 
  apiKey : "AIzaSyAlIi5GMCitFd0jjzg9-mCIxVaPZTYmwTI" , 
  authDomain : "cocatube-71263.firebaseapp.com" , 
  projectId : "cocatube-71263" , 
  storageBucket : "cocatube-71263.firebasestorage.app" , 
  messagingSenderId : "327359182773" , 
  appId : "1:327359182773:web:70cefcc72d805505f9cbfc" , 
  measurementId : "G-XJ4K503CL6" 
};

// Khởi tạo Firebase


// Initialize Firebase
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

const auth = firebase.auth();
const db = firebase.firestore();

// Optional: Enable offline persistence for Firestore
db.enablePersistence().catch((err) => {
    if (err.code == 'failed-precondition') {
        console.warn('Multiple tabs open, persistence can only be enabled in one tab at a a time.');
    } else if (err.code == 'unimplemented') {
        console.warn('The current browser does not support all of the features required to enable persistence');
    }
});
const app = initializeApp ( firebaseConfig );
const analytics = getAnalytics ( app );
// Export to window for global access
window.firebaseAuth = auth;
window.firebaseDb = db;
