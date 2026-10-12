// ============================================================
// Cloud Functions — App Estudio Dirigido Glera
// Envían notificaciones push (FCM) cuando se crea contenido nuevo:
// mensajes de chat, informes, avisos, autorizaciones, evaluaciones
// y ausencias. También escriben en el centro de notificaciones
// de cada destinatario (users/{uid}/notifications).
//
// Requiere el plan Blaze (pago por uso) de Firebase.
// Despliegue: firebase deploy --only functions
// Región: europe-west1 (misma zona que Firestore europe-west).
// ============================================================

const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { logger } = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();
const messaging = admin.messaging();
const REGION = 'europe-west1';

// Guarda la notificación en el centro de notificaciones del usuario.
async function saveNotification(uid, { type, title, body, reportType }) {
  const data = {
    type,
    title,
    body: body || '',
    read: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (reportType) data.reportType = reportType;
  await db.collection('users').doc(uid).collection('notifications').add(data);
}

// Envía push FCM a todos los tokens registrados del usuario.
// Los tokens inválidos se eliminan para no reintentarlos.
// Incluye el número de no leídas para el globo del icono de la app.
async function sendPush(uid, { title, body }) {
  const snap = await db.collection('users').doc(uid).collection('pushTokens').get();
  const tokens = snap.docs.map((d) => d.data().token).filter(Boolean);
  if (!tokens.length) return;
  let unread = 0;
  try {
    const c = await db.collection('users').doc(uid).collection('notifications')
      .where('read', '==', false).count().get();
    unread = c.data().count;
  } catch (e) { /* sin conteo */ }
  const res = await messaging.sendEachForMulticast({
    tokens,
    notification: { title, body: body || '' },
    data: { unreadCount: String(unread) },
  });
  // Limpia los tokens que Firebase ya no acepta.
  const dead = [];
  res.responses.forEach((r, i) => {
    if (!r.success) dead.push(snap.docs[i].ref);
  });
  for (const ref of dead) {
    try { await ref.delete(); } catch (e) { /* ya eliminado */ }
  }
}

// Categoría de cobertura para cada tipo de notificación.
function coverageKeyFor(type, notif) {
  switch (type) {
    case 'chat': return 'chat';
    case 'notice': return 'avisos';
    case 'attendance': return 'incidencias';
    case 'authorization': return 'respuestas';
    case 'evaluation': return 'informe_diario';
    case 'report': return (notif && notif.reportType === 'mensual') ? 'informe_mensual' : 'informe_diario';
    default: return null;
  }
}

// Notifica a una lista de usuarios (centro + push).
async function notifyUsers(uids, notif) {
  const uniq = [...new Set(uids.filter(Boolean))];
  const key = coverageKeyFor(notif.type, notif);
  for (const uid of uniq) {
    try {
      // Respeta la cobertura de alertas del usuario (por defecto todo activado).
      if (key) {
        const usnap = await db.collection('users').doc(uid).get();
        const cov = (usnap.data() && usnap.data().alertCoverage) || {};
        if (cov[key] === false) continue;
      }
      await saveNotification(uid, notif);
      await sendPush(uid, { title: notif.title, body: notif.body });
    } catch (err) {
      logger.error('Error notificando a ' + uid, err);
    }
  }
}

// Familias vinculadas a un alumno.
async function familyUidsOf(studentId) {
  const snap = await db.doc('students/' + studentId).get();
  const data = snap.data() || {};
  return data.familyUids || [];
}

// Todos los usuarios con un rol dado.
async function uidsWithRole(role) {
  const snap = await db.collection('users').where('role', '==', role).get();
  return snap.docs.map((d) => d.id);
}

// ---------- 1. Mensaje de chat nuevo -> avisa a los demás participantes ----------
exports.onMessageCreated = onDocumentCreated(
  { document: 'messages/{msgId}', region: REGION },
  async (event) => {
    const m = event.data.data();
    const recipients = (m.participantUids || []).filter((u) => u !== m.senderUid);
    await notifyUsers(recipients, {
      type: 'chat',
      title: 'Nuevo mensaje de ' + (m.senderName || 'Estudio Dirigido'),
      body: String(m.text || '').slice(0, 120),
    });
  }
);

// ---------- 2. Informe nuevo -> avisa a la familia del alumno ----------
exports.onReportCreated = onDocumentCreated(
  { document: 'reports/{reportId}', region: REGION },
  async (event) => {
    const r = event.data.data();
    const families = await familyUidsOf(r.studentId);
    await notifyUsers(families, {
      type: 'report',
      reportType: r.type || (r.month ? 'mensual' : 'diario'),
      title: 'Nuevo informe: ' + (r.title || ''),
      body: 'Ya puedes leer el informe en la app.',
    });
  }
);

// ---------- 3. Aviso en el tablón -> avisa a todas las familias y monitores ----------
exports.onNoticeCreated = onDocumentCreated(
  { document: 'notices/{noticeId}', region: REGION },
  async (event) => {
    const n = event.data.data();
    const familias = await uidsWithRole('familia');
    const monitores = await uidsWithRole('monitor');
    // No avisar al autor del aviso.
    const recipients = [...familias, ...monitores].filter((u) => u !== n.createdByUid);
    await notifyUsers(recipients, {
      type: 'notice',
      title: 'Nuevo aviso en el tablón',
      body: String(n.title || '').slice(0, 120),
    });
  }
);

// ---------- 4. Autorización nueva -> avisa a todas las familias ----------
exports.onAuthorizationCreated = onDocumentCreated(
  { document: 'authorizations/{authId}', region: REGION },
  async (event) => {
    const a = event.data.data();
    const familias = await uidsWithRole('familia');
    await notifyUsers(familias, {
      type: 'authorization',
      title: 'Nueva autorización para firmar',
      body: String(a.title || '').slice(0, 120),
    });
  }
);

// ---------- 5. Evaluación diaria nueva -> avisa a la familia del alumno ----------
exports.onEvaluationCreated = onDocumentCreated(
  { document: 'evaluations/{evalId}', region: REGION },
  async (event) => {
    const e = event.data.data();
    const families = await familyUidsOf(e.studentId);
    await notifyUsers(families, {
      type: 'evaluation',
      title: 'Nueva evaluación diaria (' + (e.date || '') + ')',
      body: 'Revisa el progreso en la app.',
    });
  }
);

// ---------- 6. Asistencia no presente -> avisa a la familia ----------
exports.onAttendanceCreated = onDocumentCreated(
  { document: 'attendance/{attId}', region: REGION },
  async (event) => {
    const a = event.data.data();
    if (a.status === 'presente') return; // solo ausencias y justificaciones
    const families = await familyUidsOf(a.studentId);
    const label = a.status === 'ausente' ? 'falta de asistencia' : 'falta justificada';
    await notifyUsers(families, {
      type: 'attendance',
      title: 'Aviso de asistencia (' + (a.date || '') + ')',
      body: 'Se ha registrado una ' + label + '.',
    });
  }
);
