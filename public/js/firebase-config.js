// Configuración de Firebase — TODO: rellenar con los datos de TU proyecto.
//
// 1. Ve a https://console.firebase.google.com → tu proyecto → Configuración
//    del proyecto → "Tus apps" → app Web → copia el objeto firebaseConfig.
// 2. En la misma pantalla, pestaña "Cloud Messaging" → "Certificados push web" →
//    "Generar par de claves" → copia la CLAVE PÚBLICA VAPID en `vapidKey`.
// 3. Pega el mismo firebaseConfig en public/firebase-messaging-sw.js.
//
// No inventes valores: sin la configuración real, el login no funcionará
// y la pantalla de acceso mostrará un aviso.

export const firebaseConfig = {
apiKey: "AIzaSyCTSMVoftDPr15yjqOTmG7oqUWVhZ_w5x8",
  authDomain: "estudio-19ab3.firebaseapp.com",
  projectId: "estudio-19ab3",
  storageBucket: "estudio-19ab3.firebasestorage.app",
  messagingSenderId: "208113910101",
  appId: "1:208113910101:web:56f0b1db7c568c6f4eafdc",
  measurementId: "G-766SQX6TPN"
};

// Clave pública VAPID para las notificaciones push web (ver paso 2).
export const vapidKey = "BInfZNr5u8nU9AzUfwi1LxLpRdYG5k0lLVGK3Pw9vNDYogMTVAEf1pQu_SOlb8a5UhEEImNaYoMz0lfMgkXzd9Y";
