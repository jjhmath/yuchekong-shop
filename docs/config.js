// 유체콩샵 전용 파이어베이스 설정 (학원앱 jjh-math 와 다른 새 프로젝트 값을 넣을 것)
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyAkhx7gDSeZFgjWUf48iRoY6sQ-KMa26I8",
  authDomain: "yuchekong-shop.firebaseapp.com",
  projectId: "yuchekong-shop",
  storageBucket: "yuchekong-shop.firebasestorage.app",
  messagingSenderId: "200450655888",
  appId: "1:200450655888:web:2c2bcdd8965d40d140ba15"
};

// 샵 정보 (오픈 후 실제 값으로 변경)
window.SHOP = {
  name: "유체콩샵",
  phone: "",                 // 샵 전화번호
  lat: 35.0911, lng: 129.0680 // 샵 위치(임시값) — 실제 주소 좌표로 바꿔 주세요
};
