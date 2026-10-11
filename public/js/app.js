// ============================================================
// App Estudio Dirigido Glera — MVP
// Lógica principal: Firebase Auth (Google), Firestore y Cloud Messaging.
// Todo el texto de la interfaz está en español.
// ============================================================

import { firebaseConfig, vapidKey } from './firebase-config.js';
import { initializeApp } from 'firebase/app';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from 'firebase/auth';
import {
  getFirestore, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
  collection, query, where, orderBy, limit, getDocs,
  onSnapshot, serverTimestamp
} from 'firebase/firestore';
import { getMessaging, getToken, deleteToken, onMessage, isSupported } from 'firebase/messaging';

/* ---------------- Estado global ---------------- */
const state = {
  user: null,       // usuario de Firebase Auth
  profile: null,    // documento users/{uid}
  role: null,       // admin | monitor | familia
  children: [],     // alumnos vinculados (rol familia)
  students: [],     // todos los alumnos (rol monitor/admin)
  selectedChildId: null,
  currentConvId: null,
  attMarks: {},     // marcas temporales al pasar lista
  evalMarks: {},    // marcas temporales al evaluar (clave: id del ítem)
  evalItems: [],    // ítems de evaluación configurables (colección evalItems)
  reportFilter: 'all', // filtro de informes en vista familia: all | diario | mensual
  pushToken: null,   // token FCM de este dispositivo (si el push está activo)
  editingNoticeId: null, // aviso en edición (null = crear nuevo)
  unsubChat: null,
  unsubNotif: null,
};

const isMonitor = () => state.role === 'monitor' || state.role === 'admin';
const isAdmin = () => state.role === 'admin';
const ROLE_LABEL = { admin: 'Administrador', monitor: 'Monitor/a', familia: 'Familia' };
const initialsOf = (name) =>
  String(name || '?').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();

// Iconos SVG estilo prototipo (trazo fino, 24x24).
const NAV_ICONS = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10M9 20v-6h6v6"/></svg>',
  attendance: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a6 6 0 0 1 12 0v2M16 11l2 2 4-4"/></svg>',
  evaluate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16v16H4zM8 8h8M8 12h5M8 16h3"/><path d="m16 15 1.5 1.5L21 13"/></svg>',
  progress: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/><path d="M8 9h8M8 13h5"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  reports: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 3h9l3 3v15H6z"/><path d="M15 3v4h4M9 11h6M9 15h6M9 19h4"/></svg>',
  auths: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 3h12v18H6zM9 7h6M9 11h6"/><path d="m9 16 2 2 4-4"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>',
  notifications: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>',
  notices: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>',
  child: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M5 21a7 7 0 0 1 14 0M18 4h3v3"/></svg>',
  profile: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
};

// Título de la barra superior por pantalla.
const TITLES = {
  home: 'Inicio', attendance: 'Asistencia', evaluate: 'Evaluación diaria',
  progress: 'Progreso', reports: 'Informes', reportDetail: 'Informe',
  reportCompose: 'Nuevo informe', chatList: 'Chat', chatView: 'Chat',
  auths: 'Autorizaciones', authDetail: 'Autorización', authCompose: 'Nueva autorización',
  noticeCompose: 'Nuevo aviso', calendar: 'Calendario', notifications: 'Notificaciones',
  profile: 'Mi perfil', more: 'Más', users: 'Usuarios',
  evalItems: 'Ítems de evaluación', child: 'Mi hijo', notices: 'Avisos',
};

