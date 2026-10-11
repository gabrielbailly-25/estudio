# App Estudio Dirigido Glera — versión real (MVP)

App web móvil (PWA) en español para la actividad de **Estudio Dirigido** de la Asociación Juvenil Glera: comunicación entre **familias y monitores** con tablón de avisos, asistencia diaria, evaluación diaria, informes mensuales, chat, autorizaciones, calendario y notificaciones push.

**Stack:** HTML/CSS/JS plano, sin paso de compilación (ideal para GitHub + Vercel). Firebase: Authentication (login con Google), Firestore, Cloud Messaging (push) y Storage.

---

## Puesta en marcha paso a paso

### 1. Crear el proyecto en Firebase

1. Entra en [console.firebase.google.com](https://console.firebase.google.com) y pulsa **Agregar proyecto**.
2. Nombre sugerido: `Glera Estudio Dirigido`. Anota el **ID del proyecto** (p. ej. `glera-estudio-dirigido`).
3. Puedes desactivar Google Analytics. Crea el proyecto.

### 2. Activar Authentication con el proveedor Google

1. En el menú lateral: **Compilación → Authentication → Comenzar**.
2. Pestaña **Sign-in method** → proveedor **Google** → **Habilitar**.
3. Indica un correo de asistencia del proyecto y guarda.

### 3. Crear la base de datos Firestore

1. **Compilación → Firestore Database → Crear base de datos**.
2. Elige **Comenzar en modo de producción** (las reglas se despliegan en el paso 7).
3. Ubicación: `europe-west` (p. ej. `europe-west1`; si te aparece Madrid `europe-southwest1`, también vale).

### 4. Activar Storage (OPCIONAL — puedes saltarlo)

> ⚠️ **Firebase pide ahora una cuenta de facturación (plan Blaze) para crear el bucket de Storage** en proyectos nuevos. La buena noticia: **esta versión de la app no usa Storage para nada** (no hay subida de fotos ni adjuntos), así que puedes saltar este paso por completo y no vincular facturación. Si en el futuro queréis adjuntar archivos (p. ej. fotos en informes), entonces sí habría que activarlo; el plan Blaze es de pago por uso, pero con el nivel gratuito (5 GB almacenados, 1 GB/día de descarga) y los $300 de crédito inicial una app tan pequeña no pagaría nada.

### 5. Registrar la app web y copiar la configuración

1. Rueda dentada → **Configuración del proyecto** → **Tus apps** → icono `</>` (Web).
2. Apodo sugerido: `Estudio Dirigido Web`. Registra la app.
3. Copia el objeto `firebaseConfig` y pégalo en `public/js/firebase-config.js`, sustituyendo los valores `TODO`.
4. En la misma pantalla: pestaña **Cloud Messaging** → **Certificados push web** → **Generar par de claves**. Copia la **clave pública VAPID** en `vapidKey` dentro de `public/js/firebase-config.js`.
5. Pega el mismo `firebaseConfig` en `public/firebase-messaging-sw.js` donde se indica (marcado como TODO).

> ⚠️ Sin este paso la app mostrará un aviso de "Falta configurar Firebase" y el login no funcionará.

### 6. Instalar Firebase CLI y hacer login

```bash
npm install -g firebase-tools
firebase login
cd glera-estudio-dirigido-app
firebase use --add   # elige tu proyecto de la lista
```

> También puedes editar `.firebaserc` a mano: sustituye `glera-estudio-dirigido` (marcado como TODO) por el ID real de tu proyecto.

### 7. Desplegar reglas e índices

```bash
firebase deploy --only firestore:rules,firestore:indexes
```

> Si activaste Storage (paso 4 opcional), añade `,storage` al final del comando.

### 8. Crear el primer administrador

1. Abre la app y entra con **Continuar con Google**.
2. En la consola de Firestore verás tu documento en `users/{tu-uid}` con `role: "familia"`.
3. Edítalo y cambia `role` a `"admin"`.
4. A partir de ahí gestiona todo desde la pantalla **Usuarios** de la app (visible solo para el admin, en la barra de navegación): cambia el `rol` de cada usuario con el desplegable (Administrador / Monitor/a / Familia), y da de alta alumnos en el bloque "Alumnos" vinculándolos a sus familias con las casillas.

> ⚠️ **Tras modificar `firestore.rules` hay que volver a desplegarlas** para que el cambio tenga efecto (la pantalla "Usuarios" necesita el permiso de admin para editar roles). O bien:
> ```bash
> firebase deploy --only firestore:rules
> ```
> o bien pega el contenido de `firestore.rules` en la consola: **Firestore Database → Reglas → Publicar**.

### 9. Subir el código a GitHub

```bash
git init
git add .
git commit -m "MVP inicial: app Estudio Dirigido Glera"
git branch -M main
git remote add origin https://github.com/gabrielbailly-25/estudio.git
git push -u origin main
```

### 10. Desplegar el frontend en Vercel

1. En [vercel.com](https://vercel.com) → **Add New → Project** → importa el repositorio `gabrielbailly-25/estudio` (puedes entrar con tu cuenta de GitHub).
2. En la configuración del proyecto: **Framework Preset** → `Other`; **Root Directory** → `public` (pulsa Edit y escribe `public`). No hay comando de compilación.
3. Pulsa **Deploy**. Cada `push` a `main` redespliega automáticamente.

> Alternativa: servir el frontend desde Firebase Hosting con `firebase deploy --only hosting`.

### 11. Cloud Functions (push en segundo plano) — opcional pero recomendado

```bash
cd functions
npm install
cd ..
firebase deploy --only functions
```

> ⚠️ **Cloud Functions requiere el plan Blaze (pago por uso)** de Firebase. Actívalo en la consola (Facturación) antes de desplegar.
>
> **¿Qué pasa sin Functions?**
> - Las notificaciones **en primer plano** (con la app abierta) funcionan igual gracias a `onMessage` en `app.js`.
> - Para push **en segundo plano o con la app cerrada** necesitas las Functions desplegadas **o** enviar mensajes manualmente desde la consola: **Cloud Messaging → Enviar mensaje**.

---

## Estructura del proyecto

```
glera-estudio-dirigido-app/
├── README.md                  # esta guía
├── firebase.json              # configuración: hosting, firestore, storage, functions
├── .firebaserc                # TODO: ID real del proyecto Firebase
├── firestore.rules            # reglas de seguridad por rol
├── firestore.indexes.json     # índices compuestos
├── storage.rules              # reglas de Storage
├── public/                    # frontend (se despliega en Vercel o Firebase Hosting)
│   ├── index.html             # shell de la app con todas las pantallas
│   ├── manifest.json          # PWA (TODO: añadir icon-192.png e icon-512.png)
│   ├── firebase-messaging-sw.js  # service worker para push en 2º plano (TODO: config)
│   ├── css/styles.css
│   └── js/
│       ├── firebase-config.js # TODO: pegar aquí la configuración de Firebase
│       └── app.js             # lógica de la app
└── functions/                 # Cloud Functions (requiere plan Blaze)
    ├── package.json
    └── index.js               # triggers que envían push al crear mensajes, informes, avisos…
```

## Modelo de datos (Firestore)

| Colección | Contenido |
|---|---|
| `users/{uid}` | `role` (admin/monitor/familia), `displayName`, `email` |
| `users/{uid}/pushTokens/{token}` | tokens FCM del dispositivo |
| `users/{uid}/notifications/{id}` | centro de notificaciones (la crea el backend) |
| `students/{id}` | `firstName`, `lastName`, `group`, `familyUids: []` |
| `sessions/{id}` | `date` (YYYY-MM-DD), `startTime`, `endTime`, `title` |
| `attendance/{studentId}_{date}` | `studentId`, `date`, `status` (presente/ausente/justificado) |
| `evaluations/{studentId}_{date}` | `studentId`, `date`, `scores: { itemId: valor }` (1-3), `comment` · (formato antiguo: `puntualidad`, `agenda`, `aprovechamiento`) |
| `evalItems/{id}` | `label`, `order`, `active` — ítems configurables de la evaluación diaria (los gestiona el monitor con ⚙️) |
| `reports/{id}` | `studentId`, `title`, `body`, `type` (diario/mensual), `month` (YYYY-MM) |
| `notices/{id}` | `title`, `body`, `pinned` (tablón de anuncios) |
| `authorizations/{id}` | `title`, `description`, `dueDate` |
| `authorizations/{id}/signatures/{uid}` | `signedAt`, `displayName` |
| `conversations/{id}` | `participantUids: []`, `studentId`, `lastMessageText`, `updatedAt` |
| `messages/{id}` | `conversationId`, `participantUids: []`, `senderUid`, `text`, `createdAt` |

## Notas

- La app **arranca vacía**: no incluye datos de ejemplo. Crea sesiones, alumnos y avisos desde la vista de monitor/administrador.
- El primer usuario que entra queda como `familia`; el administrador se asigna a mano (paso 8).
- Para los iconos PWA, añade `public/icon-192.png` y `public/icon-512.png` (referenciados en `manifest.json`).
- **Tras cambiar `firestore.rules`** (p. ej. al añadir la colección `evalItems`), hay que redesplegar las reglas: `firebase deploy --only firestore:rules` o pegar el contenido en la consola (Firestore Database → Reglas → Publicar). Sin esto, la app dará errores de permisos.
