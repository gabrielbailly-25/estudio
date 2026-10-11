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
  getFirestore, doc, getDoc, setDoc, addDoc, updateDoc,
  collection, query, where, orderBy, limit, getDocs,
  onSnapshot, serverTimestamp
} from 'firebase/firestore';
import { getMessaging, getToken, onMessage, isSupported } from 'firebase/messaging';

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
  evalMarks: {},    // marcas temporales al evaluar
  unsubChat: null,
  unsubNotif: null,
};

const isMonitor = () => state.role === 'monitor' || state.role === 'admin';
const ROLE_LABEL = { admin: 'Administrador', monitor: 'Monitor/a', familia: 'Familia' };

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
const SCREENS = ['login', 'home', 'attendance', 'evaluate', 'progress', 'reports',
  'reportDetail', 'reportCompose', 'chatList', 'chatView', 'auths', 'authDetail',
  'authCompose', 'noticeCompose', 'calendar', 'notifications', 'profile', 'more'];
const RENDER = {};

function show(id) {
  // Al salir del chat se cierra su escucha en tiempo real.
  if (id !== 'chatView' && state.unsubChat) { state.unsubChat(); state.unsubChat = null; }
  SCREENS.forEach(s => $('screen-' + s).classList.toggle('active', s === id));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.screen === id));
  window.scrollTo(0, 0);
  if (RENDER[id]) RENDER[id]();
}

