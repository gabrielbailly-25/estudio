/* Service worker para notificaciones push en SEGUNDO PLANO (Firebase Cloud Messaging).
   El navegador lo registra automáticamente al pedir el token push.
   TODO: pega aquí el MISMO objeto firebaseConfig de public/js/firebase-config.js */


importScripts('/js/vendor/firebase-app-compat.js');
importScripts('/js/vendor/firebase-messaging-compat.js');




firebase.initializeApp({
apiKey: "AIzaSyCTSMVoftDPr15yjqOTmG7oqUWVhZ_w5x8",
  authDomain: "estudio-19ab3.firebaseapp.com",
  projectId: "estudio-19ab3",
  storageBucket: "estudio-19ab3.firebasestorage.app",
  messagingSenderId: "208113910101",
  appId: "1:208113910101:web:56f0b1db7c568c6f4eafdc",
  measurementId: "G-766SQX6TPN"
});


const messaging = firebase.messaging();


// Muestra la notificación cuando llega un push con la app en segundo plano o cerrada.
messaging.onBackgroundMessage((payload) => {
  const title = (payload.notification && payload.notification.title) || 'Estudio Dirigido Glera';
  const options = {
    body: (payload.notification && payload.notification.body) || '',
    icon: '/icon-192.png'
  };
  self.registration.showNotification(title, options);
});