/* ---------------- Utilidades ---------------- */
const $ = (id) => document.getElementById(id);
// Escapa texto introducido por usuarios para evitar inyección de HTML.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));
const todayStr = () => {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};
const MESES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MESES_LARGO = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const fmtDate = (iso) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${parseInt(d, 10)} ${MESES_CORTO[parseInt(m, 10) - 1]} ${y}`;
};
const fmtMonth = (ym) => {
  if (!ym) return '';
  const [y, m] = ym.split('-');
  return `${MESES_LARGO[parseInt(m, 10) - 1]} de ${y}`;
};
const tsToDate = (ts) => {
  try {
    return ts.toDate().toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
};

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

// Caja de estado vacío amable cuando no hay datos.
const emptyBox = (icon, text) =>
  `<div class="empty"><span class="big">${icon}</span>${esc(text)}</div>`;

// Desplegable para elegir hijo/a (familias con varios hijos).
const childSelectHTML = (id) => `
  <label for="${id}">Hijo/a</label>
  <select id="${id}">
    ${state.children.map(c => `<option value="${c.id}" ${c.id === state.selectedChildId ? 'selected' : ''}>${esc(c.firstName)} ${esc(c.lastName || '')}</option>`).join('')}
  </select>`;

/* ---------------- Ayudas de dashboard, informes y evaluación ---------------- */
// Saludo según la hora del día.
const saludoHora = () => {
  const h = new Date().getHours();
  return h < 13 ? 'Buenos días' : h < 21 ? 'Buenas tardes' : 'Buenas noches';
};
// "Domingo, 11 de octubre".
const fechaLargaHoy = () => {
  const s = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};
// Tipo de informe: 'diario' | 'mensual' (los antiguos con mes cuentan como mensuales).
const reportType = (r) => r.type || (r.month ? 'mensual' : 'diario');
// Puntuaciones de una evaluación como [{label, value}]; compatible con el formato
// antiguo (campos puntualidad/agenda/aprovechamiento) y el nuevo (mapa scores).
function evalScores(e) {
  if (e.scores && typeof e.scores === 'object' && Object.keys(e.scores).length) {
    const labels = {};
    (state.evalItems || []).forEach(it => { labels[it.id] = it.label; });
    return Object.entries(e.scores).map(([id, v]) => ({ label: labels[id] || 'Ítem', value: v }));
  }
  const out = [];
  if (e.puntualidad != null) out.push({ label: 'Puntualidad', value: e.puntualidad });
  if (e.agenda != null) out.push({ label: 'Uso de la agenda', value: e.agenda });
  if (e.aprovechamiento != null) out.push({ label: 'Aprovechamiento del tiempo', value: e.aprovechamiento });
  return out;
}
// Media de puntuaciones con coma decimal ("2,7"); null si no hay.
const avgScore = (scores) => {
  if (!scores.length) return null;
  return (scores.reduce((a, s) => a + s.value, 0) / scores.length).toFixed(1).replace('.', ',');
};
// Ítems de evaluación configurables (colección evalItems). Si está vacía y el
// usuario es monitor, se crean los 3 ítems clásicos. Nunca rompe el arranque:
// si faltan las reglas, devuelve [] y la evaluación avisa.
async function loadEvalItems() {
  try {
    const snap = await getDocs(query(collection(db, 'evalItems'), orderBy('order')));
    let items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!items.length && isMonitor()) {
      const defaults = ['Puntualidad', 'Uso de la agenda', 'Aprovechamiento del tiempo'];
      for (let i = 0; i < defaults.length; i++) {
        const ref = await addDoc(collection(db, 'evalItems'), { label: defaults[i], order: i + 1, active: true });
        items.push({ id: ref.id, label: defaults[i], order: i + 1, active: true });
      }
      toast('Ítems de evaluación creados.');
    }
    state.evalItems = items;
    return items;
  } catch (err) {
    console.error('evalItems no disponible (¿reglas sin desplegar?):', err);
    state.evalItems = [];
    return [];
  }
}

/* ---------------- Acciones (delegación de clics) ---------------- */
const ACTIONS = {};
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const fn = ACTIONS[el.dataset.action];
  if (fn) fn(el.dataset, el, e);
});
ACTIONS.go = (d) => show(d.screen);

/* ---------------- Router de pantallas ---------------- */
// El login es un overlay aparte (loginOverlay); aquí solo pantallas de la app.
const SCREENS = ['home', 'attendance', 'evaluate', 'progress', 'reports',
  'reportDetail', 'reportCompose', 'chatList', 'chatView', 'auths', 'authDetail',
  'authCompose', 'noticeCompose', 'calendar', 'notifications', 'profile', 'more', 'users',
  'evalItems', 'child', 'notices'];
const RENDER = {};

function show(id) {
  // Al salir del chat se cierra su escucha en tiempo real.
  if (id !== 'chatView' && state.unsubChat) { state.unsubChat(); state.unsubChat = null; }
  SCREENS.forEach(s => $('screen-' + s).classList.toggle('active', s === id));
  document.querySelectorAll('.nav-btn,.bottom-btn').forEach(b => b.classList.toggle('active', b.dataset.screen === id));
  $('pageTitle').textContent = TITLES[id] || '';
  window.scrollTo(0, 0);
  if (RENDER[id]) RENDER[id]();
}

// Muestra/oculta el overlay de acceso.
function setLoggedOut(out) {
  document.body.classList.toggle('logged-out', out);
  $('loginOverlay').classList.toggle('hidden', !out);
}

/* ---------------- Navegación (según rol) ---------------- */
function renderNav() {
  // Elementos según rol. La familia usa el menú del prototipo.
  let items, bottomItems;
  if (isMonitor()) {
    items = [
      { id: 'home', label: 'Inicio', icon: 'home' },
      { id: 'attendance', label: 'Asistencia', icon: 'attendance' },
      { id: 'evaluate', label: 'Evaluar', icon: 'evaluate' },
      ...(isAdmin() ? [{ id: 'users', label: 'Usuarios', icon: 'users' }] : []),
      { id: 'chatList', label: 'Chat', icon: 'chat' },
      { id: 'more', label: 'Más', icon: 'more' },
    ];
    bottomItems = items;
  } else {
    items = [
      { id: 'home', label: 'Inicio', icon: 'home' },
      { id: 'child', label: 'Mi hijo', icon: 'child' },
      { id: 'reports', label: 'Informes', icon: 'reports' },
      { id: 'notices', label: 'Avisos', icon: 'notices' },
      { id: 'attendance', label: 'Asistencia', icon: 'attendance' },
      { id: 'chatList', label: 'Chat', icon: 'chat' },
      { id: 'more', label: 'Más', icon: 'more' },
    ];
    bottomItems = [
      { id: 'home', label: 'Inicio', icon: 'home' },
      { id: 'child', label: 'Mi hijo', icon: 'child' },
      { id: 'notices', label: 'Avisos', icon: 'notices' },
      { id: 'chatList', label: 'Chat', icon: 'chat' },
      { id: 'more', label: 'Más', icon: 'more' },
    ];
  }
  // Barra inferior (móvil).
  const bottom = $('bottomnav');
  bottom.innerHTML = bottomItems.map(i =>
    `<button class="bottom-btn" data-action="go" data-screen="${i.id}">
       <span class="ico">${NAV_ICONS[i.icon]}</span><span>${i.label}</span>
     </button>`).join('');
  bottom.style.gridTemplateColumns = `repeat(${bottomItems.length},1fr)`;
  // Barra lateral (escritorio).
  $('desktopNav').innerHTML = items.map(i =>
    `<button class="nav-btn" data-action="go" data-screen="${i.id}">
       <span class="ico">${NAV_ICONS[i.icon]}</span>${i.label}
     </button>`).join('');
  $('railRole').textContent = 'Vista ' + (ROLE_LABEL[state.role] || state.role).toLowerCase();
}

/* ---------------- Firebase: init y auth ---------------- */
let app = null, auth = null, db = null;
const configOK = firebaseConfig.apiKey && firebaseConfig.apiKey !== 'TODO';

function initFirebase() {
  if (!configOK) {
    $('config-warning').classList.remove('hidden');
    return false;
  }
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  return true;
}

$('btn-google').addEventListener('click', async () => {
  if (!auth) { toast('Configura Firebase primero (ver README.md).'); return; }
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (err) {
    console.error(err);
    toast('No se pudo iniciar sesión. Inténtalo de nuevo.');
  }
});

function watchAuth() {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      state.user = null;
      setLoggedOut(true);
      return;
    }
    try {
      state.user = user;
      const uref = doc(db, 'users', user.uid);
      let snap = await getDoc(uref);
      if (!snap.exists()) {
        // Primer acceso: la ficha se crea como "familia".
        // Un administrador cambia el rol desde la pantalla "Usuarios".
        await setDoc(uref, {
          role: 'familia',
          displayName: user.displayName || '',
          email: user.email || '',
          createdAt: serverTimestamp(),
        });
        snap = await getDoc(uref);
      }
      state.profile = snap.data();
      state.role = state.profile.role || 'familia';
      $('btn-profile').textContent = initialsOf(state.profile.displayName);
      setLoggedOut(false);
      await loadRoster();
      await loadEvalItems();
      renderNav();
      show('home');
      subscribeNotifications();
      initPush();
    } catch (err) {
      console.error(err);
      toast('Error al cargar tus datos.');
    }
  });
}

// Carga los alumnos según el rol.
async function loadRoster() {
  if (state.role === 'familia') {
    const q = query(collection(db, 'students'),
      where('familyUids', 'array-contains', state.user.uid), orderBy('firstName'));
    const snap = await getDocs(q);
    state.children = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!state.selectedChildId && state.children.length) {
      state.selectedChildId = state.children[0].id;
    }
  } else {
    const q = query(collection(db, 'students'), orderBy('firstName'));
    const snap = await getDocs(q);
    state.students = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }
}

/* ---------------- Inicio: dashboard ---------------- */

/* ---------------- Tablón de anuncios ---------------- */
// Tarjeta de aviso; los monitores ven Editar y Eliminar.
const noticeCard = (n) => `
  <div class="card">
    ${n.pinned ? '<span class="pinned-tag">📌 Fijado</span>' : ''}
    <h3>${esc(n.title)}</h3>
    <p>${esc(n.body)}</p>
    <div class="meta">${tsToDate(n.createdAt)}</div>
    ${isMonitor() ? `<div class="row" style="justify-content:flex-start;margin-top:10px">
      <button class="text-btn" data-action="edit-notice" data-id="${n.id}">✏️ Editar</button>
      <button class="text-btn" data-action="delete-notice" data-id="${n.id}" style="color:var(--danger)">🗑️ Eliminar</button>
    </div>` : ''}
  </div>`;

// Pantalla "Avisos": el tablón completo.
async function renderNotices() {
  const c = $('notices-content');
  const snap = await getDocs(query(collection(db, 'notices'), orderBy('createdAt', 'desc'), limit(30)));
  const notices = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  notices.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  c.innerHTML = `
    <div class="screen-head"><h2>Tablón de anuncios</h2>
      ${isMonitor() ? `<button class="btn small" data-action="new-notice">+ Publicar</button>` : ''}
    </div>
    <div class="grid"><div class="col-12">
      ${notices.length ? notices.map(noticeCard).join('') : emptyBox('📋', 'Aún no hay avisos en el tablón.')}
    </div></div>`;
}

async function renderHome() {
  const c = $('home-content');
  const fam = !isMonitor();
  const nombre = (state.profile.displayName || '').split(' ')[0] || (fam ? 'familia' : 'monitor');
  const child = fam ? (state.children.find(x => x.id === state.selectedChildId) || state.children[0]) : null;
  const subtitulo = fam
    ? (child ? `Este es el resumen de ${esc(child.firstName)} para hoy.` : 'Bienvenido/a a Estudio Dirigido.')
    : `${state.students.length} alumno(s) en la actividad.`;

  // Último aviso del tablón (fijados primero, como en la lista).
  const nsnap = await getDocs(query(collection(db, 'notices'), orderBy('createdAt', 'desc'), limit(30)));
  const notices = nsnap.docs.map(d => ({ id: d.id, ...d.data() }));
  notices.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  const latest = notices[0];

  // Próxima sesión (primer doc con date >= hoy).
  let nextSession = null;
  try {
    const ssnap = await getDocs(query(collection(db, 'sessions'),
      where('date', '>=', todayStr()), orderBy('date', 'asc'), limit(1)));
    if (!ssnap.empty) nextSession = ssnap.docs[0].data();
  } catch (err) { console.error(err); }

  // Métricas según el rol.
  let metrics = '';
  let lastEval = null; // última evaluación del hijo (se reutiliza abajo)
  if (fam && child) {
    const firstMonth = todayStr().slice(0, 7) + '-01';
    const mesNombre = MESES_LARGO[new Date().getMonth()];
    const [asnap, authsnap, evsnap] = await Promise.all([
      getDocs(query(collection(db, 'attendance'),
        where('studentId', '==', child.id), orderBy('date', 'desc'), limit(60))),
      getDocs(query(collection(db, 'authorizations'), orderBy('createdAt', 'desc'), limit(20))),
      getDocs(query(collection(db, 'evaluations'),
        where('studentId', '==', child.id), orderBy('date', 'desc'), limit(1))),
    ]);
    const monthDocs = asnap.docs.map(d => d.data()).filter(a => a.date >= firstMonth);
    const pct = monthDocs.length
      ? Math.round(monthDocs.filter(a => a.status === 'presente').length / monthDocs.length * 100)
      : null;
    let pending = 0;
    for (const d of authsnap.docs) {
      const s = await getDoc(doc(db, 'authorizations', d.id, 'signatures', state.user.uid));
      if (!s.exists()) pending++;
    }
    lastEval = evsnap.empty ? null : evsnap.docs[0].data();
    const todayEval = (lastEval && lastEval.date === todayStr()) ? lastEval : null;
    const todayAvg = todayEval ? avgScore(evalScores(todayEval)) : null;
    metrics = `
      <div class="card metric col-4 metrics-mobile clickable" data-action="go" data-screen="attendance">
        <div class="metric-top"><span class="metric-ico">${NAV_ICONS.attendance}</span><small>${mesNombre}</small></div>
        <div><b>${pct == null ? '—' : pct + '%'}</b><br><span>de asistencia</span></div>
      </div>
      <div class="card metric col-4 metrics-mobile clickable" data-action="go" data-screen="auths">
        <div class="metric-top"><span class="metric-ico orange">${NAV_ICONS.auths}</span><small>Por revisar</small></div>
        <div><b>${pending}</b><br><span>pendiente(s) de firma</span></div>
      </div>
      <div class="card metric col-4 metrics-mobile clickable" data-action="go" data-screen="progress">
        <div class="metric-top"><span class="metric-ico blue">${NAV_ICONS.evaluate}</span><small>Hoy</small></div>
        <div>${todayAvg ? `<b>${todayAvg}</b><br><span>valoración de hoy</span>` : `<b>—</b><br><span>Sin evaluar hoy</span>`}</div>
      </div>`;
  } else if (!fam) {
    const [attsnap, authsnap, evsnap] = await Promise.all([
      getDocs(query(collection(db, 'attendance'), where('date', '==', todayStr()))),
      getDocs(query(collection(db, 'authorizations'), orderBy('createdAt', 'desc'), limit(50))),
      getDocs(query(collection(db, 'evaluations'), where('date', '==', todayStr()))),
    ]);
    metrics = `
      <div class="card metric col-4 metrics-mobile clickable" data-action="go" data-screen="attendance">
        <div class="metric-top"><span class="metric-ico">${NAV_ICONS.attendance}</span><small>Hoy</small></div>
        <div><b>${attsnap.size}</b><br><span>asistencias de hoy</span></div>
      </div>
      <div class="card metric col-4 metrics-mobile clickable" data-action="go" data-screen="auths">
        <div class="metric-top"><span class="metric-ico orange">${NAV_ICONS.auths}</span><small>Abiertas</small></div>
        <div><b>${authsnap.size}</b><br><span>autorizaciones</span></div>
      </div>
      <div class="card metric col-4 metrics-mobile clickable" data-action="go" data-screen="evaluate">
        <div class="metric-top"><span class="metric-ico blue">${NAV_ICONS.evaluate}</span><small>Hoy</small></div>
        <div><b>${evsnap.size}/${state.students.length}</b><br><span>evaluaciones hechas</span></div>
      </div>`;
  }

  // Tarjeta "Última valoración" (familia) o "Acciones rápidas" (monitor).
  let extraCard = '';
  if (fam && child) {
    const scores = lastEval ? evalScores(lastEval) : [];
    extraCard = `
      <div class="col-12"><div class="section-head"><h3>Última valoración</h3>
        <button class="text-btn" data-action="go" data-screen="progress">Ver progreso →</button></div></div>
      <div class="col-12">${lastEval ? `
        <article class="card clickable" data-action="go" data-screen="progress">
          <span class="badge ok">${fmtDate(lastEval.date)}</span>
          <h3 style="margin:12px 0 5px">${esc(lastEval.comment || 'Valoración del día')}</h3>
          <p class="muted">${scores.map(s => `${esc(s.label)}: ${s.value}/3`).join(' · ')}</p>
        </article>`
        : emptyBox('📈', 'Aún no hay valoraciones de tu hijo/a.')}</div>`;
  } else if (!fam) {
    extraCard = `
      <div class="col-12"><div class="section-head"><h3>Acciones rápidas</h3></div></div>
      <div class="col-12"><div class="card"><div class="filters" style="margin:0">
        <button class="btn" data-action="go" data-screen="attendance">Pasar lista</button>
        <button class="btn secondary" data-action="go" data-screen="evaluate">Evaluar sesión</button>
        <button class="btn secondary" data-action="new-notice">Nuevo aviso</button>
      </div></div></div>`;
  }

  c.innerHTML = `
    <div class="greeting">
      <div><h2>${saludoHora()}, ${esc(nombre)}</h2><p>${subtitulo}</p></div>
      <span class="date-chip">${fechaLargaHoy()}</span>
    </div>
    <div class="grid">
      <div class="col-8">
        ${latest ? `
        <article class="card notice-feature clickable" data-action="go" data-screen="notices">
          <span class="badge">${latest.pinned ? 'Fijado · ' : ''}Último aviso</span>
          <h3>${esc(latest.title)}</h3>
          <p>${esc(latest.body)}</p>
          <div class="notice-meta"><span>Equipo de Estudio Dirigido</span><span>•</span><span>${tsToDate(latest.createdAt)}</span></div>
        </article>` : emptyBox('📋', 'Aún no hay avisos en el tablón.')}
      </div>
      <div class="col-4"><div class="card">
        <div class="section-head"><h3>Próxima sesión</h3></div>
        ${nextSession ? `
          <p style="font:800 28px Manrope;margin:14px 0 2px">${fmtDate(nextSession.date)}</p>
          <p class="muted" style="margin:0">${esc(nextSession.startTime || '')}${nextSession.endTime ? '–' + esc(nextSession.endTime) : ''}${(nextSession.room || nextSession.aula) ? ' · ' + esc(nextSession.room || nextSession.aula) : ''}</p>
          ${nextSession.title ? `<p class="muted" style="margin:6px 0 0">${esc(nextSession.title)}</p>` : ''}` : `
          <p class="muted" style="margin:14px 0">Sin sesiones programadas.</p>`}
        <button class="text-btn" data-action="go" data-screen="calendar" style="margin-top:18px">Ver calendario →</button>
      </div></div>
      ${metrics}
      ${extraCard}
      <div class="col-12"><div class="section-head"><h3>Tablón de anuncios</h3>
        <button class="text-btn" data-action="go" data-screen="notices">Ver tablón →</button>
      </div></div>
    </div>`;
}

async function renderNoticeCompose() {
  const editing = state.editingNoticeId ? (await getDoc(doc(db, 'notices', state.editingNoticeId))).data() : null;
  $('notice-compose-content').innerHTML = `
    <button class="back" data-action="go" data-screen="notices">‹ Avisos</button>
    <h2>${editing ? 'Editar aviso' : 'Nuevo aviso'}</h2>
    <label for="nc-title">Título</label>
    <input type="text" id="nc-title" maxlength="120" placeholder="Ej.: Cambio de horario del miércoles" value="${esc(editing?.title || '')}">
    <label for="nc-body">Texto</label>
    <textarea id="nc-body" placeholder="Escribe el aviso para las familias…">${esc(editing?.body || '')}</textarea>
    <label><input type="checkbox" id="nc-pinned" ${editing?.pinned ? 'checked' : ''}> Fijar en el tablón</label>
    <button class="btn block" data-action="publish-notice">${editing ? 'Guardar cambios' : 'Publicar aviso'}</button>`;
}
ACTIONS['new-notice'] = () => {
  state.editingNoticeId = null;
  show('noticeCompose');
};
ACTIONS['edit-notice'] = (d) => {
  state.editingNoticeId = d.id;
  show('noticeCompose');
};
ACTIONS['delete-notice'] = async (d) => {
  if (!confirm('¿Eliminar este aviso del tablón?')) return;
  await deleteDoc(doc(db, 'notices', d.id));
  toast('Aviso eliminado.');
  const active = document.querySelector('.screen.active');
  show(active ? active.id.replace('screen-', '') : 'notices');
};
ACTIONS['publish-notice'] = async () => {
  const title = $('nc-title').value.trim();
  const body = $('nc-body').value.trim();
  if (!title || !body) { toast('Escribe un título y un texto.'); return; }
  const data = {
    title, body, pinned: $('nc-pinned').checked,
    createdByUid: state.user.uid, createdAt: serverTimestamp(),
  };
  if (state.editingNoticeId) {
    await updateDoc(doc(db, 'notices', state.editingNoticeId), {
      title, body, pinned: $('nc-pinned').checked,
    });
    state.editingNoticeId = null;
    toast('Aviso actualizado.');
  } else {
    await addDoc(collection(db, 'notices'), data);
    toast('Aviso publicado en el tablón.');
  }
  show('notices');
};

/* ---------------- Asistencia ---------------- */
async function renderAttendance() {
  const c = $('attendance-content');
  if (isMonitor()) {
    c.innerHTML = `
      <h2>Pasar lista</h2>
      <label for="att-date">Fecha</label>
      <input type="date" id="att-date" value="${todayStr()}">
      <div id="att-rows" style="margin-top:12px"></div>
      <button class="btn block" data-action="save-attendance">Guardar asistencia</button>`;
    $('att-date').addEventListener('change', (e) => loadAttendanceRows(e.target.value));
    await loadAttendanceRows($('att-date').value);
  } else {
    if (!state.children.length) {
      c.innerHTML = `<h2>Asistencia</h2>` + emptyBox('✅', 'Aún no hay alumnos vinculados a tu familia.');
      return;
    }
    c.innerHTML = `
      <h2>Asistencia</h2>
      ${state.children.length > 1 ? childSelectHTML('att-child') : ''}
      <div id="att-history" style="margin-top:12px"></div>`;
    const sel = $('att-child');
    if (sel) sel.addEventListener('change', () => { state.selectedChildId = sel.value; loadAttendanceHistory(); });
    await loadAttendanceHistory();
  }
}

async function loadAttendanceRows(date) {
  const box = $('att-rows');
  const snap = await getDocs(query(collection(db, 'attendance'), where('date', '==', date)));
  state.attMarks = {};
  snap.docs.forEach(d => { state.attMarks[d.data().studentId] = d.data().status; });
  if (!state.students.length) {
    box.innerHTML = emptyBox('✅', 'Aún no hay alumnos dados de alta.');
    return;
  }
  box.innerHTML = state.students.map(s => {
    const cur = state.attMarks[s.id] || 'presente';
    return `<div class="card">
      <div><strong>${esc(s.firstName)} ${esc(s.lastName || '')}</strong>
      <div class="meta">${esc(s.group || '')}</div></div>
      <div class="seg">
        <button data-action="att-mark" data-student="${s.id}" data-status="presente" class="${cur === 'presente' ? 'on' : ''}">Presente</button>
        <button data-action="att-mark" data-student="${s.id}" data-status="ausente" class="${cur === 'ausente' ? 'on no' : ''}">Ausente</button>
        <button data-action="att-mark" data-student="${s.id}" data-status="justificado" class="${cur === 'justificado' ? 'on maybe' : ''}">Justif.</button>
      </div></div>`;
  }).join('');
}
ACTIONS['att-mark'] = (d, el) => {
  state.attMarks[d.student] = d.status;
  el.parentElement.querySelectorAll('button').forEach(b => b.classList.remove('on', 'no', 'maybe'));
  el.classList.add('on');
  if (d.status === 'ausente') el.classList.add('no');
  if (d.status === 'justificado') el.classList.add('maybe');
};
ACTIONS['save-attendance'] = async () => {
  const date = $('att-date').value || todayStr();
  for (const s of state.students) {
    await setDoc(doc(db, 'attendance', `${s.id}_${date}`), {
      studentId: s.id, date, status: state.attMarks[s.id] || 'presente',
      markedByUid: state.user.uid, createdAt: serverTimestamp(),
    }, { merge: true });
  }
  toast('Asistencia guardada.');
};

async function loadAttendanceHistory() {
  const box = $('att-history');
  const snap = await getDocs(query(collection(db, 'attendance'),
    where('studentId', '==', state.selectedChildId), orderBy('date', 'desc'), limit(60)));
  if (snap.empty) { box.innerHTML = emptyBox('✅', 'Aún no hay registros de asistencia.'); return; }
  box.innerHTML = snap.docs.map(d => {
    const a = d.data();
    return `<div class="card"><div class="row">
      <strong>${fmtDate(a.date)}</strong>
      <span class="tag ${a.status}">${a.status}</span>
    </div></div>`;
  }).join('');
}

/* ---------------- Evaluación diaria (monitor) / Progreso (familia) ---------------- */

async function renderEvaluate() {
  const c = $('evaluate-content');
  if (!state.students.length) {
    c.innerHTML = `<h2>Evaluación diaria</h2>` + emptyBox('📝', 'Aún no hay alumnos dados de alta.');
    return;
  }
  const items = (await loadEvalItems()).filter(i => i.active !== false);
  state.evalMarks = {};
  items.forEach(it => { state.evalMarks[it.id] = 2; });
  c.innerHTML = `
    <div class="section-head"><h2>Evaluación diaria</h2>
      <button class="icon-btn" data-action="go" data-screen="evalItems" aria-label="Configurar ítems de evaluación">⚙️</button>
    </div>
    ${items.length ? `
    <label for="ev-student">Alumno/a</label>
    <select id="ev-student">${state.students.map(s =>
      `<option value="${s.id}">${esc(s.firstName)} ${esc(s.lastName || '')}</option>`).join('')}</select>
    <label for="ev-date">Fecha</label>
    <input type="date" id="ev-date" value="${todayStr()}">
    ${items.map(it => `
      <label>${esc(it.label)}</label>
      <div class="seg">
        <button data-action="ev-mark" data-crit="${it.id}" data-val="1">1 · Mejorar</button>
        <button data-action="ev-mark" data-crit="${it.id}" data-val="2" class="on">2 · Bien</button>
        <button data-action="ev-mark" data-crit="${it.id}" data-val="3">3 · Muy bien</button>
      </div>`).join('')}
    <div class="meta" style="margin-top:8px">1 Necesita mejorar · 2 Bien · 3 Muy bien</div>
    <label for="ev-comment">Comentario (opcional)</label>
    <textarea id="ev-comment" placeholder="Observaciones del día…"></textarea>
    <button class="btn block" data-action="save-evaluation">Guardar evaluación</button>`
    : emptyBox('⚙️', 'No hay ítems de evaluación activos. Configúralos con el botón ⚙️.')}`;
}
ACTIONS['ev-mark'] = (d, el) => {
  state.evalMarks[d.crit] = parseInt(d.val, 10);
  el.parentElement.querySelectorAll('button').forEach(b => b.classList.remove('on'));
  el.classList.add('on');
};
ACTIONS['save-evaluation'] = async () => {
  const studentId = $('ev-student').value;
  const date = $('ev-date').value || todayStr();
  const scores = {};
  for (const [k, v] of Object.entries(state.evalMarks)) scores[k] = v;
  await setDoc(doc(db, 'evaluations', `${studentId}_${date}`), {
    studentId, date, scores,
    comment: $('ev-comment').value.trim(),
    createdByUid: state.user.uid, createdAt: serverTimestamp(),
  }, { merge: true });
  toast('Evaluación guardada.');
};

/* ---------------- Mi hijo (familia) ---------------- */
async function renderChild() {
  const c = $('child-content');
  if (isMonitor()) { show('home'); return; }
  if (!state.children.length) {
    c.innerHTML = `<h2>Mi hijo/a</h2>` + emptyBox('👧', 'Aún no hay alumnos vinculados a tu familia.');
    return;
  }
  const child = state.children.find(x => x.id === state.selectedChildId) || state.children[0];
  const firstMonth = todayStr().slice(0, 7) + '-01';
  const mesNombre = MESES_LARGO[new Date().getMonth()];
  const [asnap, evsnap] = await Promise.all([
    getDocs(query(collection(db, 'attendance'),
      where('studentId', '==', child.id), orderBy('date', 'desc'), limit(60))),
    getDocs(query(collection(db, 'evaluations'),
      where('studentId', '==', child.id), orderBy('date', 'desc'), limit(1))),
  ]);
  const monthDocs = asnap.docs.map(d => d.data()).filter(a => a.date >= firstMonth);
  const present = monthDocs.filter(a => a.status === 'presente').length;
  const pct = monthDocs.length ? Math.round(present / monthDocs.length * 100) : null;
  const lastEval = evsnap.empty ? null : evsnap.docs[0].data();
  const scores = lastEval ? evalScores(lastEval) : [];
  c.innerHTML = `
    <div class="card child-hero">
      <div class="child-avatar">${initialsOf(child.firstName + ' ' + (child.lastName || ''))}</div>
      <div>
        ${child.group ? `<span class="tag">${esc(child.group)}</span>` : ''}
        <h2>${esc(child.firstName)} ${esc(child.lastName || '')}</h2>
        <p class="muted" style="margin:4px 0 0">Estudio Dirigido · Glera</p>
      </div>
      <button class="btn secondary" data-action="contact-monitor">Escribir al monitor</button>
    </div>
    ${state.children.length > 1 ? `<div class="card" style="margin-top:12px">${childSelectHTML('child-sel')}</div>` : ''}
    <div class="grid" style="margin-top:12px">
      <div class="card col-7">
        <div class="section-head"><h3>Datos de la actividad</h3></div>
        <div class="detail-grid">
          <div class="detail-row"><span>Grupo</span><b>${esc(child.group || '—')}</b></div>
        </div>
      </div>
      <div class="col-5">
        <div class="card metric">
          <div class="metric-top"><span class="metric-ico">${NAV_ICONS.attendance}</span><small>${mesNombre}</small></div>
          <div><b>${pct == null ? '—' : pct + '%'}</b><br><span>${present} de ${monthDocs.length} sesiones</span></div>
        </div>
        <button class="btn secondary block" data-action="go" data-screen="attendance" style="margin-top:12px">Ver asistencia completa</button>
      </div>
      <div class="card col-12">
        <div class="section-head"><h3>Seguimiento reciente</h3>
          <button class="text-btn" data-action="go" data-screen="progress">Ver progreso →</button></div>
        ${lastEval ? `
          <div class="meta" style="margin-bottom:8px">${fmtDate(lastEval.date)}</div>
          <div class="rating-summary">${scores.map(s => `
            <div class="rating-box"><b>${s.value}/3</b><small>${esc(s.label)}</small></div>`).join('')}
          </div>
          ${lastEval.comment ? `<p class="muted" style="margin-top:12px">${esc(lastEval.comment)}</p>` : ''}`
          : emptyBox('📈', 'Aún no hay valoraciones.')}
      </div>
    </div>`;
  const sel = $('child-sel');
  if (sel) sel.addEventListener('change', () => { state.selectedChildId = sel.value; renderChild(); });
}

async function renderProgress() {
  const c = $('progress-content');
  if (!state.children.length) {
    c.innerHTML = `<h2>Progreso</h2>` + emptyBox('📈', 'Aún no hay alumnos vinculados a tu familia.');
    return;
  }
  c.innerHTML = `<h2>Progreso</h2>
    ${state.children.length > 1 ? childSelectHTML('prog-child') : ''}
    <div id="prog-body" style="margin-top:12px"></div>`;
  const sel = $('prog-child');
  if (sel) sel.addEventListener('change', () => { state.selectedChildId = sel.value; loadProgress(); });
  await loadProgress();
}

async function loadProgress() {
  const box = $('prog-body');
  const snap = await getDocs(query(collection(db, 'evaluations'),
    where('studentId', '==', state.selectedChildId), orderBy('date', 'desc'), limit(30)));
  if (snap.empty) { box.innerHTML = emptyBox('📈', 'Aún no hay evaluaciones.'); return; }
  const latest = snap.docs[0].data();
  const latestScores = evalScores(latest);
  box.innerHTML = `
    <h3>Última evaluación (${fmtDate(latest.date)})</h3>
    <div class="rating-summary">
      ${latestScores.map(s => `
        <div class="rating-box"><b>${s.value}/3</b><small>${esc(s.label)}</small></div>`).join('')}
    </div>
    ${latest.comment ? `<div class="card" style="margin-top:12px"><p>💬 ${esc(latest.comment)}</p></div>` : ''}
    <hr class="divider"><h3>Historial</h3>
    ${snap.docs.map(d => {
      const e = d.data();
      const sc = evalScores(e);
      const avg = avgScore(sc);
      return `<div class="card"><div class="row"><strong>${fmtDate(e.date)}</strong>
        <span class="meta">${avg ? `Media ${avg}` : '—'}</span></div></div>`;
    }).join('')}`;
}

/* ---------------- Ítems de evaluación (configuración del monitor) ---------------- */
async function renderEvalItems() {
  if (!isMonitor()) { show('home'); return; }
  const c = $('evalitems-content');
  const items = await loadEvalItems();
  c.innerHTML = `
    <button class="back" data-action="go" data-screen="evaluate">‹ Evaluación diaria</button>
    <div class="section-head"><div><h3>Ítems de evaluación</h3>
      <p>Define qué se valora cada día (escala 1-3).</p></div></div>
    <div class="item-list">
      ${items.length ? items.map((it, idx) => `
        <div class="list-item">
          <span class="item-icon">📝</span>
          <div class="item-main">
            <input type="text" data-item-label="${it.id}" value="${esc(it.label)}" maxlength="60" aria-label="Nombre del ítem">
            <label class="check" style="margin:8px 0 0"><input type="checkbox" data-item-active="${it.id}" ${it.active !== false ? 'checked' : ''}> Activo</label>
          </div>
          <div class="item-side">
            <div class="row" style="gap:4px">
              <button class="icon-btn" data-action="evalitem-move" data-id="${it.id}" data-dir="-1" ${idx === 0 ? 'disabled' : ''} aria-label="Subir">↑</button>
              <button class="icon-btn" data-action="evalitem-move" data-id="${it.id}" data-dir="1" ${idx === items.length - 1 ? 'disabled' : ''} aria-label="Bajar">↓</button>
            </div>
            <button class="danger-btn" data-action="evalitem-delete" data-id="${it.id}">Eliminar</button>
          </div>
        </div>`).join('')
      : emptyBox('📝', 'No hay ítems. Añade el primero abajo.')}
    </div>
    <div class="card" style="margin-top:16px">
      <div class="section-head"><h3>Nuevo ítem</h3></div>
      <label for="ei-new">Nombre del ítem</label>
      <input type="text" id="ei-new" maxlength="60" placeholder="Ej.: Comportamiento" autocomplete="off">
      <button class="btn block" data-action="evalitem-add">Añadir ítem</button>
    </div>`;
  c.querySelectorAll('[data-item-label]').forEach(inp => {
    inp.addEventListener('change', async () => {
      const v = inp.value.trim();
      const prev = (state.evalItems.find(i => i.id === inp.dataset.itemLabel) || {}).label || '';
      if (!v) { inp.value = prev; toast('El nombre no puede estar vacío.'); return; }
      try {
        await updateDoc(doc(db, 'evalItems', inp.dataset.itemLabel), { label: v });
        const it = state.evalItems.find(i => i.id === inp.dataset.itemLabel);
        if (it) it.label = v;
        toast('Ítem actualizado.');
      } catch (err) { console.error(err); inp.value = prev; toast('No se pudo guardar.'); }
    });
  });
  c.querySelectorAll('[data-item-active]').forEach(chk => {
    chk.addEventListener('change', async () => {
      try {
        await updateDoc(doc(db, 'evalItems', chk.dataset.itemActive), { active: chk.checked });
        const it = state.evalItems.find(i => i.id === chk.dataset.itemActive);
        if (it) it.active = chk.checked;
        toast(chk.checked ? 'Ítem activado.' : 'Ítem desactivado.');
      } catch (err) { console.error(err); chk.checked = !chk.checked; toast('No se pudo guardar.'); }
    });
  });
}
ACTIONS['evalitem-add'] = async () => {
  const label = $('ei-new').value.trim();
  if (!label) { toast('Escribe el nombre del ítem.'); return; }
  const maxOrder = (state.evalItems || []).reduce((m, i) => Math.max(m, i.order || 0), 0);
  try {
    await addDoc(collection(db, 'evalItems'), { label, order: maxOrder + 1, active: true });
    toast('Ítem añadido.');
    renderEvalItems();
  } catch (err) { console.error(err); toast('No se pudo añadir.'); }
};
ACTIONS['evalitem-delete'] = async (d) => {
  const it = (state.evalItems || []).find(i => i.id === d.id);
  if (!confirm(`¿Eliminar el ítem "${it ? it.label : ''}"? Las evaluaciones ya guardadas no se borran.`)) return;
  try {
    await deleteDoc(doc(db, 'evalItems', d.id));
    toast('Ítem eliminado.');
    renderEvalItems();
  } catch (err) { console.error(err); toast('No se pudo eliminar.'); }
};
ACTIONS['evalitem-move'] = async (d) => {
  const items = [...(state.evalItems || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  const idx = items.findIndex(i => i.id === d.id);
  const j = idx + parseInt(d.dir, 10);
  if (idx < 0 || j < 0 || j >= items.length) return;
  try {
    const [a, b] = [items[idx], items[j]];
    await updateDoc(doc(db, 'evalItems', a.id), { order: b.order });
    await updateDoc(doc(db, 'evalItems', b.id), { order: a.order });
    renderEvalItems();
  } catch (err) { console.error(err); toast('No se pudo reordenar.'); }
};

// Registro de pantallas de esta primera parte.
Object.assign(RENDER, {
  home: renderHome,
  attendance: renderAttendance,
  evaluate: renderEvaluate,
  progress: renderProgress,
  evalItems: renderEvalItems,
});

/* ============================================================
   PARTE 2 — Informes, chat, autorizaciones, calendario,
   notificaciones, perfil, menú y notificaciones push.
   ============================================================ */

/* ---------------- Informes ---------------- */
async function renderReports() {
  const c = $('reports-content');
  if (isMonitor()) {
    // Estado del mes: cuenta diarios/mensuales creados este mes.
    const msnap = await getDocs(query(collection(db, 'reports'), orderBy('createdAt', 'desc'), limit(100)));
    const ym = todayStr().slice(0, 7);
    let nDiario = 0, nMensual = 0;
    msnap.docs.forEach(d => {
      const r = d.data();
      let rym = '';
      try { rym = r.createdAt.toDate().toISOString().slice(0, 7); } catch { /* sin fecha */ }
      if (rym === ym) { reportType(r) === 'mensual' ? nMensual++ : nDiario++; }
    });
    c.innerHTML = `
      <div class="screen-head"><h2>Informes</h2></div>
      <div class="grid">
        <div class="col-7"><div class="card">
          <div class="section-head"><h3>Preparar informe</h3><span class="badge info">Borrador</span></div>
          <div class="report-form">
            <label for="rp-student">Alumno/a</label>
            <select id="rp-student">${state.students.map(s =>
              `<option value="${s.id}">${esc(s.firstName)} ${esc(s.lastName || '')}</option>`).join('')}</select>
            <label for="rp-type">Tipo</label>
            <select id="rp-type">
              <option value="diario">Diario</option>
              <option value="mensual">Mensual</option>
            </select>
            <label for="rp-month">Mes</label>
            <input type="month" id="rp-month" value="${todayStr().slice(0, 7)}">
            <label for="rp-title">Título</label>
            <input type="text" id="rp-title" maxlength="120" placeholder="Ej.: Informe de octubre">
            <label for="rp-body">Informe</label>
            <textarea id="rp-body" placeholder="Cómo va el alumno en la actividad…"></textarea>
            <div class="row" style="margin-top:12px;gap:8px">
              <button class="btn secondary" data-action="preview-report" style="flex:1">Previsualizar</button>
              <button class="btn" data-action="publish-report2" style="flex:1">Publicar y avisar</button>
            </div>
            <p class="meta" style="margin-top:8px">Al publicar, la familia recibe un aviso automáticamente.</p>
          </div>
        </div></div>
        <div class="col-5"><div class="card">
          <div class="section-head"><h3>Estado del mes</h3></div>
          <div class="history-line"><span>Informes diarios</span><b>${nDiario}</b></div>
          <div class="history-line"><span>Informes mensuales</span><b>${nMensual}</b></div>
          <p class="meta" style="margin-top:10px">Enviados en ${fmtMonth(ym)}.</p>
        </div></div>
      </div>
      <div class="section-head" style="margin-top:8px"><h3>Enviados</h3></div>
      <div id="reports-list"></div>`;
    $('reports-list').innerHTML = msnap.empty
      ? emptyBox('📄', 'Aún no hay informes.')
      : msnap.docs.map(d => reportCard(d.id, d.data())).join('');
  } else {
    if (!state.children.length) {
      c.innerHTML = `<h2>Informes</h2>` + emptyBox('📄', 'Aún no hay alumnos vinculados a tu familia.');
      return;
    }
    const f = state.reportFilter || 'all';
    c.innerHTML = `<h2>Informes</h2>
      ${state.children.length > 1 ? childSelectHTML('rep-child') : ''}
      <div class="filters">
        <button class="filter ${f === 'all' ? 'active' : ''}" data-action="report-filter" data-f="all">Todos</button>
        <button class="filter ${f === 'diario' ? 'active' : ''}" data-action="report-filter" data-f="diario">Diarios</button>
        <button class="filter ${f === 'mensual' ? 'active' : ''}" data-action="report-filter" data-f="mensual">Mensuales</button>
      </div>
      <div id="reports-list" style="margin-top:12px"></div>`;
    const sel = $('rep-child');
    if (sel) sel.addEventListener('change', () => { state.selectedChildId = sel.value; loadReports(); });
    await loadReports();
  }
}
ACTIONS['report-filter'] = (d) => { state.reportFilter = d.f; renderReports(); };

const reportCard = (id, r) => `
  <div class="card" data-action="open-report" data-id="${id}" style="cursor:pointer">
    <h3>${esc(r.title)}</h3>
    <div class="meta">${r.type ? `<span class="tag">${r.type === 'mensual' ? 'Mensual' : 'Diario'}</span> ` : ''}${r.month ? fmtMonth(r.month) + ' · ' : ''}${tsToDate(r.createdAt)}</div>
  </div>`;

async function loadReports() {
  const box = $('reports-list');
  const snap = await getDocs(query(collection(db, 'reports'),
    where('studentId', '==', state.selectedChildId), orderBy('createdAt', 'desc'), limit(40)));
  let docs = snap.docs;
  const f = state.reportFilter || 'all';
  if (f !== 'all') docs = docs.filter(d => reportType(d.data()) === f);
  box.innerHTML = docs.length
    ? docs.map(d => reportCard(d.id, d.data())).join('')
    : emptyBox('📄', f === 'all' ? 'Aún no hay informes.' : 'No hay informes de este tipo.');
}

function showReportDetail(r) {
  const dateStr = r._preview ? 'Ahora mismo' : tsToDate(r.createdAt);
  $('report-detail-content').innerHTML = `
    <button class="back" data-action="go" data-screen="reports">‹ Informes</button>
    ${r._preview ? '<div><span class="badge info">Vista previa · aún no publicado</span></div>' : ''}
    <h2 style="margin-top:10px">${esc(r.title)}</h2>
    <div class="meta">${r.type ? `<span class="tag">${r.type === 'mensual' ? 'Mensual' : 'Diario'}</span> ` : ''}${r.month ? fmtMonth(r.month) + ' · ' : ''}${dateStr}</div>
    <div class="card" style="margin-top:12px"><p style="white-space:pre-wrap">${esc(r.body)}</p></div>`;
  show('reportDetail');
}
ACTIONS['open-report'] = async (d) => {
  const snap = await getDoc(doc(db, 'reports', d.id));
  if (!snap.exists()) return;
  showReportDetail(snap.data());
};
ACTIONS['preview-report'] = () => {
  const studentId = $('rp-student').value;
  const s = state.students.find(x => x.id === studentId);
  showReportDetail({
    title: $('rp-title').value.trim() || '(Sin título)',
    body: $('rp-body').value.trim() || '(Sin texto)',
    type: $('rp-type').value,
    month: $('rp-month').value || null,
    studentName: s ? `${s.firstName} ${s.lastName || ''}`.trim() : '',
    _preview: true,
  });
};
ACTIONS['publish-report2'] = async () => {
  const studentId = $('rp-student').value;
  const title = $('rp-title').value.trim();
  const body = $('rp-body').value.trim();
  if (!studentId) { toast('Da de alta al menos un alumno primero.'); return; }
  if (!title || !body) { toast('Escribe un título y el texto del informe.'); return; }
  await addDoc(collection(db, 'reports'), {
    studentId, title, body,
    type: $('rp-type').value,
    month: $('rp-month').value || null,
    createdByUid: state.user.uid, createdAt: serverTimestamp(),
  });
  toast('Informe publicado. La familia recibirá un aviso.');
  show('reports');
};

async function renderReportCompose() {
  $('report-compose-content').innerHTML = `
    <button class="back" data-action="go" data-screen="reports">‹ Informes</button>
    <h2>Nuevo informe</h2>
    <label for="rc-student">Alumno/a</label>
    <select id="rc-student">${state.students.map(s =>
      `<option value="${s.id}">${esc(s.firstName)} ${esc(s.lastName || '')}</option>`).join('')}</select>
    <label for="rc-month">Mes</label>
    <input type="month" id="rc-month" value="${todayStr().slice(0, 7)}">
    <label for="rc-title">Título</label>
    <input type="text" id="rc-title" maxlength="120" placeholder="Ej.: Informe de octubre">
    <label for="rc-body">Informe</label>
    <textarea id="rc-body" placeholder="Cómo va el alumno en la actividad…"></textarea>
    <button class="btn block" data-action="publish-report">Enviar a la familia</button>`;
}
ACTIONS['publish-report'] = async () => {
  const studentId = $('rc-student').value;
  const title = $('rc-title').value.trim();
  const body = $('rc-body').value.trim();
  if (!title || !body) { toast('Escribe un título y el texto del informe.'); return; }
  await addDoc(collection(db, 'reports'), {
    studentId, title, body, month: $('rc-month').value || null,
    createdByUid: state.user.uid, createdAt: serverTimestamp(),
  });
  toast('Informe enviado a la familia.');
  show('reports');
};

/* ---------------- Chat ---------------- */
async function renderChatList() {
  const c = $('chat-list-content');
  const snap = await getDocs(query(collection(db, 'conversations'),
    where('participantUids', 'array-contains', state.user.uid),
    orderBy('updatedAt', 'desc'), limit(30)));
  c.innerHTML = `
    <div class="screen-head"><h2>Chat</h2>
      ${isMonitor() ? `<button class="btn small" data-action="new-conversation">+ Nueva</button>` : ''}
    </div><div id="conv-list"></div>`;
  const box = $('conv-list');
  if (snap.empty) { box.innerHTML = emptyBox('💬', 'Aún no hay conversaciones.'); return; }
  box.innerHTML = snap.docs.map(d => {
    const v = d.data();
    return `<div class="card chat-list-item" data-action="open-chat" data-id="${d.id}">
      <div class="row"><strong>${esc(v.studentName || 'Conversación')}</strong>
        <span class="meta">${v.updatedAt ? tsToDate(v.updatedAt) : ''}</span></div>
      <p class="muted">${esc(v.lastMessageText || 'Sin mensajes todavía.')}</p>
    </div>`;
  }).join('');
}

// El monitor elige un alumno y se abre un chat 1 a 1 con sus familias.
ACTIONS['new-conversation'] = () => {
  const box = $('conv-list');
  const opts = state.students.filter(s => (s.familyUids || []).length);
  if (!opts.length) {
    box.innerHTML = emptyBox('💬', 'Ningún alumno tiene familias vinculadas todavía.');
    return;
  }
  box.innerHTML = `<div class="card">
    <label for="ncv-student">Alumno/a</label>
    <select id="ncv-student">${opts.map(s =>
      `<option value="${s.id}">${esc(s.firstName)} ${esc(s.lastName || '')}</option>`).join('')}</select>
    <button class="btn block" data-action="create-conversation">Abrir conversación</button>
    <button class="btn secondary block" data-action="go" data-screen="chatList">Cancelar</button>
  </div>`;
};
ACTIONS['create-conversation'] = async () => {
  const sid = $('ncv-student').value;
  const s = state.students.find(x => x.id === sid);
  const participantUids = [...new Set([state.user.uid, ...(s.familyUids || [])])];
  const ref = await addDoc(collection(db, 'conversations'), {
    participantUids, studentId: sid,
    studentName: `${s.firstName} ${s.lastName || ''}`.trim(),
    lastMessageText: '', createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  openChat(ref.id);
};
ACTIONS['open-chat'] = (d) => openChat(d.id);

// La familia escribe al monitor: abre (o crea) la conversación con un monitor.
ACTIONS['contact-monitor'] = async () => {
  const child = state.children.find(x => x.id === state.selectedChildId) || state.children[0];
  if (!child) { toast('Aún no hay alumnos vinculados a tu familia.'); return; }
  const msnap = await getDocs(query(collection(db, 'users'), where('role', '==', 'monitor'), limit(5)));
  if (msnap.empty) { toast('Aún no hay monitores dados de alta.'); return; }
  const m = msnap.docs[0];
  // Reutiliza la conversación existente con ese monitor para este alumno, si la hay.
  const csnap = await getDocs(query(collection(db, 'conversations'),
    where('participantUids', 'array-contains', state.user.uid),
    orderBy('updatedAt', 'desc'), limit(30)));
  const existing = csnap.docs.find(d => {
    const p = d.data();
    return p.studentId === child.id && (p.participantUids || []).includes(m.id);
  });
  if (existing) { openChat(existing.id); return; }
  const ref = await addDoc(collection(db, 'conversations'), {
    participantUids: [state.user.uid, m.id],
    studentId: child.id,
    studentName: `${child.firstName} ${child.lastName || ''}`.trim(),
    lastMessageText: '', createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  openChat(ref.id);
};

async function openChat(convId) {
  state.currentConvId = convId;
  const csnap = await getDoc(doc(db, 'conversations', convId));
  const conv = csnap.data() || {};
  $('chat-view-content').innerHTML = `
    <button class="back" data-action="go" data-screen="chatList">‹ Chats</button>
    <h2>${esc(conv.studentName || 'Conversación')}</h2>
    <div class="chat-view">
      <div class="messages" id="chat-messages"></div>
      <div class="chat-input">
        <input type="text" id="chat-text" placeholder="Escribe un mensaje…" maxlength="500" autocomplete="off">
        <button class="btn" data-action="send-message">Enviar</button>
      </div>
    </div>`;
  show('chatView');
  // Escucha en tiempo real: los mensajes aparecen al instante.
  state.unsubChat = onSnapshot(
    query(collection(db, 'messages'),
      where('conversationId', '==', convId), orderBy('createdAt', 'asc'), limit(200)),
    (snap) => {
      const box = $('chat-messages');
      if (!box) return;
      box.innerHTML = snap.docs.map(d => {
        const m = d.data();
        const mine = m.senderUid === state.user.uid;
        return `<div class="msg ${mine ? 'mine' : 'theirs'}">
          ${mine ? '' : `<span class="who">${esc(m.senderName || '')}</span>`}
          ${esc(m.text)}</div>`;
      }).join('') || emptyBox('💬', 'Aún no hay mensajes. ¡Escribe el primero!');
      box.scrollTop = box.scrollHeight;
    });
  $('chat-text').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') ACTIONS['send-message']();
  });
}

ACTIONS['send-message'] = async () => {
  const input = $('chat-text');
  const text = input.value.trim();
  if (!text || !state.currentConvId) return;
  const csnap = await getDoc(doc(db, 'conversations', state.currentConvId));
  const participantUids = (csnap.data() && csnap.data().participantUids) || [];
  await addDoc(collection(db, 'messages'), {
    conversationId: state.currentConvId, participantUids,
    senderUid: state.user.uid, senderName: state.profile.displayName || 'Usuario',
    text, createdAt: serverTimestamp(),
  });
  await updateDoc(doc(db, 'conversations', state.currentConvId), {
    lastMessageText: text, lastMessageAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  input.value = '';
};

/* ---------------- Autorizaciones ---------------- */
async function renderAuths() {
  const c = $('auths-content');
  const snap = await getDocs(query(collection(db, 'authorizations'), orderBy('createdAt', 'desc'), limit(30)));
  c.innerHTML = `
    <div class="screen-head"><h2>Autorizaciones</h2>
      ${isMonitor() ? `<button class="btn small" data-action="go" data-screen="authCompose">+ Nueva</button>` : ''}
    </div><div id="auths-list"></div>`;
  const box = $('auths-list');
  if (snap.empty) { box.innerHTML = emptyBox('✍️', 'Aún no hay autorizaciones.'); return; }
  const cards = [];
  for (const d of snap.docs) {
    const a = d.data();
    let status;
    if (isFamilia()) {
      const s = await getDoc(doc(db, 'authorizations', d.id, 'signatures', state.user.uid));
      status = s.exists()
        ? '<span class="tag signed">Firmada</span>'
        : '<span class="tag pending">Pendiente de firma</span>';
    } else {
      const ss = await getDocs(collection(db, 'authorizations', d.id, 'signatures'));
      status = `<span class="meta">✍️ ${ss.size} firmas</span>`;
    }
    cards.push(`<div class="card" data-action="open-auth" data-id="${d.id}" style="cursor:pointer">
      <div class="row"><h3>${esc(a.title)}</h3>${status}</div>
      <div class="meta">${a.dueDate ? 'Límite: ' + fmtDate(a.dueDate) : ''}</div>
    </div>`);
  }
  box.innerHTML = cards.join('');
}

ACTIONS['open-auth'] = async (d) => {
  const snap = await getDoc(doc(db, 'authorizations', d.id));
  if (!snap.exists()) return;
  const a = snap.data();
  let action = '';
  if (isFamilia()) {
    const s = await getDoc(doc(db, 'authorizations', d.id, 'signatures', state.user.uid));
    action = s.exists()
      ? `<p class="meta">✅ Firmada el ${tsToDate(s.data().signedAt)}</p>`
      : `<button class="btn block" data-action="sign-auth" data-id="${d.id}">Firmar autorización</button>`;
  } else {
    const ss = await getDocs(collection(db, 'authorizations', d.id, 'signatures'));
    action = `<p class="meta">✍️ ${ss.size} familias han firmado.</p>`;
  }
  $('auth-detail-content').innerHTML = `
    <button class="back" data-action="go" data-screen="auths">‹ Autorizaciones</button>
    <h2>${esc(a.title)}</h2>
    <div class="card"><p style="white-space:pre-wrap">${esc(a.description)}</p>
      ${a.dueDate ? `<div class="meta">Límite: ${fmtDate(a.dueDate)}</div>` : ''}</div>
    ${action}`;
  show('authDetail');
};

ACTIONS['sign-auth'] = async (d) => {
  await setDoc(doc(db, 'authorizations', d.id, 'signatures', state.user.uid), {
    signedAt: serverTimestamp(), displayName: state.profile.displayName || '',
  });
  toast('Autorización firmada.');
  ACTIONS['open-auth'](d);
};

async function renderAuthCompose() {
  $('auth-compose-content').innerHTML = `
    <button class="back" data-action="go" data-screen="auths">‹ Autorizaciones</button>
    <h2>Nueva autorización</h2>
    <label for="ac-title">Título</label>
    <input type="text" id="ac-title" maxlength="120" placeholder="Ej.: Salir solo al terminar">
    <label for="ac-desc">Descripción</label>
    <textarea id="ac-desc" placeholder="Explica qué autoriza la familia…"></textarea>
    <label for="ac-due">Fecha límite (opcional)</label>
    <input type="date" id="ac-due">
    <button class="btn block" data-action="publish-auth">Solicitar firmas</button>`;
}
ACTIONS['publish-auth'] = async () => {
  const title = $('ac-title').value.trim();
  const description = $('ac-desc').value.trim();
  if (!title || !description) { toast('Escribe un título y una descripción.'); return; }
  await addDoc(collection(db, 'authorizations'), {
    title, description, dueDate: $('ac-due').value || null,
    createdByUid: state.user.uid, createdAt: serverTimestamp(),
  });
  toast('Autorización publicada.');
  show('auths');
};

/* ---------------- Calendario de sesiones ---------------- */
async function renderCalendar() {
  const c = $('calendar-content');
  const snap = await getDocs(query(collection(db, 'sessions'),
    where('date', '>=', todayStr()), orderBy('date', 'asc'), limit(30)));
  c.innerHTML = `
    <div class="screen-head"><h2>Calendario</h2>
      ${isMonitor() ? `<button class="btn small" data-action="toggle-session-form">+ Sesión</button>` : ''}
    </div>
    <div id="session-form" class="hidden card">
      <label for="se-date">Fecha</label><input type="date" id="se-date" value="${todayStr()}">
      <label for="se-start">Hora de inicio</label><input type="time" id="se-start" value="17:30">
      <label for="se-end">Hora de fin</label><input type="time" id="se-end" value="19:00">
      <label for="se-title">Título</label><input type="text" id="se-title" placeholder="Estudio dirigido">
      <button class="btn block" data-action="save-session">Guardar sesión</button>
    </div>
    <div id="sessions-list" style="margin-top:12px"></div>`;
  $('sessions-list').innerHTML = snap.empty
    ? emptyBox('📅', 'Aún no hay sesiones programadas.')
    : snap.docs.map(d => {
      const s = d.data();
      return `<div class="card">
        <div class="row"><strong>${fmtDate(s.date)}</strong>
          <span class="meta">${esc(s.startTime || '')}–${esc(s.endTime || '')}</span></div>
        <p>${esc(s.title || 'Estudio dirigido')}</p></div>`;
    }).join('');
}
ACTIONS['toggle-session-form'] = () => $('session-form').classList.toggle('hidden');
ACTIONS['save-session'] = async () => {
  await addDoc(collection(db, 'sessions'), {
    date: $('se-date').value, startTime: $('se-start').value, endTime: $('se-end').value,
    title: $('se-title').value.trim() || 'Estudio dirigido',
    createdByUid: state.user.uid, createdAt: serverTimestamp(),
  });
  toast('Sesión guardada.');
  renderCalendar();
};

/* ---------------- Centro de notificaciones ---------------- */
// Contador de no leídas en la campana (tiempo real).
function subscribeNotifications() {
  if (state.unsubNotif) state.unsubNotif();
  state.unsubNotif = onSnapshot(
    query(collection(db, 'users', state.user.uid, 'notifications'), where('read', '==', false)),
    (snap) => {
      const badge = $('notif-badge');
      badge.textContent = snap.size;
      badge.classList.toggle('hidden', snap.size === 0);
    });
}

async function renderNotifications() {
  const c = $('notifications-content');
  const ps = pushStatus();
  const pushCard = `
    <div class="card" style="margin-bottom:12px">
      <div class="row">
        <div><strong>Notificaciones push</strong>
          <p class="muted" style="margin:4px 0 0">${
            ps === 'on' ? 'Activadas en este dispositivo. Recibirás avisos aunque la app esté cerrada.' :
            ps === 'blocked' ? 'Bloqueadas en tu navegador. Actívalas en los ajustes del sitio para recibirlas.' :
            ps === 'unsupported' ? 'Tu navegador no admite notificaciones push.' :
            'Desactivadas. Actívalas para recibir avisos aunque la app esté cerrada.'}</p>
        </div>
        ${ps === 'on'
          ? `<button class="btn small secondary" data-action="toggle-push">Desactivar</button>`
          : ps === 'off'
            ? `<button class="btn small" data-action="toggle-push">Activar</button>`
            : ''}
      </div>
    </div>`;
  const snap = await getDocs(query(collection(db, 'users', state.user.uid, 'notifications'),
    orderBy('createdAt', 'desc'), limit(50)));
  c.innerHTML = pushCard + `
    <div class="screen-head"><h2>Notificaciones</h2>
      ${snap.size ? `<button class="btn small secondary" data-action="read-all-notif">Marcar leídas</button>` : ''}
    </div><div id="notif-list"></div>`;
  $('notif-list').innerHTML = snap.empty
    ? emptyBox('🔔', 'No tienes notificaciones.')
    : snap.docs.map(d => {
      const n = d.data();
      return `<div class="card notif ${n.read ? 'read' : ''}" data-action="open-notif" data-id="${d.id}">
        <span class="dot"></span>
        <div><strong>${esc(n.title)}</strong>
          <p class="muted">${esc(n.body || '')}</p>
          <div class="meta">${tsToDate(n.createdAt)}</div></div>
      </div>`;
    }).join('');
}
ACTIONS['read-all-notif'] = async () => {
  const snap = await getDocs(query(collection(db, 'users', state.user.uid, 'notifications'),
    where('read', '==', false)));
  for (const d of snap.docs) await updateDoc(d.ref, { read: true });
  renderNotifications();
};
ACTIONS['open-notif'] = async (d) => {
  await updateDoc(doc(db, 'users', state.user.uid, 'notifications', d.id), { read: true });
  renderNotifications();
};

/* ---------------- Perfil y menú "Más" ---------------- */
async function renderProfile() {
  const kids = isFamilia() ? state.children : [];
  $('profile-content').innerHTML = `
    <h2>Mi perfil</h2>
    <div class="card">
      <div class="row"><strong>${esc(state.profile.displayName || 'Usuario')}</strong>
        <span class="tag pending">${ROLE_LABEL[state.role] || state.role}</span></div>
      <div class="meta">${esc(state.profile.email || '')}</div>
    </div>
    ${isFamilia() ? `<h3>Datos de mi hijo/a</h3>` + (kids.length
      ? kids.map(k => `<div class="card"><strong>${esc(k.firstName)} ${esc(k.lastName || '')}</strong>
          <div class="meta">Grupo: ${esc(k.group || '—')}</div></div>`).join('')
      : emptyBox('👧', 'Aún no hay alumnos vinculados a tu familia.')) : ''}
    <button class="btn danger block" data-action="sign-out">Cerrar sesión</button>`;
}
ACTIONS['sign-out'] = async () => { await signOut(auth); };

function renderMore() {
  const fam = !isMonitor();
  const items = [
    ...(fam ? [{ id: 'child', label: 'Mi hijo', icon: 'child' }] : []),
    { id: 'reports', label: 'Informes', icon: 'reports' },
    ...(fam ? [{ id: 'notices', label: 'Avisos', icon: 'notices' }] : []),
    { id: 'auths', label: 'Autorizaciones', icon: 'auths' },
    { id: 'calendar', label: 'Calendario', icon: 'calendar' },
    { id: 'notifications', label: 'Notificaciones', icon: 'notifications' },
    { id: 'profile', label: 'Mi perfil', icon: 'profile' },
  ];
  $('more-content').innerHTML = `
    <div class="section-head"><h3>Más</h3></div>
    <div class="card menu-list">` + items.map(i =>
      `<button class="menu-row" data-action="go" data-screen="${i.id}">
        <span><span class="ico">${NAV_ICONS[i.icon]}</span>${i.label}</span><b>›</b>
      </button>`).join('') + `</div>`;
}

/* ---------------- Push: registro del token y mensajes en 1er plano ---------------- */
async function initPush() {
  try {
    if (!await isSupported()) return;
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;
    await registerPushToken();
    // Con la app abierta, los push se muestran como aviso interno.
    const messaging = getMessaging(app);
    onMessage(messaging, (payload) => {
      toast('🔔 ' + ((payload.notification && payload.notification.title) || 'Nuevo aviso'));
    });
  } catch (err) {
    console.warn('Push no disponible:', err);
  }
}

// Obtiene el token FCM de este dispositivo y lo guarda para que el backend
// pueda enviarle push. Devuelve true si quedó registrado.
async function registerPushToken() {
  if (!vapidKey || vapidKey === 'TODO') {
    console.warn('Falta la clave VAPID: genera una en Firebase console (ver README, paso 5).');
    return false;
  }
  const messaging = getMessaging(app);
  const token = await getToken(messaging, { vapidKey });
  if (!token) return false;
  await setDoc(doc(db, 'users', state.user.uid, 'pushTokens', token), {
    token, platform: 'web', createdAt: serverTimestamp(),
  });
  state.pushToken = token;
  try { localStorage.setItem('gleraPushToken', token); } catch (e) {}
  return true;
}

// Elimina el token de este dispositivo (deja de recibir push aquí).
async function unregisterPushToken() {
  try {
    const token = state.pushToken || localStorage.getItem('gleraPushToken');
    if (token && state.user) {
      try { await deleteToken(getMessaging(app)); } catch (e) {}
      await deleteDoc(doc(db, 'users', state.user.uid, 'pushTokens', token));
    }
  } catch (err) {
    console.warn('No se pudo desactivar el push:', err);
  }
  state.pushToken = null;
  try { localStorage.removeItem('gleraPushToken'); } catch (e) {}
}

// Estado del push en este dispositivo: 'on' | 'off' | 'blocked' | 'unsupported'.
function pushStatus() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  let hasToken = state.pushToken;
  if (!hasToken) { try { hasToken = localStorage.getItem('gleraPushToken'); } catch (e) {} }
  if (Notification.permission === 'granted' && hasToken) return 'on';
  return 'off';
}

ACTIONS['toggle-push'] = async () => {
  const st = pushStatus();
  if (st === 'on') {
    await unregisterPushToken();
    toast('Notificaciones push desactivadas en este dispositivo.');
  } else if (st === 'off') {
    try {
      if (!await isSupported()) { toast('Tu navegador no admite notificaciones push.'); return; }
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        const ok = await registerPushToken();
        toast(ok ? 'Notificaciones push activadas.' : 'No se pudo activar el push en este dispositivo.');
      } else {
        toast('Permiso no concedido.');
      }
    } catch (err) {
      console.warn('Push no disponible:', err);
      toast('No se pudo activar el push en este dispositivo.');
    }
  }
  show('notifications');
};

/* ---------------- Usuarios (solo admin) ---------------- */
async function renderUsers() {
  if (!isAdmin()) { show('home'); return; }
  const c = $('users-content');
  const [usnap, ssnap] = await Promise.all([
    getDocs(query(collection(db, 'users'), orderBy('displayName'))),
    getDocs(query(collection(db, 'students'), orderBy('firstName'))),
  ]);
  const users = usnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const students = ssnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const familias = users.filter(u => u.role === 'familia');
  c.innerHTML = `
    <div class="section-head"><div><h3>Usuarios</h3>
      <p>Cambia el rol de cada usuario.</p></div>
      <span class="badge info">${users.length}</span></div>
    <div class="item-list">
      ${users.length ? users.map(u => `
        <div class="list-item">
          <span class="item-icon">👤</span>
          <div class="item-main">
            <h4>${esc(u.displayName || 'Sin nombre')}</h4>
            <p>${esc(u.email || '')}</p>
          </div>
          <div class="item-side">
            <select data-role-select="${u.id}" aria-label="Rol de ${esc(u.displayName || u.email || 'usuario')}">
              ${['admin', 'monitor', 'familia'].map(r =>
                `<option value="${r}" ${u.role === r ? 'selected' : ''}>${ROLE_LABEL[r]}</option>`).join('')}
            </select>
          </div>
        </div>`).join('')
      : emptyBox('👥', 'Aún no hay usuarios registrados.')}
    </div>
    <div class="section-head" style="margin-top:24px"><div><h3>Alumnos</h3>
      <p>Da de alta alumnos y vincúlalos a sus familias.</p></div></div>
    <div class="item-list">
      ${students.length ? students.map(s => `
        <div class="list-item">
          <span class="item-icon">🎒</span>
          <div class="item-main">
            <h4>${esc(s.firstName)} ${esc(s.lastName || '')}</h4>
            <p>${esc(s.group || 'Sin grupo')} · ${(s.familyUids || []).length} familia(s) vinculada(s)</p>
          </div>
          <div class="item-side">
            <button class="danger-btn" data-action="delete-student" data-id="${s.id}">Eliminar</button>
          </div>
        </div>`).join('')
      : emptyBox('🎒', 'Aún no hay alumnos dados de alta.')}
    </div>
    <div class="card" style="margin-top:16px">
      <div class="section-head"><h3>Nuevo alumno</h3></div>
      <label for="ns-first">Nombre</label>
      <input type="text" id="ns-first" maxlength="60" autocomplete="off">
      <label for="ns-last">Apellidos</label>
      <input type="text" id="ns-last" maxlength="80" autocomplete="off">
      <label for="ns-group">Grupo</label>
      <input type="text" id="ns-group" maxlength="40" placeholder="Ej.: Grupo A" autocomplete="off">
      <label>Familias vinculadas</label>
      ${familias.length ? familias.map(f => `
        <label class="check"><input type="checkbox" data-family-check value="${f.id}">
          ${esc(f.displayName || f.email || 'Sin nombre')}</label>`).join('')
        : '<p class="muted">No hay usuarios con rol de familia todavía.</p>'}
      <button class="btn block" data-action="create-student">Guardar alumno</button>
    </div>`;
  c.querySelectorAll('[data-role-select]').forEach(sel => {
    sel.addEventListener('change', async () => {
      try {
        const uid = sel.dataset.roleSelect;
        await updateDoc(doc(db, 'users', uid), { role: sel.value });
        if (uid === state.user.uid) {
          state.role = sel.value;
          state.profile.role = sel.value;
          renderNav();
        }
        toast('Rol actualizado.');
      } catch (err) {
        console.error(err);
        toast('No se pudo cambiar el rol.');
      }
    });
  });
}
ACTIONS['delete-student'] = async (d) => {
  if (!confirm('¿Eliminar este alumno? Se borrará su ficha.')) return;
  try {
    await deleteDoc(doc(db, 'students', d.id));
    toast('Alumno eliminado.');
    renderUsers();
  } catch (err) {
    console.error(err);
    toast('No se pudo eliminar el alumno.');
  }
};
ACTIONS['create-student'] = async () => {
  const firstName = $('ns-first').value.trim();
  if (!firstName) { toast('Escribe al menos el nombre del alumno.'); return; }
  const familyUids = [...document.querySelectorAll('[data-family-check]:checked')].map(x => x.value);
  try {
    await addDoc(collection(db, 'students'), {
      firstName,
      lastName: $('ns-last').value.trim(),
      group: $('ns-group').value.trim(),
      familyUids,
      createdAt: serverTimestamp(),
    });
    toast('Alumno dado de alta.');
    renderUsers();
  } catch (err) {
    console.error(err);
    toast('No se pudo guardar el alumno.');
  }
};

/* ---------------- Registro de pantallas (parte 2) y arranque ---------------- */
Object.assign(RENDER, {
  reports: renderReports,
  reportCompose: renderReportCompose,
  chatList: renderChatList,
  auths: renderAuths,
  authCompose: renderAuthCompose,
  noticeCompose: renderNoticeCompose,
  calendar: renderCalendar,
  notifications: renderNotifications,
  profile: renderProfile,
  more: renderMore,
  users: renderUsers,
  child: renderChild,
  notices: renderNotices,
});

// Arranque: si hay configuración válida, se vigila la sesión; si no, se avisa en el login.
if (initFirebase()) {
  watchAuth();
} else {
  setLoggedOut(true);
}