/* ---------------- Navegación inferior (según rol) ---------------- */
function renderNav() {
  const items = [
    { id: 'home', label: 'Inicio', icon: '🏠' },
    { id: 'attendance', label: 'Asistencia', icon: '✅' },
    isMonitor()
      ? { id: 'evaluate', label: 'Evaluar', icon: '📝' }
      : { id: 'progress', label: 'Progreso', icon: '📈' },
    { id: 'chatList', label: 'Chat', icon: '💬' },
    { id: 'more', label: 'Más', icon: '⋯' },
  ];
  $('bottomnav').innerHTML = items.map(i =>
    `<button class="nav-btn" data-action="go" data-screen="${i.id}">
       <span class="ic">${i.icon}</span>${i.label}
     </button>`).join('');
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
      document.body.classList.add('logged-out');
      show('login');
      return;
    }
    try {
      state.user = user;
      const uref = doc(db, 'users', user.uid);
      let snap = await getDoc(uref);
      if (!snap.exists()) {
        // Primer acceso: la ficha se crea como "familia".
        // Un administrador cambia el rol a "monitor"/"admin" desde la consola.
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
      document.body.classList.remove('logged-out');
      await loadRoster();
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

/* ---------------- Inicio: tablón de anuncios ---------------- */
async function renderHome() {
  const c = $('home-content');
  const snap = await getDocs(query(collection(db, 'notices'), orderBy('createdAt', 'desc'), limit(30)));
  const notices = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  // Fijados primero (en cliente, para no necesitar otro índice).
  notices.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  c.innerHTML = `
    <div class="screen-head"><h2>📋 Tablón de anuncios</h2>
      ${isMonitor() ? `<button class="btn small" data-action="go" data-screen="noticeCompose">+ Publicar</button>` : ''}
    </div>
    ${notices.length ? notices.map(n => `
      <div class="card">
        ${n.pinned ? '<span class="pinned-tag">📌 Fijado</span>' : ''}
        <h3>${esc(n.title)}</h3>
        <p>${esc(n.body)}</p>
        <div class="meta">${tsToDate(n.createdAt)}</div>
      </div>`).join('')
      : emptyBox('📋', 'Aún no hay avisos en el tablón.')}`;
}

async function renderNoticeCompose() {
  $('notice-compose-content').innerHTML = `
    <button class="back" data-action="go" data-screen="home">‹ Volver</button>
    <h2>Nuevo aviso</h2>
    <label for="nc-title">Título</label>
    <input type="text" id="nc-title" maxlength="120" placeholder="Ej.: Cambio de horario del miércoles">
    <label for="nc-body">Texto</label>
    <textarea id="nc-body" placeholder="Escribe el aviso para las familias…"></textarea>
    <label><input type="checkbox" id="nc-pinned"> Fijar en el tablón</label>
    <button class="btn block" data-action="publish-notice">Publicar aviso</button>`;
}
ACTIONS['publish-notice'] = async () => {
  const title = $('nc-title').value.trim();
  const body = $('nc-body').value.trim();
  if (!title || !body) { toast('Escribe un título y un texto.'); return; }
  await addDoc(collection(db, 'notices'), {
    title, body, pinned: $('nc-pinned').checked,
    createdByUid: state.user.uid, createdAt: serverTimestamp(),
  });
  toast('Aviso publicado en el tablón.');
  show('home');
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
const EVAL_LABEL = { 1: 'Necesita mejorar', 2: 'Bien', 3: 'Muy bien' };
const EVAL_CRITS = [
  ['puntualidad', 'Puntualidad'],
  ['agenda', 'Uso de la agenda'],
  ['aprovechamiento', 'Aprovechamiento del tiempo'],
];

async function renderEvaluate() {
  const c = $('evaluate-content');
  if (!state.students.length) {
    c.innerHTML = `<h2>Evaluación diaria</h2>` + emptyBox('📝', 'Aún no hay alumnos dados de alta.');
    return;
  }
  state.evalMarks = { puntualidad: 2, agenda: 2, aprovechamiento: 2 };
  c.innerHTML = `
    <h2>Evaluación diaria</h2>
    <label for="ev-student">Alumno/a</label>
    <select id="ev-student">${state.students.map(s =>
      `<option value="${s.id}">${esc(s.firstName)} ${esc(s.lastName || '')}</option>`).join('')}</select>
    <label for="ev-date">Fecha</label>
    <input type="date" id="ev-date" value="${todayStr()}">
    ${EVAL_CRITS.map(([k, label]) => `
      <label>${label}</label>
      <div class="seg">
        <button data-action="ev-mark" data-crit="${k}" data-val="1">1 · Mejorar</button>
        <button data-action="ev-mark" data-crit="${k}" data-val="2" class="on">2 · Bien</button>
        <button data-action="ev-mark" data-crit="${k}" data-val="3">3 · Muy bien</button>
      </div>`).join('')}
    <label for="ev-comment">Comentario (opcional)</label>
    <textarea id="ev-comment" placeholder="Observaciones del día…"></textarea>
    <button class="btn block" data-action="save-evaluation">Guardar evaluación</button>`;
}
ACTIONS['ev-mark'] = (d, el) => {
  state.evalMarks[d.crit] = parseInt(d.val, 10);
  el.parentElement.querySelectorAll('button').forEach(b => b.classList.remove('on'));
  el.classList.add('on');
};
ACTIONS['save-evaluation'] = async () => {
  const studentId = $('ev-student').value;
  const date = $('ev-date').value || todayStr();
  await setDoc(doc(db, 'evaluations', `${studentId}_${date}`), {
    studentId, date,
    puntualidad: state.evalMarks.puntualidad,
    agenda: state.evalMarks.agenda,
    aprovechamiento: state.evalMarks.aprovechamiento,
    comment: $('ev-comment').value.trim(),
    createdByUid: state.user.uid, createdAt: serverTimestamp(),
  }, { merge: true });
  toast('Evaluación guardada.');
};

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
  const critCard = (label, v) =>
    `<div class="card"><div class="row"><span>${label}</span><strong>${v} · ${EVAL_LABEL[v] || ''}</strong></div></div>`;
  box.innerHTML = `
    <h3>Última evaluación (${fmtDate(latest.date)})</h3>
    ${critCard('Puntualidad', latest.puntualidad)}
    ${critCard('Uso de la agenda', latest.agenda)}
    ${critCard('Aprovechamiento del tiempo', latest.aprovechamiento)}
    ${latest.comment ? `<div class="card"><p>💬 ${esc(latest.comment)}</p></div>` : ''}
    <hr class="divider"><h3>Historial</h3>
    ${snap.docs.map(d => {
      const e = d.data();
      return `<div class="card"><div class="row"><strong>${fmtDate(e.date)}</strong>
        <span class="meta">P:${e.puntualidad} · A:${e.agenda} · T:${e.aprovechamiento}</span></div></div>`;
    }).join('')}`;
}

// Registro de pantallas de esta primera parte.
Object.assign(RENDER, {
  home: renderHome,
  attendance: renderAttendance,
  evaluate: renderEvaluate,
  progress: renderProgress,
});

/* ============================================================
   PARTE 2 — Informes, chat, autorizaciones, calendario,
   notificaciones, perfil, menú y notificaciones push.
   ============================================================ */

/* ---------------- Informes ---------------- */
async function renderReports() {
  const c = $('reports-content');
  if (isMonitor()) {
    c.innerHTML = `
      <div class="screen-head"><h2>Informes</h2>
        <button class="btn small" data-action="go" data-screen="reportCompose">+ Nuevo</button>
      </div><div id="reports-list"></div>`;
    const snap = await getDocs(query(collection(db, 'reports'), orderBy('createdAt', 'desc'), limit(40)));
    $('reports-list').innerHTML = snap.empty
      ? emptyBox('📄', 'Aún no hay informes.')
      : snap.docs.map(d => reportCard(d.id, d.data())).join('');
  } else {
    if (!state.children.length) {
      c.innerHTML = `<h2>Informes</h2>` + emptyBox('📄', 'Aún no hay alumnos vinculados a tu familia.');
      return;
    }
    c.innerHTML = `<h2>Informes</h2>
      ${state.children.length > 1 ? childSelectHTML('rep-child') : ''}
      <div id="reports-list" style="margin-top:12px"></div>`;
    const sel = $('rep-child');
    if (sel) sel.addEventListener('change', () => { state.selectedChildId = sel.value; loadReports(); });
    await loadReports();
  }
}

const reportCard = (id, r) => `
  <div class="card" data-action="open-report" data-id="${id}" style="cursor:pointer">
    <h3>${esc(r.title)}</h3>
    <div class="meta">${r.month ? fmtMonth(r.month) + ' · ' : ''}${tsToDate(r.createdAt)}</div>
  </div>`;

async function loadReports() {
  const box = $('reports-list');
  const snap = await getDocs(query(collection(db, 'reports'),
    where('studentId', '==', state.selectedChildId), orderBy('createdAt', 'desc'), limit(40)));
  box.innerHTML = snap.empty
    ? emptyBox('📄', 'Aún no hay informes.')
    : snap.docs.map(d => reportCard(d.id, d.data())).join('');
}

ACTIONS['open-report'] = async (d) => {
  const snap = await getDoc(doc(db, 'reports', d.id));
  if (!snap.exists()) return;
  const r = snap.data();
  $('report-detail-content').innerHTML = `
    <button class="back" data-action="go" data-screen="reports">‹ Informes</button>
    <h2>${esc(r.title)}</h2>
    <div class="meta">${r.month ? fmtMonth(r.month) + ' · ' : ''}${tsToDate(r.createdAt)}</div>
    <div class="card" style="margin-top:12px"><p style="white-space:pre-wrap">${esc(r.body)}</p></div>`;
  show('reportDetail');
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
  const snap = await getDocs(query(collection(db, 'users', state.user.uid, 'notifications'),
    orderBy('createdAt', 'desc'), limit(50)));
  c.innerHTML = `
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
  const items = [
    { id: 'reports', label: 'Informes', icon: '📄' },
    { id: 'auths', label: 'Autorizaciones', icon: '✍️' },
    { id: 'calendar', label: 'Calendario', icon: '📅' },
    { id: 'notifications', label: 'Notificaciones', icon: '🔔' },
    { id: 'profile', label: 'Mi perfil', icon: '👤' },
  ];
  $('more-content').innerHTML = `<h2>Más</h2>` + items.map(i =>
    `<div class="menu-item" data-action="go" data-screen="${i.id}">
      <span class="ic">${i.icon}</span>${i.label}<span class="chev">›</span>
    </div>`).join('');
}

/* ---------------- Push: registro del token y mensajes en 1er plano ---------------- */
async function initPush() {
  try {
    if (!await isSupported()) return;
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;
    if (!vapidKey || vapidKey === 'TODO') {
      console.warn('Falta la clave VAPID: genera una en Firebase console (ver README, paso 5).');
      return;
    }
    const messaging = getMessaging(app);
    const token = await getToken(messaging, { vapidKey });
    if (token) {
      // Guarda el token para que el backend pueda enviar push a este dispositivo.
      await setDoc(doc(db, 'users', state.user.uid, 'pushTokens', token), {
        token, platform: 'web', createdAt: serverTimestamp(),
      });
    }
    // Con la app abierta, los push se muestran como aviso interno.
    onMessage(messaging, (payload) => {
      toast('🔔 ' + ((payload.notification && payload.notification.title) || 'Nuevo aviso'));
    });
  } catch (err) {
    console.warn('Push no disponible:', err);
  }
}

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
});

// Arranque: si hay configuración válida, se vigila la sesión; si no, se avisa en el login.
if (initFirebase()) {
  watchAuth();
} else {
  document.body.classList.add('logged-out');
  show('login');
}
