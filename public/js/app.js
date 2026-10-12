// ============================================================
// App Studio sistema — MVP
// Lógica principal: Firebase Auth (Google), Firestore y Cloud Messaging.
// Todo el texto de la interfaz está en español.
// ============================================================

import { firebaseConfig, vapidKey } from './firebase-config.js';
import { initializeApp } from 'firebase/app';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from 'firebase/auth';
import {
  getFirestore, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, deleteField,
  collection, query, where, orderBy, limit, getDocs,
  onSnapshot, serverTimestamp, arrayUnion
} from 'firebase/firestore';
import { getMessaging, getToken, deleteToken, onMessage, isSupported } from 'firebase/messaging';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';

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
  editingStudentId: null, // alumno en edición en la pantalla Usuarios (null = crear nuevo)
  unsubChat: null,
  unsubNotif: null,
};

const isMonitor = () => state.role === 'monitor' || state.role === 'admin';
const isAdmin = () => state.role === 'admin';
const isFamilia = () => state.role === 'familia';
const ROLE_LABEL = { admin: 'Administrador', monitor: 'Profesor/a', familia: 'Familia' };
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
const DIAS_LARGO = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const DIAS_CORTO = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const fmtDateLong = (iso) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const wd = DIAS_LARGO[new Date(y, m - 1, d).getDay()];
  return `${wd[0].toUpperCase() + wd.slice(1)} ${d} de ${MESES_LARGO[m - 1]}`;
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
      ...(isMonitor() ? [{ id: 'users', label: 'Usuarios', icon: 'users' }] : []),
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
const noticeCard = (n, nFamilies = 0) => {
  const read = (n.readBy || []).includes(state.user.uid);
  const fam = !isMonitor();
  const nRead = (n.readBy || []).length;
  return `
  <article class="card notice-card ${n.pinned ? 'pinned' : ''}">
    ${!read && fam ? '<span class="unread-dot"></span>' : ''}
    <span class="notif-ico">🔔</span>
    <div class="notif-main">
      <div class="notif-tags">
        ${n.pinned ? '<span class="tag tag-unread">Fijado</span>' : ''}
        ${n.tag ? `<span class="tag tag-unread">${esc(n.tag)}</span>` : ''}
      </div>
      <h4>${esc(n.title)}</h4>
      <p class="muted">${esc(n.body)}</p>
      <div class="meta">${tsToDate(n.createdAt)} · Equipo de Studio sistema</div>
      ${isMonitor() ? `<div class="row" style="justify-content:flex-start;margin-top:10px">
        <button class="text-btn" data-action="edit-notice" data-id="${n.id}">✏️ Editar</button>
        <button class="text-btn" data-action="delete-notice" data-id="${n.id}" style="color:var(--danger)">🗑️ Eliminar</button>
      </div>` : ''}
    </div>
    ${fam ? `<div class="notice-side">
      ${read
        ? '<span class="tag tag-read">Leído</span>'
        : `<button class="btn small" data-action="confirm-notice-read" data-id="${n.id}">Confirmar lectura</button>`}
      <button class="text-btn" data-action="contact-monitor">Responder</button>
    </div>` : (nFamilies ? `<div class="notice-side">
      <span class="tag ${nRead >= nFamilies && nFamilies ? 'tag-read' : 'tag-unread'}">${nRead}/${nFamilies} leídos</span>
    </div>` : '')}
  </article>`;
};

// Pantalla "Avisos": el tablón completo.
async function renderNotices() {
  const c = $('notices-content');
  const snap = await getDocs(query(collection(db, 'notices'), orderBy('createdAt', 'desc'), limit(30)));
  let notices = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  notices.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  const f = state.noticeFilter || 'all';
  if (f === 'unread') notices = notices.filter(n => !(n.readBy || []).includes(state.user.uid));
  if (f === 'pinned') notices = notices.filter(n => n.pinned);
  // Cuenta familias para el "X/Y leídos".
  let nFamilies = 0;
  if (isMonitor()) {
    try {
      const usnap = await getDocs(query(collection(db, 'users'), where('role', '==', 'familia'), limit(100)));
      nFamilies = usnap.size;
    } catch (e) {}
  }
  c.innerHTML = `
    <div class="screen-head"><h2>Avisos</h2></div>
    ${isMonitor() ? `
    <div class="card">
      <div class="section-head"><div>
        <h3>Publicar en el tablón</h3>
        <p class="muted">Las familias lo verán al entrar y recibirán una notificación.</p>
      </div><span class="badge info">Nuevo aviso</span></div>
      <label for="nc-title">Título</label>
      <input type="text" id="nc-title" maxlength="120" placeholder="Ej.: Cambio de aula">
      <label for="nc-body">Texto del aviso</label>
      <textarea id="nc-body" placeholder="Escribe la información para las familias"></textarea>
      <div class="grid"><div class="col-6">
        <label for="nc-date">Fecha</label>
        <input type="date" id="nc-date" value="${todayStr()}">
      </div><div class="col-6">
        <label for="nc-vis">Visibilidad</label>
        <select id="nc-vis">
          <option value="normal">Aviso normal</option>
          <option value="pinned">Fijado en el tablón</option>
          <option value="important">Importante</option>
        </select>
      </div></div>
      <button class="btn block" data-action="publish-notice-inline" style="margin-top:12px">Publicar en el tablón y avisar</button>
    </div>
    <div class="section-head" style="margin-top:16px"><div>
      <h3>Avisos publicados</h3>
      <p class="muted">Consulta la lectura de cada aviso.</p>
    </div></div>` : `
    <div class="filters">
      <button class="filter ${f === 'all' ? 'active' : ''}" data-action="notice-filter" data-f="all">Todos</button>
      <button class="filter ${f === 'unread' ? 'active' : ''}" data-action="notice-filter" data-f="unread">Sin leer</button>
      <button class="filter ${f === 'pinned' ? 'active' : ''}" data-action="notice-filter" data-f="pinned">Fijados</button>
    </div>
    <div class="section-head" style="margin-top:16px"><div>
      <h3>Tablón de anuncios</h3>
      <p class="muted">Los avisos nuevos y fijados aparecen destacados.</p>
    </div></div>`}
    <div class="grid"><div class="col-12">
      ${notices.length ? notices.map(n => noticeCard(n, nFamilies)).join('') : emptyBox('📋', 'No hay avisos.')}
    </div></div>`;
}
ACTIONS['notice-filter'] = (d) => { state.noticeFilter = d.f; renderNotices(); };
ACTIONS['publish-notice-inline'] = async () => {
  const title = $('nc-title').value.trim();
  const body = $('nc-body').value.trim();
  if (!title || !body) { toast('Escribe un título y un texto.'); return; }
  const vis = $('nc-vis').value;
  await addDoc(collection(db, 'notices'), {
    title, body,
    pinned: vis === 'pinned',
    tag: vis === 'important' ? 'Importante' : null,
    createdByUid: state.user.uid, createdAt: serverTimestamp(),
  });
  toast('Aviso publicado. Las familias recibirán un aviso.');
  renderNotices();
};
ACTIONS['confirm-notice-read'] = async (d) => {
  try {
    await updateDoc(doc(db, 'notices', d.id), { readBy: arrayUnion(state.user.uid) });
    toast('Lectura confirmada.');
  } catch (err) {
    console.error(err);
    toast('No se pudo confirmar.');
  }
  renderNotices();
};

async function renderHome() {
  const c = $('home-content');
  try {
  const fam = !isMonitor();
  const nombre = (state.profile.displayName || '').split(' ')[0] || (fam ? 'familia' : 'monitor');
  const child = fam ? (state.children.find(x => x.id === state.selectedChildId) || state.children[0]) : null;
  const subtitulo = fam
    ? (child ? `Este es el resumen de ${esc(child.firstName)} para hoy.` : 'Bienvenido/a a Studio sistema.')
    : `${state.students.length} alumno(s) en la actividad.`;

  // Último aviso del tablón (fijados primero, como en la lista).
  let latest = null;
  try {
    const nsnap = await getDocs(query(collection(db, 'notices'), orderBy('createdAt', 'desc'), limit(30)));
    const notices = nsnap.docs.map(d => ({ id: d.id, ...d.data() }));
    notices.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
    latest = notices[0] || null;
  } catch (err) { console.error('Inicio: no se pudieron cargar los avisos.', err); }

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
    try {
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
    } catch (err) { console.error('Inicio: no se pudieron cargar las métricas.', err); }
  } else if (!fam) {
    try {
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
    } catch (err) { console.error('Inicio: no se pudieron cargar las métricas.', err); }
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
          <div class="notice-meta"><span>Equipo de Studio sistema</span><span>•</span><span>${tsToDate(latest.createdAt)}</span></div>
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
  } catch (err) {
    console.error('Error crítico en Inicio:', err);
    c.innerHTML = `
      <div class="card" style="text-align:center;padding:32px 16px">
        <p style="font-size:40px;margin:0">😕</p>
        <h3>No se pudo cargar el inicio</h3>
        <p class="muted">Ha ocurrido un error inesperado.</p>
        <button class="btn" data-action="go" data-screen="home">Reintentar</button>
      </div>`;
  }
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
    const today = todayStr();
    const [y, m, d] = today.split('-').map(Number);
    const wd = DIAS_LARGO[new Date(y, m - 1, d).getDay()];
    c.innerHTML = `
      <div class="screen-head"><h2>Pasar lista</h2></div>
      <div class="section-head"><div>
        <h3>Sesión de hoy</h3>
        <p class="muted">${wd[0].toUpperCase() + wd.slice(1)} ${d} · ${fmtDate(today)}</p>
      </div><span class="tag tag-info">Hoy</span></div>
      <label for="att-date">Fecha</label>
      <input type="date" id="att-date" value="${today}">
      <div class="card" style="margin-top:12px"><div id="att-rows"></div>
        <div class="cal-legend" style="justify-content:flex-start;margin:12px 0">
          <span><i class="cal-dot presente"></i>Presente</span>
          <span><i class="cal-dot ausente"></i>Ausente</span>
          <span><i class="cal-dot justificado"></i>Justificado</span>
        </div>
        <button class="btn block" data-action="save-attendance">Guardar lista de hoy</button>
      </div>
      <div class="section-head" style="margin-top:16px"><h3>Historial por alumno</h3></div>
      <div class="card">
        <label for="att-hist-student">Alumno/a</label>
        <select id="att-hist-student">${state.students.map(s =>
          `<option value="${s.id}">${esc(s.firstName)} ${esc(s.lastName || '')}</option>`).join('')}</select>
        <div id="att-hist-list" style="margin-top:12px"></div>
      </div>`;
    $('att-date').addEventListener('change', (e) => loadAttendanceRows(e.target.value));
    await loadAttendanceRows($('att-date').value);
    const hsel = $('att-hist-student');
    const loadHist = async () => {
      const box = $('att-hist-list');
      const snap = await getDocs(query(collection(db, 'attendance'),
        where('studentId', '==', hsel.value), orderBy('date', 'desc'), limit(20)));
      const label = { presente: 'Presente', ausente: 'Ausente', justificado: 'Justificado' };
      box.innerHTML = snap.empty ? emptyBox('✅', 'Sin registros.') :
        snap.docs.map(dd => {
          const a = dd.data();
          return `<div class="history-line">
            <div><strong>${fmtDateLong(a.date)}</strong></div>
            <span class="tag ${a.status}">${label[a.status] || a.status}</span>
          </div>`;
        }).join('');
    };
    hsel.addEventListener('change', loadHist);
    await loadHist();
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
    return `<div class="att-row">
      <span class="avatar-sm">${esc(initialsOf(s.firstName + ' ' + (s.lastName || '')))}</span>
      <div style="flex:1"><strong>${esc(s.firstName)} ${esc(s.lastName || '')}</strong>
        <div class="meta">${esc(s.group || '')}</div></div>
      <div class="seg seg-att">
        <button data-action="att-mark" data-student="${s.id}" data-status="presente" class="${cur === 'presente' ? 'on' : ''}">Presente</button>
        <button data-action="att-mark" data-student="${s.id}" data-status="ausente" class="${cur === 'ausente' ? 'on no' : ''}">Ausente</button>
        <button data-action="att-mark" data-student="${s.id}" data-status="justificado" class="${cur === 'justificado' ? 'on maybe' : ''}">Justificado</button>
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
  const child = state.children.find(x => x.id === state.selectedChildId) || state.children[0];
  const ym = state.attMonth || todayStr().slice(0, 7);
  const [y, m] = ym.split('-').map(Number);
  const snap = await getDocs(query(collection(db, 'attendance'),
    where('studentId', '==', state.selectedChildId), orderBy('date', 'desc'), limit(120)));
  const byDate = {};
  snap.docs.forEach(d => {
    const a = d.data();
    if (a.date && a.date.slice(0, 7) === ym) byDate[a.date] = a.status;
  });
  const dates = Object.keys(byDate).sort();
  const nPres = dates.filter(d => byDate[d] === 'presente').length;
  const nAus = dates.filter(d => byDate[d] === 'ausente').length;
  const nJus = dates.filter(d => byDate[d] === 'justificado').length;
  const total = dates.length;
  const pct = total ? Math.round(nPres / total * 100) : 0;

  // Calendario del mes.
  const first = new Date(y, m - 1, 1);
  const startDay = (first.getDay() + 6) % 7; // lunes = 0
  const daysInMonth = new Date(y, m, 0).getDate();
  const prevDays = new Date(y, m - 1, 0).getDate();
  let cells = '';
  for (let i = startDay - 1; i >= 0; i--) {
    cells += `<span class="cal-day other">${prevDays - i}</span>`;
  }
  const today = todayStr();
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${ym}-${String(d).padStart(2, '0')}`;
    const st = byDate[ds];
    const isToday = ds === today;
    cells += `<span class="cal-day ${isToday ? 'today' : ''}">${d}${st ? `<i class="cal-dot ${st}"></i>` : ''}</span>`;
  }
  const endFill = (7 - ((startDay + daysInMonth) % 7)) % 7;
  for (let d = 1; d <= endFill; d++) cells += `<span class="cal-day other">${d}</span>`;

  const statusLabel = { presente: 'Presente', ausente: 'Ausente', justificado: 'Justificado' };
  box.innerHTML = `
  <div class="grid">
    <div class="col-7">
      <div class="card">
        <div class="cal-head">
          <button class="expand-btn" data-action="att-month" data-dir="-1" aria-label="Mes anterior">‹</button>
          <h3 style="margin:0">${MESES_LARGO[m - 1][0].toUpperCase() + MESES_LARGO[m - 1].slice(1)} ${y}</h3>
          <button class="expand-btn" data-action="att-month" data-dir="1" aria-label="Mes siguiente">›</button>
        </div>
        <div class="cal-grid">
          ${['L', 'M', 'X', 'J', 'V', 'S', 'D'].map(w => `<span class="cal-wd">${w}</span>`).join('')}
          ${cells}
        </div>
        <div class="cal-legend">
          <span><i class="cal-dot presente"></i>Presente</span>
          <span><i class="cal-dot ausente"></i>Ausente</span>
          <span><i class="cal-dot justificado"></i>Justificado</span>
        </div>
      </div>
      <div class="card" style="margin-top:16px">
        <h3>Historial de ${esc(child.firstName)}</h3>
        ${dates.length ? [...dates].reverse().map(ds => `
          <div class="history-line">
            <div><strong>${fmtDateLong(ds)}</strong></div>
            <span class="tag ${byDate[ds]}">${statusLabel[byDate[ds]]}</span>
          </div>`).join('')
        : emptyBox('✅', 'Aún no hay registros de asistencia.')}
      </div>
    </div>
    <div class="col-5">
      <div class="card att-summary">
        <div class="row" style="justify-content:space-between"><span style="font-size:28px">👤✓</span><small class="muted">${MESES_LARGO[m - 1][0].toUpperCase() + MESES_LARGO[m - 1].slice(1)}</small></div>
        <div class="att-pct">${pct}%</div>
        <p class="muted" style="margin:0">${nPres} de ${total} sesiones</p>
      </div>
      <div class="card" style="margin-top:16px">
        <h3>Resumen</h3>
        <div class="history-line"><span>Presente</span><b style="color:var(--brand)">${nPres}</b></div>
        <div class="history-line"><span>Ausencia justificada</span><b style="color:var(--accent)">${nJus}</b></div>
        <div class="history-line"><span>Ausente</span><b style="color:var(--danger)">${nAus}</b></div>
      </div>
    </div>
  </div>`;
}
ACTIONS['att-month'] = (d) => {
  const ym = state.attMonth || todayStr().slice(0, 7);
  let [y, m] = ym.split('-').map(Number);
  m += parseInt(d.dir, 10);
  if (m < 1) { m = 12; y--; }
  if (m > 12) { m = 1; y++; }
  state.attMonth = `${y}-${String(m).padStart(2, '0')}`;
  loadAttendanceHistory();
};

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
  const today = todayStr();
  // Progreso: evaluaciones compartidas hoy vs total alumnos.
  let nDone = 0;
  try {
    const esnap = await getDocs(query(collection(db, 'evaluations'), where('date', '==', today), limit(100)));
    nDone = esnap.size;
  } catch (e) {}
  const total = state.students.length;
  const pct = total ? Math.round(nDone / total * 100) : 0;
  const selStudent = state.students[0];
  c.innerHTML = `
    <div class="section-head"><h2>Evaluación diaria</h2>
      <button class="icon-btn" data-action="go" data-screen="evalItems" aria-label="Configurar ítems de evaluación">⚙️</button>
    </div>
    ${items.length ? `
    <div class="card">
      <div class="row" style="align-items:center;margin-bottom:16px">
        <span class="avatar-sm" style="width:48px;height:48px">${esc(initialsOf(selStudent.firstName + ' ' + (selStudent.lastName || '')))}</span>
        <div style="flex:1"><strong>${esc(selStudent.firstName)} ${esc(selStudent.lastName || '')}</strong>
          <div class="meta">Valoración de hoy · ${fmtDate(today)}</div></div>
        <select id="ev-student" style="width:auto;flex:0 0 auto" aria-label="Alumno">${state.students.map(s =>
          `<option value="${s.id}">${esc(s.firstName)} ${esc(s.lastName || '')}</option>`).join('')}</select>
      </div>
      <input type="hidden" id="ev-date" value="${today}">
      ${items.map(it => `
        <div class="eval-row">
          <span class="eval-label">${esc(it.label)}</span>
          <div class="seg seg-nums">
            <button data-action="ev-mark" data-crit="${it.id}" data-val="1">1</button>
            <button data-action="ev-mark" data-crit="${it.id}" data-val="2" class="on">2</button>
            <button data-action="ev-mark" data-crit="${it.id}" data-val="3">3</button>
          </div>
        </div>`).join('')}
      <div class="meta" style="margin:8px 0">1 Necesita mejorar · 2 Adecuado · 3 Muy bien</div>
      <label for="ev-comment" style="margin-top:12px">Nota breve para la familia (opcional)</label>
      <textarea id="ev-comment" placeholder="Nota breve para la familia (opcional)"></textarea>
      <button class="btn block" data-action="save-evaluation" style="margin-top:12px">Compartir valoración con la familia</button>
    </div>
    <div class="card" style="margin-top:16px">
      <div class="row"><h3 style="margin:0">Progreso de la sesión</h3>
        <span class="tag">${nDone} de ${total} compartidas</span></div>
      <div class="progress"><div class="progress-bar" style="width:${pct}%"></div></div>
    </div>`
    : emptyBox('⚙️', 'No hay ítems de evaluación activos. Configúralos con el botón ⚙️.')}`;
  const sel = $('ev-student');
  if (sel) sel.addEventListener('change', () => {
    // Recarga para mostrar el alumno seleccionado en la cabecera.
    renderEvaluate();
    // Restaura la selección.
    const s2 = $('ev-student');
    if (s2) s2.value = sel.value;
  });
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
        <p class="muted" style="margin:4px 0 0">Studio sistema · Curso 2026–2027</p>
      </div>
      <button class="btn secondary" data-action="contact-monitor">Escribir al profesor</button>
    </div>
    ${state.children.length > 1 ? `<div class="card" style="margin-top:12px">${childSelectHTML('child-sel')}</div>` : ''}
    <div class="grid" style="margin-top:12px">
      <div class="card col-7">
        <div class="section-head"><h3>Datos de la actividad</h3></div>
        <div class="detail-grid">
          <div class="detail-row"><span>Profesor responsable</span><b>${esc(child.monitorName || '—')}</b></div>
          <div class="detail-row"><span>Grupo</span><b>${esc(child.group || '—')}</b></div>
          <div class="detail-row"><span>Horario habitual</span><b>${esc(child.schedule || '—')}</b></div>
          <div class="detail-row"><span>Aula habitual</span><b>${esc(child.classroom || '—')}</b></div>
          <div class="detail-row"><span>Inicio</span><b>${child.startDate ? fmtDate(child.startDate) : '—'}</b></div>
          <div class="detail-row"><span>Recogida</span><b>${esc(child.pickup || '—')}</b></div>
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
    let nDiario = 0, nMensual = 0, nLeidos = 0;
    const monthlyDone = new Set();
    msnap.docs.forEach(d => {
      const r = d.data();
      let rym = '';
      try { rym = r.createdAt.toDate().toISOString().slice(0, 7); } catch { /* sin fecha */ }
      if (rym === ym) {
        if (reportType(r) === 'mensual') { nMensual++; monthlyDone.add(r.studentId); }
        else nDiario++;
        if ((r.readBy || []).length) nLeidos++;
      }
    });
    const nPendientes = Math.max(0, state.students.length - monthlyDone.size);
    const last = msnap.docs[0];
    const lastR = last ? last.data() : null;
    const lastStudent = lastR ? state.students.find(s => s.id === lastR.studentId) : null;
    c.innerHTML = `
      <div class="screen-head"><h2>Informes</h2></div>
      <div class="grid">
        <div class="col-7"><div class="card">
          <div class="section-head"><div>
            <h3>Preparar informe</h3>
            <p class="muted">Elige el tipo de seguimiento que verá la familia.</p>
          </div><span class="badge info">Borrador</span></div>
          <div class="report-form">
            <label for="rp-student">Alumno</label>
            <select id="rp-student">${state.students.map(s =>
              `<option value="${s.id}">${esc(s.firstName)} ${esc(s.lastName || '')}</option>`).join('')}</select>
            <label for="rp-type">Tipo de informe</label>
            <select id="rp-type">
              <option value="diario">Informe diario</option>
              <option value="mensual">Informe mensual</option>
            </select>
            <label for="rp-month">Mes</label>
            <input type="month" id="rp-month" value="${todayStr().slice(0, 7)}">
            <label for="rp-title">Resumen</label>
            <input type="text" id="rp-title" maxlength="120" placeholder="Ej.: Buen aprovechamiento de la tarde">
            <label for="rp-body">Valoración para la familia</label>
            <textarea id="rp-body" placeholder="Cómo ha ido la sesión, qué reforzar…"></textarea>
            <div id="rp-attach-wrap">
              <label for="rp-attach">Documento adjunto (Word o PDF, solo informe mensual)</label>
              <input type="file" id="rp-attach" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document">
              <p class="meta">Opcional. Máx. 10 MB.</p>
            </div>
            <div class="row" style="margin-top:12px;gap:8px">
              <button class="btn secondary" data-action="preview-report" style="flex:1">Previsualizar</button>
              <button class="btn" data-action="publish-report2" style="flex:1">Publicar y avisar</button>
            </div>
            <p class="meta" style="margin-top:8px">Al publicar, la familia recibe un aviso automáticamente.</p>
          </div>
        </div></div>
        <div class="col-5">
          <div class="card">
            <div class="section-head"><h3>Estado del mes</h3><span class="tag">${fmtMonth(ym).split(' de ')[0]}</span></div>
            <div class="history-line"><span>Informes diarios enviados</span><b>${nDiario}</b></div>
            <div class="history-line"><span>Mensuales pendientes</span><b style="color:var(--accent)">${nPendientes}</b></div>
            <div class="history-line"><span>Leídos por familias</span><b style="color:var(--brand)">${nLeidos}</b></div>
          </div>
          ${lastR ? `<div class="card" style="margin-top:16px">
            <h3>Último informe</h3>
            <p class="muted">${esc(lastStudent ? `${lastStudent.firstName} ${lastStudent.lastName || ''}`.trim() : '')} · ${reportType(lastR) === 'mensual' ? 'Mensual' : 'Diario'} · ${tsToDate(lastR.createdAt)}</p>
            <button class="text-btn" data-action="open-report" data-id="${last.id}">Abrir vista previa →</button>
          </div>` : ''}
        </div>
      </div>
      <div class="section-head" style="margin-top:8px"><h3>Enviados</h3></div>
      <div id="reports-list"></div>`;
    $('reports-list').innerHTML = msnap.empty
      ? emptyBox('📄', 'Aún no hay informes.')
      : msnap.docs.map(d => reportCard(d.id, d.data())).join('');
    // El adjunto solo se muestra para informes mensuales.
    const typeSel = $('rp-type'), attachWrap = $('rp-attach-wrap');
    const toggleAttach = () => { attachWrap.style.display = typeSel.value === 'mensual' ? '' : 'none'; };
    typeSel.addEventListener('change', toggleAttach);
    toggleAttach();
  } else {
    if (!state.children.length) {
      c.innerHTML = `<h2>Informes</h2>` + emptyBox('📄', 'Aún no hay alumnos vinculados a tu familia.');
      return;
    }
    const child = state.children.find(x => x.id === state.selectedChildId) || state.children[0];
    const f = state.reportFilter || 'all';
    c.innerHTML = `
      <div class="screen-head"><div>
        <h2>Informes de ${esc(child.firstName)}</h2>
        <p class="muted">Consulta el seguimiento diario y los informes mensuales enviados por el profesor.</p>
      </div></div>
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
  // Contador de guardados.
  const head = box.parentElement && box.parentElement.querySelector('.screen-head');
  if (head && !head.querySelector('.save-count')) {
    const b = document.createElement('span');
    b.className = 'badge info save-count';
    head.appendChild(b);
  }
  const badge = box.parentElement && box.parentElement.querySelector('.save-count');
  if (badge) badge.textContent = `${docs.length} guardado${docs.length === 1 ? '' : 's'}`;
  box.innerHTML = docs.length
    ? docs.map(d => reportCardExpand(d.id, d.data())).join('')
    : emptyBox('📄', f === 'all' ? 'Aún no hay informes.' : 'No hay informes de este tipo.');
}

const reportDateBlock = (r) => {
  let day = '—', mon = '';
  try {
    const dt = r.createdAt.toDate();
    day = String(dt.getDate()).padStart(2, '0');
    mon = MESES_CORTO[dt.getMonth()].toUpperCase();
  } catch { /* sin fecha */ }
  return `<span class="date-block"><b>${day}</b><small>${mon}</small></span>`;
};

const reportAttachmentHTML = (r) => r.attachmentUrl ? `
  <a class="attach-link" href="${esc(r.attachmentUrl)}" target="_blank" rel="noopener">
    📎 ${esc(r.attachmentName || 'Documento adjunto')}
  </a>` : '';

const reportCardExpand = (id, r) => {
  const tipo = reportType(r);
  const open = state.openReportId === id;
  return `
  <article class="card report-card">
    <div class="report-head" data-action="toggle-report" data-id="${id}">
      ${reportDateBlock(r)}
      <div class="report-main">
        <span class="tag ${tipo === 'mensual' ? 'tag-info' : 'tag-diario'}">${tipo === 'mensual' ? 'Mensual' : 'Diario'}</span>
        <h4>${esc(r.title)}</h4>
      </div>
      <button class="expand-btn" aria-label="${open ? 'Contraer' : 'Expandir'}">${open ? '–' : '+'}</button>
    </div>
    ${open ? `
    <div class="report-body">
      <h5>Resumen</h5>
      <p style="white-space:pre-wrap">${esc(r.body)}</p>
      ${reportAttachmentHTML(r)}
      <div class="meta">Enviado ${tsToDate(r.createdAt)}</div>
      <button class="text-btn" data-action="contact-monitor" style="margin-top:8px">Responder al profesor →</button>
    </div>` : ''}
  </article>`;
};

ACTIONS['toggle-report'] = async (d) => {
  const willOpen = state.openReportId !== d.id;
  state.openReportId = willOpen ? d.id : null;
  // Al abrirlo, la familia lo marca como leído.
  if (willOpen && !isMonitor()) {
    try { await updateDoc(doc(db, 'reports', d.id), { readBy: arrayUnion(state.user.uid) }); }
    catch (e) { /* sin permiso o ya leído */ }
  }
  loadReports();
};

function showReportDetail(r) {
  const dateStr = r._preview ? 'Ahora mismo' : tsToDate(r.createdAt);
  $('report-detail-content').innerHTML = `
    <button class="back" data-action="go" data-screen="reports">‹ Informes</button>
    ${r._preview ? '<div><span class="badge info">Vista previa · aún no publicado</span></div>' : ''}
    <h2 style="margin-top:10px">${esc(r.title)}</h2>
    <div class="meta">${r.type ? `<span class="tag">${r.type === 'mensual' ? 'Mensual' : 'Diario'}</span> ` : ''}${r.month ? fmtMonth(r.month) + ' · ' : ''}${dateStr}</div>
    <div class="card" style="margin-top:12px"><p style="white-space:pre-wrap">${esc(r.body)}</p>
      ${reportAttachmentHTML(r)}</div>`;
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
  const type = $('rp-type').value;
  // Sube el adjunto si lo hay (solo mensual).
  let attachmentUrl = null, attachmentName = null;
  const fileInput = $('rp-attach');
  if (type === 'mensual' && fileInput && fileInput.files.length) {
    const file = fileInput.files[0];
    if (file.size > 10 * 1024 * 1024) { toast('El archivo supera los 10 MB.'); return; }
    try {
      toast('Subiendo documento…');
      const storage = getStorage(app);
      const path = `shared/reports/${studentId}_${Date.now()}_${file.name}`;
      const snap = await uploadBytes(storageRef(storage, path), file);
      attachmentUrl = await getDownloadURL(snap.ref);
      attachmentName = file.name;
    } catch (err) {
      console.error(err);
      toast('No se pudo subir el documento.');
      return;
    }
  }
  await addDoc(collection(db, 'reports'), {
    studentId, title, body,
    type,
    month: $('rp-month').value || null,
    attachmentUrl, attachmentName,
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
  state.conversations = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  c.innerHTML = `
    <div class="screen-head"><h2>Chat</h2>
      ${isMonitor() ? `<button class="btn small" data-action="new-conversation">+ Nueva</button>` : ''}
    </div>
    <div class="chat-layout">
      <div class="chat-sidebar">
        <input type="search" id="conv-search" placeholder="Buscar conversación" autocomplete="off">
        <div id="conv-list"></div>
      </div>
      <div class="chat-main" id="chat-main">
        ${emptyBox('💬', 'Elige una conversación para empezar.')}
      </div>
    </div>`;
  const renderList = (filter = '') => {
    const box = $('conv-list');
    const items = state.conversations.filter(v =>
      ((v.title || v.studentName) || 'Conversación').toLowerCase().includes(filter.toLowerCase()));
    box.innerHTML = items.length ? items.map(v => {
      const name = v.title || v.studentName || 'Conversación';
      return `
      <div class="conv-item ${state.currentConvId === v.id ? 'active' : ''}" data-action="open-chat" data-id="${v.id}">
        <span class="avatar-sm">${esc(initialsOf(name))}</span>
        <div class="conv-main">
          <div class="row"><strong>${esc(name)}</strong>
            <span class="meta">${v.updatedAt ? tsToDate(v.updatedAt) : ''}</span></div>
          <p class="muted">${esc(v.lastMessageText || 'Sin mensajes todavía.')}</p>
        </div>
        ${isMonitor() ? `<button class="text-btn" data-action="delete-conversation" data-id="${v.id}" style="color:var(--danger)" aria-label="Eliminar chat">🗑️</button>` : ''}
      </div>`;
    }).join('')
      : emptyBox('💬', 'Aún no hay conversaciones.');
  };
  renderList();
  $('conv-search').addEventListener('input', (e) => renderList(e.target.value));
  // En escritorio, reabre la conversación activa.
  if (state.currentConvId && window.innerWidth > 900) openChat(state.currentConvId, true);
}

// El monitor/admin elige: chat sobre un alumno o chat directo con monitor/admin.
ACTIONS['new-conversation'] = async () => {
  const box = $('conv-list');
  const opts = state.students.filter(s => (s.familyUids || []).length);
  let people = [];
  try {
    const role = isAdmin() ? 'monitor' : 'admin';
    const usnap = await getDocs(query(collection(db, 'users'), where('role', '==', role), limit(20)));
    people = usnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(u => u.id !== state.user.uid);
  } catch (e) { console.error(e); }
  const peopleLabel = isAdmin() ? 'Profesor/a' : 'Administrador';
  box.innerHTML = `<div class="card">
    <label>Chat directo con</label>
    ${people.length ? `
      <select id="ncv-person">
        ${people.map(p => `<option value="${p.id}">${esc(p.displayName || p.email || 'Usuario')}</option>`).join('')}
      </select>
      <button class="btn block" data-action="create-direct-conversation" style="margin-top:8px">Abrir chat directo</button>
      <hr style="margin:16px 0;border:none;border-top:1px solid var(--line)">`
    : `<p class="muted">No hay ${peopleLabel.toLowerCase()}s dados de alta.</p>`}
    <label for="ncv-student">Chat sobre alumno/a (con sus familias)</label>
    ${opts.length ? `
      <select id="ncv-student">${opts.map(s =>
        `<option value="${s.id}">${esc(s.firstName)} ${esc(s.lastName || '')}</option>`).join('')}</select>
      <button class="btn block" data-action="create-conversation" style="margin-top:8px">Abrir conversación</button>`
    : `<p class="muted">Ningún alumno tiene familias vinculadas todavía.</p>`}
    <button class="btn secondary block" data-action="go" data-screen="chatList" style="margin-top:8px">Cancelar</button>
  </div>`;
};
ACTIONS['create-direct-conversation'] = async () => {
  const uid = $('ncv-person').value;
  if (!uid) return;
  const usnap = await getDoc(doc(db, 'users', uid));
  const other = usnap.data() || {};
  const otherName = other.displayName || other.email || 'Usuario';
  // Reutiliza si ya existe un chat directo entre ambos.
  const csnap = await getDocs(query(collection(db, 'conversations'),
    where('participantUids', 'array-contains', state.user.uid),
    orderBy('updatedAt', 'desc'), limit(30)));
  const existing = csnap.docs.find(d => {
    const p = d.data();
    return p.direct === true && (p.participantUids || []).includes(uid);
  });
  if (existing) { openChat(existing.id); return; }
  const ref = await addDoc(collection(db, 'conversations'), {
    participantUids: [state.user.uid, uid],
    direct: true,
    title: 'Chat con ' + otherName,
    lastMessageText: '', createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  openChat(ref.id);
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
ACTIONS['delete-conversation'] = async (d) => {
  if (!confirm('¿Eliminar este chat? Se borrarán la conversación y todos sus mensajes.')) return;
  try {
    const msnap = await getDocs(query(collection(db, 'messages'),
      where('conversationId', '==', d.id), limit(500)));
    for (const m of msnap.docs) {
      try { await deleteDoc(m.ref); } catch (e) { /* sigue */ }
    }
    await deleteDoc(doc(db, 'conversations', d.id));
    if (state.currentConvId === d.id) state.currentConvId = null;
    toast('Chat eliminado.');
  } catch (err) {
    console.error(err);
    toast('No se pudo eliminar el chat.');
  }
  renderChatList();
};

// Borra TODOS los datos para empezar desde cero (solo admin).
// Conserva únicamente el usuario administrador actual.
ACTIONS['wipe-all-data'] = async () => {
  const confirmation = prompt('Para borrar TODOS los datos escribe BORRAR:');
  if (confirmation !== 'BORRAR') { toast('Cancelado.'); return; }
  if (!confirm('¿Seguro? Se eliminarán alumnos, familias, chats, avisos, informes y todo lo demás.')) return;
  toast('Borrando datos… esto puede tardar un poco.');
  const stats = { ok: 0, fail: 0, fails: [] };
  const safeGet = async (label, colRef) => {
    try { return (await getDocs(colRef)).docs; }
    catch (e) { stats.fail++; stats.fails.push(`leer ${label}`); return []; }
  };
  const safeDel = async (label, ref) => {
    try { await deleteDoc(ref); stats.ok++; }
    catch (e) { stats.fail++; if (stats.fails.length < 8) stats.fails.push(`borrar ${label}`); }
  };
  // Subcolecciones de autorizaciones (firmas) antes de borrar las autorizaciones.
  for (const a of await safeGet('autorizaciones', collection(db, 'authorizations'))) {
    for (const s of await safeGet('firmas', collection(db, 'authorizations', a.id, 'signatures'))) {
      await safeDel('firma', s.ref);
    }
  }
  // Colecciones principales.
  for (const col of ['students', 'conversations', 'messages', 'notices', 'reports',
                     'evaluations', 'attendance', 'authorizations', 'sessions', 'evalItems']) {
    for (const d of await safeGet(col, collection(db, col))) await safeDel(col, d.ref);
  }
  // Usuarios: borra todos excepto el admin actual (con sus subcolecciones).
  for (const u of await safeGet('usuarios', collection(db, 'users'))) {
    for (const sub of ['notifications', 'pushTokens']) {
      for (const s of await safeGet(sub, collection(db, 'users', u.id, sub))) await safeDel(sub, s.ref);
    }
    if (u.id !== state.user.uid) await safeDel('usuario', u.ref);
  }
  // Recarga el estado local.
  state.students = []; state.children = [];
  if (stats.fail === 0) {
    toast(`Borrado completo: ${stats.ok} elementos eliminados.`);
  } else {
    alert(`Se eliminaron ${stats.ok} elementos, pero ${stats.fail} fallaron.\n\n` +
      `Fallos: ${[...new Set(stats.fails)].join(', ')}.\n\n` +
      `Causa más probable: las reglas de Firestore no están publicadas.\n` +
      `Ve a Firebase console → Firestore → Reglas → Publicar, y vuelve a intentarlo.`);
  }
  renderUsers();
};

// La familia escribe al monitor: abre (o crea) la conversación con un monitor.
ACTIONS['contact-monitor'] = async () => {
  const child = state.children.find(x => x.id === state.selectedChildId) || state.children[0];
  if (!child) { toast('Aún no hay alumnos vinculados a tu familia.'); return; }
  const msnap = await getDocs(query(collection(db, 'users'), where('role', '==', 'monitor'), limit(5)));
  if (msnap.empty) { toast('Aún no hay profesores dados de alta.'); return; }
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

async function openChat(convId, inline = false) {
  state.currentConvId = convId;
  const csnap = await getDoc(doc(db, 'conversations', convId));
  const conv = csnap.data() || {};
  const otherName = conv.title || conv.studentName || 'Conversación';
  const subTitle = conv.direct ? '' : `Sobre ${esc(conv.studentName || '')}`;
  const desktop = window.innerWidth > 900;
  const chatHTML = `
    <div class="chat-header">
      ${desktop ? '' : `<button class="back" data-action="go" data-screen="chatList">‹</button>`}
      <span class="avatar-sm">${esc(initialsOf(otherName))}</span>
      <div><strong>${esc(otherName)}</strong>
        ${subTitle ? `<div class="meta">${subTitle}</div>` : ''}</div>
    </div>
    <div class="messages" id="chat-messages"></div>
    <div class="chat-input">
      <input type="text" id="chat-text" placeholder="Escribe un mensaje…" maxlength="500" autocomplete="off">
      <button class="send-btn" data-action="send-message" aria-label="Enviar">➤</button>
    </div>
    <p class="meta" style="text-align:center;margin:8px 0 0">Canal entre profesor y familia, sin compartir teléfonos personales.</p>`;
  if (desktop && $('chat-main')) {
    $('chat-main').innerHTML = chatHTML;
    document.querySelectorAll('.conv-item').forEach(el =>
      el.classList.toggle('active', el.dataset.id === convId));
  } else {
    $('chat-view-content').innerHTML = chatHTML;
    show('chatView');
  }
  // Escucha en tiempo real: los mensajes aparecen al instante.
  if (state.unsubChat) { state.unsubChat(); state.unsubChat = null; }
  state.unsubChat = onSnapshot(
    query(collection(db, 'messages'),
      where('conversationId', '==', convId), orderBy('createdAt', 'asc'), limit(200)),
    (snap) => {
      const box = $('chat-messages');
      if (!box) return;
      // Ignora escrituras aún sin fecha de servidor (el mensaje recién
      // enviado se muestra de forma optimista hasta que se confirma).
      const docs = snap.docs.filter(d => { try { return !!d.data().createdAt; } catch { return false; } });
      box.innerHTML = docs.map(d => {
        const m = d.data();
        const mine = m.senderUid === state.user.uid;
        return `<div class="msg ${mine ? 'mine' : 'theirs'}">
          ${mine ? '' : `<span class="who">${esc(m.senderName || '')}</span>`}
          ${esc(m.text)}
          <span class="when">${tsToDate(m.createdAt)}</span></div>`;
      }).join('') || emptyBox('💬', 'Aún no hay mensajes. ¡Escribe el primero!');
      box.scrollTop = box.scrollHeight;
    },
    (err) => {
      console.error('Error al escuchar mensajes:', err);
      const box = $('chat-messages');
      if (box) box.innerHTML = emptyBox('⚠️', 'No se pudieron cargar los mensajes.');
      const reason = err.code === 'failed-precondition'
        ? 'Falta el índice de mensajes en Firestore.'
        : err.code === 'permission-denied'
          ? 'Sin permiso para leer estos mensajes.'
          : ('Error al cargar el chat (' + (err.code || 'desconocido') + ').');
      toast(reason);
    });
  $('chat-text').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') ACTIONS['send-message']();
  });
}

ACTIONS['send-message'] = async () => {
  const input = $('chat-text');
  const text = input.value.trim();
  if (!text || !state.currentConvId) return;
  input.value = '';
  // Optimista: el mensaje se ve al instante mientras se envía.
  const box = $('chat-messages');
  let tmp = null;
  if (box) {
    tmp = document.createElement('div');
    tmp.className = 'msg mine pending';
    tmp.textContent = text;
    box.appendChild(tmp);
    box.scrollTop = box.scrollHeight;
  }
  try {
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
  } catch (err) {
    console.error('No se pudo enviar el mensaje:', err);
    if (tmp) tmp.remove();
    input.value = text;
    toast('No se pudo enviar el mensaje.');
  }
};

/* ---------------- Autorizaciones ---------------- */
async function renderAuths() {
  const c = $('auths-content');
  const snap = await getDocs(query(collection(db, 'authorizations'), orderBy('createdAt', 'desc'), limit(30)));
  // Total familias para el "X de Y firmadas".
  let nFamilies = 0;
  if (isMonitor()) {
    try {
      const usnap = await getDocs(query(collection(db, 'users'), where('role', '==', 'familia'), limit(100)));
      nFamilies = usnap.size;
    } catch (e) {}
  }
  c.innerHTML = `
    <div class="screen-head"><h2>Autorizaciones</h2>
      ${isMonitor() ? `<button class="btn small" data-action="go" data-screen="authCompose">+ Crear solicitud</button>` : ''}
    </div>
    ${isMonitor() ? `<div class="section-head"><div>
      <h3>Solicitudes a las familias</h3>
      <p class="muted">Crea autorizaciones y comprueba su estado.</p>
    </div></div>` : ''}
    <div id="auths-list"></div>`;
  const box = $('auths-list');
  if (snap.empty) { box.innerHTML = emptyBox('✍️', 'Aún no hay autorizaciones.'); return; }
  const cards = [];
  for (const d of snap.docs) {
    const a = d.data();
    if (isFamilia()) {
      const s = await getDoc(doc(db, 'authorizations', d.id, 'signatures', state.user.uid));
      const status = s.exists()
        ? '<span class="tag signed">Firmada</span>'
        : '<span class="tag pending">Pendiente de firma</span>';
      cards.push(`<div class="card" data-action="open-auth" data-id="${d.id}" style="cursor:pointer">
        <div class="row"><h3>${esc(a.title)}</h3>${status}</div>
        <div class="meta">${a.dueDate ? 'Límite: ' + fmtDate(a.dueDate) : ''}</div>
      </div>`);
    } else {
      const ss = await getDocs(collection(db, 'authorizations', d.id, 'signatures'));
      const nSigned = ss.size;
      const pct = nFamilies ? Math.round(nSigned / nFamilies * 100) : 0;
      const done = nFamilies && nSigned >= nFamilies;
      cards.push(`<div class="card" data-action="open-auth" data-id="${d.id}" style="cursor:pointer">
        <div class="auth-card-head">
          <span class="notif-ico">📝</span>
          <div style="flex:1">
            <div class="row"><h3 style="margin:0">${esc(a.title)}</h3>
              <span class="tag ${done ? 'tag-read' : 'tag-unread'}">${nSigned} de ${nFamilies} firmadas</span></div>
            <div class="meta">Enviada a ${nFamilies} familias${a.createdAt ? ' el ' + tsToDate(a.createdAt).split(',')[0] : ''}.</div>
          </div>
        </div>
        <div class="progress"><div class="progress-bar" style="width:${pct}%"></div></div>
        <button class="text-btn" style="margin-top:8px">Ver respuestas</button>
      </div>`);
    }
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
  const sessions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const upcoming = sessions.slice(0, 5);
  c.innerHTML = `
    <div class="screen-head"><h2>Calendario</h2>
      ${isMonitor() ? `<button class="btn small" data-action="toggle-session-form">+ Sesión</button>` : ''}
    </div>
    <div id="session-form" class="hidden card">
      <label for="se-date">Fecha</label><input type="date" id="se-date" value="${todayStr()}">
      <label for="se-start">Hora de inicio</label><input type="time" id="se-start" value="17:30">
      <label for="se-end">Hora de fin</label><input type="time" id="se-end" value="19:00">
      <label for="se-title">Título</label><input type="text" id="se-title" placeholder="Estudio dirigido">
      <label for="se-room">Aula</label><input type="text" id="se-room" placeholder="Ej.: Aula 2">
      <button class="btn block" data-action="save-session">Guardar sesión</button>
    </div>
    <div class="grid">
      <div class="col-7"><div class="card">
        <div class="cal-head">
          <h3 style="margin:0">Próximas fechas</h3>
        </div>
        <div id="sessions-list"></div>
      </div></div>
      <div class="col-5">
        <h3>Próximas sesiones</h3>
        ${upcoming.length ? upcoming.map(s => {
          const [y, m, d] = s.date.split('-').map(Number);
          const wd = DIAS_CORTO[new Date(y, m - 1, d).getDay()];
          return `<div class="card" style="margin-bottom:12px">
            <span class="tag tag-info">${wd} ${d}</span>
            <h4 style="margin:8px 0 4px">${esc(s.title || 'Estudio dirigido')}</h4>
            <p class="muted" style="margin:0">${esc(s.startTime || '')}–${esc(s.endTime || '')}${s.room ? ' · ' + esc(s.room) : ''}</p>
            ${isMonitor() ? `<button class="text-btn" data-action="delete-session" data-id="${s.id}" style="color:var(--danger);margin-top:8px">🗑️ Eliminar</button>` : ''}
          </div>`;
        }).join('') : emptyBox('📅', 'Aún no hay sesiones programadas.')}
      </div>
    </div>`;
  $('sessions-list').innerHTML = snap.empty
    ? emptyBox('📅', 'Aún no hay sesiones programadas.')
    : sessions.map(s => {
      return `<div class="history-line">
        <div><strong>${fmtDateLong(s.date)}</strong>
          <div class="meta">${esc(s.startTime || '')}–${esc(s.endTime || '')}${s.room ? ' · ' + esc(s.room) : ''}</div></div>
        <span class="meta">${esc(s.title || '')}</span>
      </div>`;
    }).join('');
}
ACTIONS['toggle-session-form'] = () => $('session-form').classList.toggle('hidden');
ACTIONS['save-session'] = async () => {
  await addDoc(collection(db, 'sessions'), {
    date: $('se-date').value, startTime: $('se-start').value, endTime: $('se-end').value,
    title: $('se-title').value.trim() || 'Estudio dirigido',
    room: $('se-room').value.trim(),
    createdByUid: state.user.uid, createdAt: serverTimestamp(),
  });
  toast('Sesión guardada.');
  renderCalendar();
};
ACTIONS['delete-session'] = async (d) => {
  if (!confirm('¿Eliminar esta sesión?')) return;
  await deleteDoc(doc(db, 'sessions', d.id));
  toast('Sesión eliminada.');
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
      updateAppBadge(snap.size);
    });
}

const NOTIF_TYPE_LABEL = {
  chat: 'Mensaje',
  report: 'Informe',
  notice: 'Aviso',
  authorization: 'Autorización',
  evaluation: 'Evaluación',
  attendance: 'Incidencia',
};
// Cobertura de alertas: qué tipos de aviso quiere recibir el usuario.
const COVERAGE_CATS = [
  { key: 'incidencias', label: 'Incidencias' },
  { key: 'chat', label: 'Chat' },
  { key: 'informe_diario', label: 'Informe diario' },
  { key: 'informe_mensual', label: 'Informe mensual' },
  { key: 'avisos', label: 'Avisos' },
  { key: 'respuestas', label: 'Respuestas' },
];
const notifTypeLabel = (n) => {
  if (n.type === 'report') return n.reportType === 'mensual' ? 'Informe mensual' : 'Informe diario';
  return NOTIF_TYPE_LABEL[n.type] || 'Aviso';
};

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
  const cov = (state.profile && state.profile.alertCoverage) || {};
  c.innerHTML = pushCard + `
    <div class="screen-head"><h2>Notificaciones</h2>
      ${snap.size ? `<button class="btn small secondary" data-action="read-all-notif">Marcar leídas</button>` : ''}
    </div><div id="notif-list"></div>
    <div class="card" style="margin-top:16px">
      <h3>Cobertura de alertas</h3>
      <p class="muted" style="margin:4px 0 12px">Elige qué avisos quieres recibir.</p>
      <div class="coverage-pills">
        ${COVERAGE_CATS.map(cat => `
          <button class="pill ${cov[cat.key] !== false ? 'on' : ''}" data-action="toggle-coverage" data-key="${cat.key}">${cat.label}</button>`).join('')}
      </div>
    </div>`;
  $('notif-list').innerHTML = snap.empty
    ? emptyBox('🔔', 'No tienes notificaciones.')
    : snap.docs.map(d => {
      const n = d.data();
      return `<article class="card notif-card ${n.read ? 'read' : ''}" data-action="open-notif" data-id="${d.id}">
        ${!n.read ? '<span class="unread-dot"></span>' : ''}
        <span class="notif-ico">🔔</span>
        <div class="notif-main">
          <div class="notif-tags">
            <span class="tag">${esc(notifTypeLabel(n))}</span>
            <span class="tag ${n.read ? 'tag-read' : 'tag-unread'}">${n.read ? 'Leída' : 'Sin leer'}</span>
          </div>
          <h4>${esc(n.title)}</h4>
          <p class="muted">${esc(n.body || '')}</p>
          <div class="meta">${tsToDate(n.createdAt)}</div>
        </div>
        <span class="text-btn">Abrir</span>
      </article>`;
    }).join('');
  updateAppBadge(snap.docs.filter(d => !d.data().read).length);
}

ACTIONS['toggle-coverage'] = async (d, el) => {
  const key = el.dataset.key;
  const cov = { ...((state.profile && state.profile.alertCoverage) || {}) };
  cov[key] = !(cov[key] !== false);
  try {
    await updateDoc(doc(db, 'users', state.user.uid), { alertCoverage: cov });
    state.profile.alertCoverage = cov;
    toast('Preferencia guardada.');
  } catch (err) {
    console.error(err);
    toast('No se pudo guardar.');
  }
  renderNotifications();
};
ACTIONS['read-all-notif'] = async () => {
  const snap = await getDocs(query(collection(db, 'users', state.user.uid, 'notifications'),
    where('read', '==', false)));
  for (const d of snap.docs) await updateDoc(d.ref, { read: true });
  updateAppBadge(0);
  renderNotifications();
};
ACTIONS['open-notif'] = async (d) => {
  await updateDoc(doc(db, 'users', state.user.uid, 'notifications', d.id), { read: true });
  renderNotifications();
};

/* ---------------- Perfil y menú "Más" ---------------- */
async function renderProfile() {
  const kids = isFamilia() ? state.children : [];
  const name = state.profile.displayName || 'Usuario';
  if (isMonitor()) {
    const items = [
      { label: 'Preferencias de avisos', icon: '🔔', screen: 'notifications' },
      { label: 'Horario del grupo', icon: '📅', screen: 'calendar' },
      { label: 'Mi información', icon: '👤', screen: null },
    ];
    $('profile-content').innerHTML = `
      <div class="screen-head"><h2>Perfil</h2></div>
      <div class="grid">
        <div class="col-5"><div class="card" style="text-align:center;padding:32px 16px">
          <span class="avatar-lg">${esc(initialsOf(name))}</span>
          <h3 style="margin:16px 0 4px">${esc(name)}</h3>
          <p class="muted" style="margin:0">${ROLE_LABEL[state.role] || state.role}</p>
          <div style="margin-top:12px"><span class="tag ${state.role === 'admin' ? 'tag-unread' : 'tag-read'}">Vista ${state.role === 'admin' ? 'admin' : 'monitor'}</span></div>
          <p class="meta" style="margin-top:12px">${esc(state.profile.email || '')}</p>
        </div></div>
        <div class="col-7"><div class="card menu-list">
          ${items.map(i => `
            <button class="menu-row big" ${i.screen ? `data-action="go" data-screen="${i.screen}"` : `data-action="profile-info"`}>
              <span class="menu-ico" style="font-size:28px">${i.icon}</span>
              <span class="menu-label">${i.label}</span><b>›</b>
            </button>`).join('')}
        </div></div>
      </div>
      <button class="btn danger block" data-action="sign-out" style="margin-top:16px">Cerrar sesión</button>`;
    return;
  }
  $('profile-content').innerHTML = `
    <h2>Mi perfil</h2>
    <div class="card">
      <div class="row"><strong>${esc(name)}</strong>
        <span class="tag pending">${ROLE_LABEL[state.role] || state.role}</span></div>
      <div class="meta">${esc(state.profile.email || '')}</div>
    </div>
    <h3>Datos de mi hijo/a</h3>
    ${kids.length
      ? kids.map(k => `<div class="card"><strong>${esc(k.firstName)} ${esc(k.lastName || '')}</strong>
          <div class="meta">Grupo: ${esc(k.group || '—')}</div></div>`).join('')
      : emptyBox('👧', 'Aún no hay alumnos vinculados a tu familia.')}
    <button class="btn danger block" data-action="sign-out">Cerrar sesión</button>`;
}
ACTIONS['sign-out'] = async () => { await signOut(auth); };
ACTIONS['profile-info'] = () => {
  alert(`Nombre: ${state.profile.displayName || '—'}\nCorreo: ${state.profile.email || '—'}\nRol: ${ROLE_LABEL[state.role] || state.role}`);
};

function renderMore() {
  const fam = !isMonitor();
  const items = [
    ...(fam ? [{ id: 'child', label: 'Datos de mi hijo', icon: 'child' }] : []),
    { id: 'reports', label: 'Informes', icon: 'reports' },
    { id: 'notifications', label: 'Notificaciones', icon: 'notifications' },
    { id: 'auths', label: 'Autorizaciones', icon: 'auths' },
    ...(fam ? [{ id: 'progress', label: 'Evaluación diaria', icon: 'evaluate' }] : []),
    { id: 'calendar', label: 'Calendario de sesiones', icon: 'calendar' },
    { id: 'profile', label: 'Perfil y ajustes', icon: 'profile' },
  ];
  $('more-content').innerHTML = `
    <div class="screen-head"><h2>Más</h2></div>
    <div class="card menu-list">` + items.map(i =>
      `<button class="menu-row big" data-action="go" data-screen="${i.id}">
        <span class="menu-ico">${NAV_ICONS[i.icon]}</span>
        <span class="menu-label">${i.label}</span><b>›</b>
      </button>`).join('') + `</div>
    <div class="card" style="margin-top:16px">
      <span class="tag tag-info">Studio sistema</span>
      <h3 style="margin:10px 0 6px">Studio sistema</h3>
      <p class="muted" style="margin:0">Asociación Juvenil Glera · Curso 2026–2027</p>
    </div>`;
}

/* ---------------- Push: registro del token y mensajes en 1er plano ---------------- */
// Globo con el número de notificaciones sin leer en el icono de la app.
async function updateAppBadge(count) {
  try {
    if (!('setAppBadge' in navigator)) return;
    if (count > 0) await navigator.setAppBadge(count);
    else if ('clearAppBadge' in navigator) await navigator.clearAppBadge();
  } catch (e) {}
}

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
// pueda enviarle push. Devuelve {ok:true} o {ok:false, reason, error}.
async function registerPushToken() {
  if (!vapidKey || vapidKey === 'TODO') {
    console.warn('Falta la clave VAPID: genera una en Firebase console (ver README, paso 5).');
    return { ok: false, reason: 'no-vapid' };
  }
  // Registra el SW de forma explícita para obtener errores claros.
  // Sin scope personalizado: iOS rechaza scopes distintos del directorio
  // del script; el scope por defecto (/) siempre está permitido.
  let registration;
  try {
    // Limpia registros previos que puedan haber quedado en estado roto.
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) { try { await r.unregister(); } catch (e) {} }
    } catch (e) {}
    registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
  } catch (e) {
    console.warn('No se pudo registrar el service worker:', e);
    return { ok: false, reason: 'sw-failed', error: e };
  }
  const messaging = getMessaging(app);
  let token;
  try {
    token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration });
  } catch (e) {
    console.warn('No se pudo obtener el token push:', e);
    return { ok: false, reason: 'token-failed', error: e };
  }
  if (!token) return { ok: false, reason: 'no-token' };
  try {
    await setDoc(doc(db, 'users', state.user.uid, 'pushTokens', token), {
      token, platform: 'web', createdAt: serverTimestamp(),
    });
  } catch (e) {
    console.warn('No se pudo guardar el token push:', e);
    return { ok: false, reason: 'save-failed', error: e };
  }
  state.pushToken = token;
  try { localStorage.setItem('gleraPushToken', token); } catch (e) {}
  return { ok: true };
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
        const res = await registerPushToken();
        if (res.ok) {
          toast('Notificaciones push activadas.');
        } else {
          const detail = res.error && res.error.message ? ': ' + res.error.message : '.';
          const msg = {
            'no-vapid': 'Falta configurar la clave VAPID.',
            'sw-failed': 'No se pudo registrar el service worker' + detail,
            'token-failed': 'No se pudo obtener el token push' + detail,
            'no-token': 'No se obtuvo token push.',
            'save-failed': 'No se pudo guardar el token' + detail,
          }[res.reason] || 'No se pudo activar el push en este dispositivo.';
          toast(msg);
        }
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
  if (!isMonitor()) { show('home'); return; }
  const admin = isAdmin();
  const c = $('users-content');
  const [usnap, ssnap] = await Promise.all([
    getDocs(query(collection(db, 'users'), orderBy('displayName'))),
    getDocs(query(collection(db, 'students'), orderBy('firstName'))),
  ]);
  const users = usnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const students = ssnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const familias = users.filter(u => u.role === 'familia');
  const es = state.editingStudentId ? students.find(s => s.id === state.editingStudentId) : null;
  if (state.editingStudentId && !es) state.editingStudentId = null; // el alumno en edición ya no existe
  const esFam = es ? (es.familyUids || []) : [];
  // Al crear, un monitor propone su propio nombre como responsable.
  const defaultMonitor = !es && !admin ? (state.profile.displayName || '') : '';
  c.innerHTML = `
    ${admin ? `
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
    </div>` : ''}
    <div class="section-head" style="margin-top:${admin ? '24px' : '0'}"><div><h3>Alumnos</h3>
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
            <button class="text-btn" data-action="edit-student" data-id="${s.id}">Editar</button>
            <button class="danger-btn" data-action="delete-student" data-id="${s.id}">Eliminar</button>
          </div>
        </div>`).join('')
      : emptyBox('🎒', 'Aún no hay alumnos dados de alta.')}
    </div>
    <div class="card" id="student-form" style="margin-top:16px">
      <div class="section-head"><h3>${es ? 'Editar alumno' : 'Nuevo alumno'}</h3></div>
      <label for="ns-first">Nombre</label>
      <input type="text" id="ns-first" maxlength="60" autocomplete="off" value="${esc(es?.firstName || '')}">
      <label for="ns-last">Apellidos</label>
      <input type="text" id="ns-last" maxlength="80" autocomplete="off" value="${esc(es?.lastName || '')}">
      <label for="ns-group">Grupo</label>
      <input type="text" id="ns-group" maxlength="40" placeholder="Ej.: Grupo A" autocomplete="off" value="${esc(es?.group || '')}">
      <label for="ns-monitor">Profesor responsable</label>
      <input type="text" id="ns-monitor" maxlength="80" autocomplete="off" value="${esc(es?.monitorName || defaultMonitor)}">
      <label for="ns-schedule">Horario habitual</label>
      <input type="text" id="ns-schedule" maxlength="60" placeholder="Ej.: L–J · 17:00–18:30" autocomplete="off" value="${esc(es?.schedule || '')}">
      <label for="ns-classroom">Aula habitual</label>
      <input type="text" id="ns-classroom" maxlength="40" placeholder="Ej.: Aula 1" autocomplete="off" value="${esc(es?.classroom || '')}">
      <label for="ns-start">Inicio</label>
      <input type="date" id="ns-start" value="${esc(es?.startDate || '')}">
      <label for="ns-pickup">Recogida</label>
      <input type="text" id="ns-pickup" maxlength="80" placeholder="Ej.: Salida con familiar" autocomplete="off" value="${esc(es?.pickup || '')}">
      <label>Familias vinculadas</label>
      ${familias.length ? familias.map(f => `
        <label class="check"><input type="checkbox" data-family-check value="${f.id}" ${esFam.includes(f.id) ? 'checked' : ''}>
          ${esc(f.displayName || f.email || 'Sin nombre')}</label>`).join('')
        : '<p class="muted">No hay usuarios con rol de familia todavía.</p>'}
      <button class="btn block" data-action="create-student">${es ? 'Guardar cambios' : 'Guardar alumno'}</button>
      ${es ? `<button class="btn secondary block" data-action="cancel-edit-student" style="margin-top:8px">Cancelar</button>` : ''}
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
  // Zona de peligro solo para admin.
  if (admin) {
    const danger = document.createElement('div');
    danger.className = 'card';
    danger.style.cssText = 'margin-top:24px;border-color:var(--danger)';
    danger.innerHTML = `
      <h3 style="color:var(--danger)">Zona de peligro</h3>
      <p class="muted">Elimina todos los datos de la aplicación (alumnos, familias, chats, avisos, informes, etc.) para empezar desde cero. Tu usuario de administrador se conserva.</p>
      <button class="btn danger block" data-action="wipe-all-data">Borrar todos los datos</button>`;
    c.appendChild(danger);
  }
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
ACTIONS['edit-student'] = (d) => {
  state.editingStudentId = d.id;
  renderUsers();
  setTimeout(() => { const f = $('student-form'); if (f) f.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 50);
};
ACTIONS['cancel-edit-student'] = () => {
  state.editingStudentId = null;
  renderUsers();
};
ACTIONS['create-student'] = async () => {
  const firstName = $('ns-first').value.trim();
  if (!firstName) { toast('Escribe al menos el nombre del alumno.'); return; }
  const familyUids = [...document.querySelectorAll('[data-family-check]:checked')].map(x => x.value);
  // Campos opcionales: solo se guardan si tienen valor (al editar, vaciarlos los elimina).
  const editing = !!state.editingStudentId;
  const opt = (id, key) => {
    const v = $(id).value.trim();
    return v ? { [key]: v } : (editing ? { [key]: deleteField() } : {});
  };
  const data = {
    firstName,
    lastName: $('ns-last').value.trim(),
    group: $('ns-group').value.trim(),
    familyUids,
    ...opt('ns-monitor', 'monitorName'),
    ...opt('ns-schedule', 'schedule'),
    ...opt('ns-classroom', 'classroom'),
    ...opt('ns-start', 'startDate'),
    ...opt('ns-pickup', 'pickup'),
  };
  try {
    if (editing) {
      await updateDoc(doc(db, 'students', state.editingStudentId), data);
      state.editingStudentId = null;
      toast('Alumno actualizado.');
    } else {
      await addDoc(collection(db, 'students'), { ...data, createdAt: serverTimestamp() });
      toast('Alumno dado de alta.');
    }
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
