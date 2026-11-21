'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');
const { DatabaseSync } = require('node:sqlite');

process.env.TZ = process.env.TZ || 'Asia/Kolkata';
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const IS_PROD = process.env.NODE_ENV === 'production';
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const LEGACY_DB_FILE = path.join(DATA_DIR, 'healix-db.json');
const SQLITE_FILE = path.join(DATA_DIR, 'healix.sqlite');
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_JSON_BYTES = 10 * 1024 * 1024;
const MAX_FILE_BYTES = 6 * 1024 * 1024;

for (const dir of [DATA_DIR, UPLOAD_DIR]) fs.mkdirSync(dir, { recursive: true });

const id = (prefix = 'id') => `${prefix}_${crypto.randomBytes(9).toString('hex')}`;
const nowIso = () => new Date().toISOString();
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const scrypt = (password, salt) => new Promise((resolve, reject) => {
  crypto.scrypt(password, salt, 64, (err, key) => err ? reject(err) : resolve(key.toString('hex')));
});

let db;
let sqlite;

const TABLES = {
  users: `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, role TEXT NOT NULL, data_json TEXT NOT NULL)`,
  doctors: `CREATE TABLE IF NOT EXISTS doctors (id TEXT PRIMARY KEY, specialty TEXT, city TEXT, data_json TEXT NOT NULL)`,
  sessions: `CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL, data_json TEXT NOT NULL)`,
  medications: `CREATE TABLE IF NOT EXISTS medications (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, active INTEGER NOT NULL DEFAULT 1, data_json TEXT NOT NULL)`,
  medication_logs: `CREATE TABLE IF NOT EXISTS medication_logs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, medication_id TEXT NOT NULL REFERENCES medications(id) ON DELETE CASCADE, log_date TEXT NOT NULL, data_json TEXT NOT NULL)`,
  records: `CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TEXT NOT NULL, data_json TEXT NOT NULL)`,
  record_shares: `CREATE TABLE IF NOT EXISTS record_shares (id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, doctor_id TEXT NOT NULL REFERENCES doctors(id), record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE, expires_at TEXT NOT NULL, revoked_at TEXT, data_json TEXT NOT NULL)`,
  appointments: `CREATE TABLE IF NOT EXISTS appointments (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, doctor_id TEXT NOT NULL REFERENCES doctors(id), appointment_date TEXT NOT NULL, appointment_time TEXT NOT NULL, status TEXT NOT NULL, data_json TEXT NOT NULL)`,
  wellness_logs: `CREATE TABLE IF NOT EXISTS wellness_logs (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, log_date TEXT NOT NULL, data_json TEXT NOT NULL)`,
  audit_logs: `CREATE TABLE IF NOT EXISTS audit_logs (id TEXT PRIMARY KEY, actor_user_id TEXT NOT NULL REFERENCES users(id), patient_id TEXT NOT NULL REFERENCES users(id), record_id TEXT, created_at TEXT NOT NULL, data_json TEXT NOT NULL)`
};
const TABLE_ORDER = ['users', 'doctors', 'sessions', 'medications', 'records', 'wellness_logs', 'appointments', 'medication_logs', 'record_shares', 'audit_logs'];
const TABLE_COLUMNS = {
  users: r => [r.id, r.email, r.role, JSON.stringify(r)],
  doctors: r => [r.id, r.specialty || '', r.city || '', JSON.stringify(r)],
  sessions: r => [r.tokenHash, r.userId, r.expiresAt, JSON.stringify(r)],
  medications: r => [r.id, r.userId, r.active === false ? 0 : 1, JSON.stringify(r)],
  medication_logs: r => [r.id, r.userId, r.medicationId, r.date, JSON.stringify(r)],
  records: r => [r.id, r.userId, r.createdAt, JSON.stringify(r)],
  record_shares: r => [r.id, r.patientId, r.doctorId, r.recordId, r.expiresAt, r.revokedAt || null, JSON.stringify(r)],
  appointments: r => [r.id, r.userId, r.doctorId, r.date, r.time, r.status, JSON.stringify(r)],
  wellness_logs: r => [r.id, r.userId, r.date, JSON.stringify(r)],
  audit_logs: r => [r.id, r.actorUserId, r.patientId, r.recordId, r.createdAt, JSON.stringify(r)]
};
const INSERT_SQL = {
  users: 'INSERT INTO users VALUES (?, ?, ?, ?)', doctors: 'INSERT INTO doctors VALUES (?, ?, ?, ?)',
  sessions: 'INSERT INTO sessions VALUES (?, ?, ?, ?)', medications: 'INSERT INTO medications VALUES (?, ?, ?, ?)',
  medication_logs: 'INSERT INTO medication_logs VALUES (?, ?, ?, ?, ?)', records: 'INSERT INTO records VALUES (?, ?, ?, ?)',
  record_shares: 'INSERT INTO record_shares VALUES (?, ?, ?, ?, ?, ?, ?)', appointments: 'INSERT INTO appointments VALUES (?, ?, ?, ?, ?, ?, ?)',
  wellness_logs: 'INSERT INTO wellness_logs VALUES (?, ?, ?, ?)', audit_logs: 'INSERT INTO audit_logs VALUES (?, ?, ?, ?, ?, ?)'
};
const COLLECTIONS = { users: 'users', doctors: 'doctors', sessions: 'sessions', medications: 'medications', medication_logs: 'medicationLogs', records: 'records', record_shares: 'recordShares', appointments: 'appointments', wellness_logs: 'wellnessLogs', audit_logs: 'auditLogs' };

function openSqlite() {
  sqlite = new DatabaseSync(SQLITE_FILE);
  sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  for (const ddl of Object.values(TABLES)) sqlite.exec(ddl);
  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_appointments_doctor_date ON appointments(doctor_id, appointment_date, appointment_time); CREATE INDEX IF NOT EXISTS idx_medications_user_active ON medications(user_id, active); CREATE INDEX IF NOT EXISTS idx_records_user_created ON records(user_id, created_at); CREATE INDEX IF NOT EXISTS idx_wellness_user_date ON wellness_logs(user_id, log_date); CREATE INDEX IF NOT EXISTS idx_sessions_user_expiry ON sessions(user_id, expires_at);');
}

function loadSqliteState() {
  const state = {};
  for (const [table, collection] of Object.entries(COLLECTIONS)) {
    state[collection] = sqlite.prepare(`SELECT data_json FROM ${table}`).all().map(row => JSON.parse(row.data_json));
  }
  return state;
}

function saveDb() {
  sqlite.exec('BEGIN IMMEDIATE');
  try {
    for (const table of [...TABLE_ORDER].reverse()) sqlite.exec(`DELETE FROM ${table}`);
    for (const table of TABLE_ORDER) {
      const insert = sqlite.prepare(INSERT_SQL[table]);
      const collection = COLLECTIONS[table];
      for (const row of db[collection]) insert.run(...TABLE_COLUMNS[table](row));
    }
    sqlite.exec('COMMIT');
  } catch (error) {
    sqlite.exec('ROLLBACK');
    throw error;
  }
  return Promise.resolve();
}

async function seedDatabase() {
  const doctors = [
    { id: 'doc_asha_mehta', name: 'Dr. Asha Mehta', specialty: 'General Physician', qualification: 'MBBS, MD (General Medicine)', experience: 12, city: 'New Delhi', languages: ['English', 'Hindi'], consultationFee: 600, available: true, bio: 'Primary-care physician profile for the Healix demonstration environment.' },
    { id: 'doc_rahul_verma', name: 'Dr. Rahul Verma', specialty: 'Cardiologist', qualification: 'MBBS, DM (Cardiology)', experience: 15, city: 'New Delhi', languages: ['English', 'Hindi'], consultationFee: 1000, available: true, bio: 'Cardiology profile for demonstration only.' },
    { id: 'doc_nisha_rao', name: 'Dr. Nisha Rao', specialty: 'Dermatologist', qualification: 'MBBS, MD (Dermatology)', experience: 9, city: 'Gurugram', languages: ['English', 'Hindi'], consultationFee: 800, available: true, bio: 'Dermatology profile for demonstration only.' },
    { id: 'doc_samir_khan', name: 'Dr. Samir Khan', specialty: 'Paediatrician', qualification: 'MBBS, DCH', experience: 11, city: 'Noida', languages: ['English', 'Hindi', 'Urdu'], consultationFee: 700, available: true, bio: 'Paediatric profile for demonstration only.' },
    { id: 'doc_meera_iyer', name: 'Dr. Meera Iyer', specialty: 'Dietitian', qualification: 'MSc Clinical Nutrition', experience: 8, city: 'New Delhi', languages: ['English', 'Hindi', 'Tamil'], consultationFee: 500, available: true, bio: 'Nutrition professional profile for demonstration only.' }
  ];
  const empty = { users: [], sessions: [], doctors, medications: [], medicationLogs: [], records: [], recordShares: [], auditLogs: [], appointments: [], wellnessLogs: [] };
  openSqlite();
  const sqliteHasData = sqlite.prepare('SELECT COUNT(*) AS count FROM users').get().count > 0;
  if (sqliteHasData) {
    db = { ...empty, ...loadSqliteState() };
    if (!Array.isArray(db.doctors) || db.doctors.length === 0) db.doctors = doctors;
  } else if (fs.existsSync(LEGACY_DB_FILE)) {
    try {
      const parsed = JSON.parse(await fs.promises.readFile(LEGACY_DB_FILE, 'utf8'));
      db = { ...empty, ...parsed };
      if (!Array.isArray(db.doctors) || db.doctors.length === 0) db.doctors = doctors;
      if (!Array.isArray(db.recordShares)) db.recordShares = [];
      if (!Array.isArray(db.auditLogs)) db.auditLogs = [];
      console.log('Migrating existing Healix JSON data into SQLite...');
    } catch {
      const backup = `${LEGACY_DB_FILE}.corrupt-${Date.now()}`;
      await fs.promises.rename(LEGACY_DB_FILE, backup);
      db = empty;
    }
  } else {
    db = empty;
  }

  if (!db.users.some(u => u.email === 'demo@healix.health')) {
    const salt = crypto.randomBytes(16).toString('hex');
    db.users.push({
      id: 'usr_demo_patient', name: 'Aarav Sharma', email: 'demo@healix.health', role: 'patient', salt,
      passwordHash: await scrypt('Healix123!', salt), createdAt: nowIso(),
      profile: { phone: '+91 90000 10001', dateOfBirth: '1989-05-18', bloodGroup: 'O+', city: 'New Delhi', emergencyContact: 'Ananya Sharma · +91 90000 10002', allergies: 'No known allergies', conditions: 'Seasonal allergies', notes: 'Demo profile. Replace with your own information.' }
    });
    db.medications.push(
      { id: 'med_demo_1', userId: 'usr_demo_patient', name: 'Vitamin D3', strength: '1000 IU', dose: '1 tablet', times: ['08:00'], instructions: 'Example reminder only. Follow your own clinician-issued prescription.', startDate: today(), endDate: '', active: true, createdAt: nowIso() },
      { id: 'med_demo_2', userId: 'usr_demo_patient', name: 'Medicine reminder example', strength: 'As prescribed', dose: 'As prescribed', times: ['20:00'], instructions: 'Demonstration entry — not a medical recommendation.', startDate: today(), endDate: '', active: true, createdAt: nowIso() }
    );
    db.appointments.push({ id: 'apt_demo_1', userId: 'usr_demo_patient', doctorId: doctors[0].id, date: today(), time: '10:30', reason: 'Routine follow-up (demo booking)', status: 'confirmed', createdAt: nowIso(), demo: true });
  }

  if (!db.users.some(u => u.email === 'doctor@healix.health')) {
    const salt = crypto.randomBytes(16).toString('hex');
    db.users.push({ id: 'usr_demo_doctor', name: 'Dr. Asha Mehta', email: 'doctor@healix.health', role: 'doctor', doctorId: 'doc_asha_mehta', salt, passwordHash: await scrypt('Doctor123!', salt), createdAt: nowIso(), profile: {} });
  }
  // Keep imported legacy data referentially consistent before writing to SQLite.
  const userIds = new Set(db.users.map(x => x.id));
  const doctorIds = new Set(db.doctors.map(x => x.id));
  db.sessions = db.sessions.filter(x => userIds.has(x.userId));
  db.medications = db.medications.filter(x => userIds.has(x.userId));
  const medicationIds = new Set(db.medications.map(x => x.id));
  db.medicationLogs = db.medicationLogs.filter(x => userIds.has(x.userId) && medicationIds.has(x.medicationId));
  db.records = db.records.filter(x => userIds.has(x.userId));
  const recordIds = new Set(db.records.map(x => x.id));
  db.recordShares = db.recordShares.filter(x => userIds.has(x.patientId) && doctorIds.has(x.doctorId) && recordIds.has(x.recordId));
  db.appointments = db.appointments.filter(x => userIds.has(x.userId) && doctorIds.has(x.doctorId));
  db.wellnessLogs = db.wellnessLogs.filter(x => userIds.has(x.userId));
  db.auditLogs = db.auditLogs.filter(x => userIds.has(x.actorUserId) && userIds.has(x.patientId));
  await saveDb();
  console.log(`Healix SQLite database ready: ${SQLITE_FILE}`);
}

function sendJson(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}
function fail(res, status, message, code = 'request_error') { sendJson(res, status, { error: message, code }); }

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map(part => part.trim()).filter(Boolean).map(part => {
    const i = part.indexOf('=');
    return i < 0 ? [part, ''] : [part.slice(0, i), decodeURIComponent(part.slice(i + 1))];
  }));
}

async function readJson(req, maxBytes = MAX_JSON_BYTES) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error('Request body is too large.'), { status: 413 });
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Please send valid JSON.'), { status: 400 }); }
}

function safeText(value, max = 500) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, max);
}
function validEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').toLowerCase()); }
function userById(userId) { return db.users.find(u => u.id === userId); }
function publicUser(user) { return { id: user.id, name: user.name, email: user.email, role: user.role, profile: user.profile || {} }; }

function cookieHeader(token, clear = false) {
  const parts = [`cn_session=${clear ? '' : encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  parts.push(`Max-Age=${clear ? 0 : Math.floor(SESSION_TTL_MS / 1000)}`);
  if (IS_PROD) parts.push('Secure');
  return parts.join('; ');
}

async function createSession(user, res) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.sessions = db.sessions.filter(s => new Date(s.expiresAt).getTime() > Date.now());
  db.sessions.push({ tokenHash: sha256(token), userId: user.id, expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString() });
  await saveDb();
  res.setHeader('Set-Cookie', cookieHeader(token));
}

function authenticatedUser(req) {
  const token = parseCookies(req.headers.cookie).cn_session;
  if (!token) return null;
  const tokenHash = sha256(token);
  const session = db.sessions.find(s => s.tokenHash === tokenHash && new Date(s.expiresAt).getTime() > Date.now());
  return session ? userById(session.userId) : null;
}

function requirePatient(user, res) {
  if (!user) { fail(res, 401, 'Please sign in to continue.', 'unauthenticated'); return false; }
  if (user.role !== 'patient') { fail(res, 403, 'This area is available to patient accounts.'); return false; }
  return true;
}
function requireDoctor(user, res) {
  if (!user) { fail(res, 401, 'Please sign in to continue.', 'unauthenticated'); return false; }
  if (user.role !== 'doctor') { fail(res, 403, 'This area is available to verified doctor accounts.'); return false; }
  return true;
}

function checkSameOrigin(req, res) {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser clients may omit Origin; cookie auth still applies.
  try {
    const parsed = new URL(origin);
    if (parsed.host !== req.headers.host) { fail(res, 403, 'Cross-origin requests are not allowed.'); return false; }
    return true;
  } catch { fail(res, 403, 'Invalid request origin.'); return false; }
}

const MIME_EXT = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png' };
function userRecord(record, userId) { return record && record.userId === userId; }

async function handleApi(req, res, url) {
  const method = req.method;
  const p = url.pathname;
  const user = authenticatedUser(req);
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && !checkSameOrigin(req, res)) return;

  if (p === '/api/health' && method === 'GET') return sendJson(res, 200, { ok: true, name: 'Healix API', database: 'sqlite', time: nowIso() });
  if (p === '/api/integrations/toughtongue' && method === 'GET') {
    const scenarioId = safeText(process.env.TTAI_SCENARIO_ID || '6afc73158b20fba3b1cbc1ce', 100);
    const configuredUrl = safeText(process.env.TTAI_RUN_URL || '', 1000);
    let launchUrl = `https://app.toughtongueai.com/run/${encodeURIComponent(scenarioId)}`;
    if (configuredUrl) {
      try {
        const candidate = new URL(configuredUrl);
        if (candidate.protocol === 'https:') launchUrl = candidate.toString();
      } catch {}
    }
    return sendJson(res, 200, {
      provider: 'Tough Tongue AI',
      configured: Boolean(scenarioId),
      scenarioName: 'Healix AI — 24/7 Healthcare Voice Assistant',
      scenarioId,
      launchUrl,
      mode: 'hosted-scenario',
      note: 'The voice session runs on Tough Tongue AI. Healix does not send patient records or profile data to the agent.'
    });
  }
  if (p === '/api/auth/register' && method === 'POST') {
    const body = await readJson(req);
    const name = safeText(body.name, 80);
    const email = safeText(body.email, 160).toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';
    if (name.length < 2) return fail(res, 400, 'Please enter your full name.');
    if (!validEmail(email)) return fail(res, 400, 'Please enter a valid email address.');
    if (password.length < 10 || password.length > 200) return fail(res, 400, 'Use a password between 10 and 200 characters.');
    if (db.users.some(u => u.email === email)) return fail(res, 409, 'An account with this email already exists.');
    const salt = crypto.randomBytes(16).toString('hex');
    const account = { id: id('usr'), name, email, role: 'patient', salt, passwordHash: await scrypt(password, salt), createdAt: nowIso(), profile: { phone: '', dateOfBirth: '', bloodGroup: '', city: '', emergencyContact: '', allergies: '', conditions: '', notes: '' } };
    db.users.push(account);
    await createSession(account, res);
    return sendJson(res, 201, { user: publicUser(account) });
  }
  if (p === '/api/auth/login' && method === 'POST') {
    const body = await readJson(req);
    const email = safeText(body.email, 160).toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';
    const account = db.users.find(u => u.email === email);
    if (!account || !crypto.timingSafeEqual(Buffer.from(await scrypt(password, account.salt)), Buffer.from(account.passwordHash))) return fail(res, 401, 'Email or password is incorrect.', 'invalid_credentials');
    await createSession(account, res);
    return sendJson(res, 200, { user: publicUser(account) });
  }
  if (p === '/api/auth/logout' && method === 'POST') {
    const token = parseCookies(req.headers.cookie).cn_session;
    if (token) db.sessions = db.sessions.filter(s => s.tokenHash !== sha256(token));
    await saveDb();
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader('', true) });
  }
  if (p === '/api/me' && method === 'GET') return user ? sendJson(res, 200, { user: publicUser(user) }) : fail(res, 401, 'Not signed in.', 'unauthenticated');

  if (!user) return fail(res, 401, 'Please sign in to continue.', 'unauthenticated');

  if (p === '/api/profile' && method === 'GET') {
    if (!requirePatient(user, res)) return;
    return sendJson(res, 200, { profile: user.profile || {} });
  }
  if (p === '/api/profile' && method === 'PATCH') {
    if (!requirePatient(user, res)) return;
    const body = await readJson(req);
    const fields = ['phone', 'dateOfBirth', 'bloodGroup', 'city', 'emergencyContact', 'allergies', 'conditions', 'notes'];
    for (const field of fields) user.profile[field] = safeText(body[field], field === 'notes' ? 1000 : 240);
    await saveDb();
    return sendJson(res, 200, { profile: user.profile });
  }

  if (p === '/api/doctors' && method === 'GET') {
    const q = safeText(url.searchParams.get('q') || '', 80).toLowerCase();
    const specialty = safeText(url.searchParams.get('specialty') || '', 80).toLowerCase();
    const list = db.doctors.filter(d => (!q || `${d.name} ${d.specialty} ${d.city}`.toLowerCase().includes(q)) && (!specialty || d.specialty.toLowerCase() === specialty));
    return sendJson(res, 200, { doctors: list });
  }

  if (p === '/api/dashboard' && method === 'GET') {
    if (!requirePatient(user, res)) return;
    const medications = db.medications.filter(m => m.userId === user.id && m.active);
    const appointments = db.appointments.filter(a => a.userId === user.id && ['pending', 'confirmed'].includes(a.status)).sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));
    const records = db.records.filter(r => r.userId === user.id);
    const logsToday = db.medicationLogs.filter(l => l.userId === user.id && l.date === today());
    return sendJson(res, 200, { stats: { activeMedications: medications.length, upcomingAppointments: appointments.length, savedReports: records.length, dosesLoggedToday: logsToday.length }, medications, appointments: appointments.slice(0, 3), doctors: db.doctors.slice(0, 3) });
  }

  if (p === '/api/medications' && method === 'GET') {
    if (!requirePatient(user, res)) return;
    const meds = db.medications.filter(m => m.userId === user.id).map(m => ({ ...m, takenToday: db.medicationLogs.filter(l => l.medicationId === m.id && l.date === today()).map(l => l.time) }));
    return sendJson(res, 200, { medications: meds });
  }
  if (p === '/api/medications' && method === 'POST') {
    if (!requirePatient(user, res)) return;
    const body = await readJson(req);
    const name = safeText(body.name, 100);
    const times = Array.isArray(body.times) ? body.times.map(t => safeText(t, 5)).filter(t => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)).slice(0, 8) : [];
    if (!name) return fail(res, 400, 'Enter the medicine name.');
    if (!safeText(body.dose, 100)) return fail(res, 400, 'Enter the dosage exactly as instructed by your clinician.');
    if (!times.length) return fail(res, 400, 'Add at least one reminder time.');
    const med = { id: id('med'), userId: user.id, name, strength: safeText(body.strength, 80), dose: safeText(body.dose, 100), times: [...new Set(times)].sort(), instructions: safeText(body.instructions, 500), startDate: safeText(body.startDate, 10), endDate: safeText(body.endDate, 10), active: true, createdAt: nowIso() };
    db.medications.push(med); await saveDb(); return sendJson(res, 201, { medication: med });
  }
  const medTaken = p.match(/^\/api\/medications\/([^/]+)\/taken$/);
  if (medTaken && method === 'POST') {
    if (!requirePatient(user, res)) return;
    const med = db.medications.find(m => m.id === medTaken[1] && m.userId === user.id && m.active);
    if (!med) return fail(res, 404, 'Medicine reminder not found.');
    const body = await readJson(req, 20_000);
    const time = safeText(body.time, 5);
    if (!med.times.includes(time)) return fail(res, 400, 'That time is not part of this reminder.');
    const existing = db.medicationLogs.find(l => l.medicationId === med.id && l.date === today() && l.time === time);
    if (existing) return fail(res, 409, 'This reminder has already been marked for today.');
    const log = { id: id('dose'), userId: user.id, medicationId: med.id, date: today(), time, loggedAt: nowIso() };
    db.medicationLogs.push(log); await saveDb(); return sendJson(res, 201, { log });
  }
  const medDelete = p.match(/^\/api\/medications\/([^/]+)$/);
  if (medDelete && method === 'DELETE') {
    if (!requirePatient(user, res)) return;
    const med = db.medications.find(m => m.id === medDelete[1] && m.userId === user.id);
    if (!med) return fail(res, 404, 'Medicine reminder not found.');
    med.active = false; await saveDb(); return sendJson(res, 200, { ok: true });
  }

  if (p === '/api/records' && method === 'GET') {
    if (!requirePatient(user, res)) return;
    const records = db.records.filter(r => r.userId === user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(({ storedName, ...r }) => r);
    return sendJson(res, 200, { records });
  }
  if (p === '/api/records' && method === 'POST') {
    if (!requirePatient(user, res)) return;
    const body = await readJson(req, MAX_JSON_BYTES);
    const name = safeText(body.name, 120);
    const category = safeText(body.category, 50) || 'Other';
    const mime = safeText(body.mimeType, 50).toLowerCase();
    const base64 = typeof body.dataBase64 === 'string' ? body.dataBase64 : '';
    if (!name || !MIME_EXT[mime]) return fail(res, 400, 'Add a name and choose a PDF, JPG or PNG file.');
    const data = Buffer.from(base64.replace(/^data:[^;]+;base64,/, ''), 'base64');
    if (!data.length || data.length > MAX_FILE_BYTES) return fail(res, 413, 'Files must be between 1 byte and 6 MB.');
    const isPdf = mime === 'application/pdf' && data.subarray(0, 5).toString('ascii') === '%PDF-';
    const isPng = mime === 'image/png' && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const isJpeg = mime === 'image/jpeg' && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
    if (!(isPdf || isPng || isJpeg)) return fail(res, 400, 'The file contents do not match the selected PDF, JPG or PNG type.');
    const storedName = `${crypto.randomBytes(18).toString('hex')}${MIME_EXT[mime]}`;
    await fs.promises.writeFile(path.join(UPLOAD_DIR, storedName), data, { flag: 'wx', mode: 0o600 });
    const record = { id: id('rec'), userId: user.id, name, category, mimeType: mime, size: data.length, storedName, createdAt: nowIso() };
    db.records.push(record); await saveDb();
    const { storedName: _stored, ...safeRecord } = record;
    return sendJson(res, 201, { record: safeRecord });
  }
  const recordDownload = p.match(/^\/api\/records\/([^/]+)\/download$/);
  if (recordDownload && method === 'GET') {
    if (!requirePatient(user, res)) return;
    const record = db.records.find(r => r.id === recordDownload[1] && userRecord(r, user.id));
    if (!record) return fail(res, 404, 'Report not found.');
    const fullPath = path.join(UPLOAD_DIR, path.basename(record.storedName));
    if (!fs.existsSync(fullPath)) return fail(res, 404, 'The stored file is unavailable.');
    const data = await fs.promises.readFile(fullPath);
    const safeDownloadName = `healix-report${MIME_EXT[record.mimeType] || '.bin'}`;
    res.writeHead(200, { 'Content-Type': record.mimeType, 'Content-Length': data.length, 'Content-Disposition': `attachment; filename="${safeDownloadName}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    return res.end(data);
  }
  const recordDelete = p.match(/^\/api\/records\/([^/]+)$/);
  if (recordDelete && method === 'DELETE') {
    if (!requirePatient(user, res)) return;
    const index = db.records.findIndex(r => r.id === recordDelete[1] && userRecord(r, user.id));
    if (index < 0) return fail(res, 404, 'Report not found.');
    const [record] = db.records.splice(index, 1);
    db.recordShares = db.recordShares.filter(share => share.recordId !== record.id);
    await fs.promises.rm(path.join(UPLOAD_DIR, path.basename(record.storedName)), { force: true });
    await saveDb(); return sendJson(res, 200, { ok: true });
  }
  if (p === '/api/record-shares' && method === 'GET') {
    if (!requirePatient(user, res)) return;
    const shares = db.recordShares.filter(s => s.patientId === user.id).map(s => ({ ...s, doctor: db.doctors.find(d => d.id === s.doctorId) || null, record: db.records.find(r => r.id === s.recordId) ? { id: db.records.find(r => r.id === s.recordId).id, name: db.records.find(r => r.id === s.recordId).name, category: db.records.find(r => r.id === s.recordId).category } : null, active: !s.revokedAt && new Date(s.expiresAt).getTime() > Date.now() }));
    return sendJson(res, 200, { shares });
  }
  const recordShareCreate = p.match(/^\/api\/records\/([^/]+)\/share$/);
  if (recordShareCreate && method === 'POST') {
    if (!requirePatient(user, res)) return;
    const record = db.records.find(r => r.id === recordShareCreate[1] && r.userId === user.id);
    if (!record) return fail(res, 404, 'Report not found.');
    const body = await readJson(req, 20_000);
    const doctor = db.doctors.find(d => d.id === body.doctorId);
    const expiryHours = Number(body.expiryHours || 24);
    if (!doctor) return fail(res, 400, 'Choose a listed doctor.');
    if (!Number.isInteger(expiryHours) || expiryHours < 1 || expiryHours > 168) return fail(res, 400, 'Choose an expiry between 1 and 168 hours.');
    const share = { id: id('shr'), patientId: user.id, doctorId: doctor.id, recordId: record.id, createdAt: nowIso(), expiresAt: new Date(Date.now() + expiryHours * 60 * 60 * 1000).toISOString(), revokedAt: null };
    db.recordShares.push(share); await saveDb();
    return sendJson(res, 201, { share: { ...share, doctor: { id: doctor.id, name: doctor.name }, record: { id: record.id, name: record.name } } });
  }
  const shareRevoke = p.match(/^\/api\/record-shares\/([^/]+)\/revoke$/);
  if (shareRevoke && method === 'PATCH') {
    if (!requirePatient(user, res)) return;
    const share = db.recordShares.find(s => s.id === shareRevoke[1] && s.patientId === user.id);
    if (!share) return fail(res, 404, 'Sharing permission not found.');
    share.revokedAt = nowIso(); await saveDb(); return sendJson(res, 200, { ok: true });
  }

  if (p === '/api/appointments' && method === 'GET') {
    if (!requirePatient(user, res)) return;
    const appointments = db.appointments.filter(a => a.userId === user.id).sort((a, b) => `${b.date}T${b.time}`.localeCompare(`${a.date}T${a.time}`)).map(a => ({ ...a, doctor: db.doctors.find(d => d.id === a.doctorId) || null }));
    return sendJson(res, 200, { appointments });
  }
  if (p === '/api/appointments' && method === 'POST') {
    if (!requirePatient(user, res)) return;
    const body = await readJson(req);
    const doctor = db.doctors.find(d => d.id === body.doctorId);
    const date = safeText(body.date, 10); const time = safeText(body.time, 5);
    if (!doctor) return fail(res, 400, 'Choose a listed doctor.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return fail(res, 400, 'Choose a valid date and time.');
    const requested = new Date(`${date}T${time}:00`);
    if (Number.isNaN(requested.getTime()) || requested.getTime() < Date.now() + 30 * 60 * 1000) return fail(res, 400, 'Choose a future appointment at least 30 minutes from now.');
    if (requested.getTime() > Date.now() + 90 * 24 * 60 * 60 * 1000) return fail(res, 400, 'Appointments can be requested up to 90 days ahead.');
    const conflict = db.appointments.some(a => a.doctorId === doctor.id && a.date === date && a.time === time && ['pending', 'confirmed'].includes(a.status));
    if (conflict) return fail(res, 409, 'That demonstration time is already requested. Please choose another time.');
    const appointment = { id: id('apt'), userId: user.id, doctorId: doctor.id, date, time, reason: safeText(body.reason, 500), status: 'pending', createdAt: nowIso(), demo: true };
    db.appointments.push(appointment); await saveDb(); return sendJson(res, 201, { appointment: { ...appointment, doctor } });
  }
  const appointmentCancel = p.match(/^\/api\/appointments\/([^/]+)\/cancel$/);
  if (appointmentCancel && method === 'PATCH') {
    if (!requirePatient(user, res)) return;
    const appointment = db.appointments.find(a => a.id === appointmentCancel[1] && a.userId === user.id);
    if (!appointment) return fail(res, 404, 'Appointment not found.');
    if (!['pending', 'confirmed'].includes(appointment.status)) return fail(res, 409, 'This appointment can no longer be cancelled.');
    appointment.status = 'cancelled'; await saveDb(); return sendJson(res, 200, { appointment });
  }

  if (p === '/api/wellness' && method === 'GET') {
    if (!requirePatient(user, res)) return;
    const logs = db.wellnessLogs.filter(l => l.userId === user.id).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);
    return sendJson(res, 200, { logs });
  }
  if (p === '/api/wellness' && method === 'POST') {
    if (!requirePatient(user, res)) return;
    const body = await readJson(req);
    const numeric = (v, min, max) => v === '' || v === null || v === undefined ? null : Number.isFinite(Number(v)) && Number(v) >= min && Number(v) <= max ? Number(v) : NaN;
    const waterMl = numeric(body.waterMl, 0, 10000);
    const steps = numeric(body.steps, 0, 100000);
    const calories = numeric(body.calories, 0, 15000);
    if ([waterMl, steps, calories].some(Number.isNaN)) return fail(res, 400, 'Please enter realistic numeric values.');
    const log = { id: id('well'), userId: user.id, date: today(), waterMl, steps, calories, note: safeText(body.note, 300), createdAt: nowIso() };
    db.wellnessLogs.push(log); await saveDb(); return sendJson(res, 201, { log });
  }

  if (p === '/api/doctor/shared-records' && method === 'GET') {
    if (!requireDoctor(user, res)) return;
    const shared = db.recordShares.filter(s => s.doctorId === user.doctorId && !s.revokedAt && new Date(s.expiresAt).getTime() > Date.now()).map(s => {
      const record = db.records.find(r => r.id === s.recordId && r.userId === s.patientId);
      const patient = userById(s.patientId);
      return record && patient ? { shareId: s.id, expiresAt: s.expiresAt, createdAt: s.createdAt, record: { id: record.id, name: record.name, category: record.category, mimeType: record.mimeType, size: record.size }, patient: { name: patient.name, email: patient.email } } : null;
    }).filter(Boolean);
    return sendJson(res, 200, { sharedRecords: shared });
  }
  const doctorSharedDownload = p.match(/^\/api\/doctor\/shared-records\/([^/]+)\/download$/);
  if (doctorSharedDownload && method === 'GET') {
    if (!requireDoctor(user, res)) return;
    const share = db.recordShares.find(s => s.id === doctorSharedDownload[1] && s.doctorId === user.doctorId && !s.revokedAt && new Date(s.expiresAt).getTime() > Date.now());
    if (!share) return fail(res, 404, 'This patient sharing permission is unavailable, expired or revoked.');
    const record = db.records.find(r => r.id === share.recordId && r.userId === share.patientId);
    if (!record) return fail(res, 404, 'The shared report is unavailable.');
    const fullPath = path.join(UPLOAD_DIR, path.basename(record.storedName));
    if (!fs.existsSync(fullPath)) return fail(res, 404, 'The stored file is unavailable.');
    const data = await fs.promises.readFile(fullPath);
    db.auditLogs.push({ id: id('audit'), actorUserId: user.id, patientId: share.patientId, recordId: record.id, action: 'doctor_downloaded_shared_record', createdAt: nowIso() });
    await saveDb();
    res.writeHead(200, { 'Content-Type': record.mimeType, 'Content-Length': data.length, 'Content-Disposition': `attachment; filename="healix-shared-report${MIME_EXT[record.mimeType] || '.bin'}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    return res.end(data);
  }

  if (p === '/api/doctor/appointments' && method === 'GET') {
    if (!requireDoctor(user, res)) return;
    const appointments = db.appointments.filter(a => a.doctorId === user.doctorId).sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`)).map(a => ({ ...a, patient: userById(a.userId) ? { name: userById(a.userId).name, email: userById(a.userId).email } : null }));
    return sendJson(res, 200, { appointments });
  }
  const doctorAppointment = p.match(/^\/api\/doctor\/appointments\/([^/]+)$/);
  if (doctorAppointment && method === 'PATCH') {
    if (!requireDoctor(user, res)) return;
    const body = await readJson(req, 20_000);
    if (!['confirmed', 'completed', 'declined'].includes(body.status)) return fail(res, 400, 'Choose a valid appointment status.');
    const appointment = db.appointments.find(a => a.id === doctorAppointment[1] && a.doctorId === user.doctorId);
    if (!appointment) return fail(res, 404, 'Appointment not found.');
    if (appointment.status === 'cancelled') return fail(res, 409, 'Cancelled appointments cannot be changed.');
    appointment.status = body.status; await saveDb(); return sendJson(res, 200, { appointment });
  }

  return fail(res, 404, 'API endpoint not found.', 'not_found');
}

const CONTENT_TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon' };
async function serveStatic(req, res, url) {
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { return fail(res, 400, 'Invalid URL path.'); }
  if (pathname === '/') pathname = '/index.html';
  const target = path.resolve(PUBLIC_DIR, `.${pathname}`);
  if (!target.startsWith(PUBLIC_DIR + path.sep) && target !== path.join(PUBLIC_DIR, 'index.html')) return fail(res, 403, 'Forbidden.');
  try {
    const stat = await fs.promises.stat(target);
    if (!stat.isFile()) return fail(res, 404, 'Not found.');
    const data = await fs.promises.readFile(target);
    res.writeHead(200, { 'Content-Type': CONTENT_TYPES[path.extname(target)] || 'application/octet-stream', 'Content-Length': data.length, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    return res.end(data);
  } catch { return fail(res, 404, 'Not found.'); }
}

const loginAttempts = new Map();
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(self), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Allow': 'GET,POST,PUT,PATCH,DELETE,OPTIONS' }); return res.end(); }
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) {
      if (url.pathname === '/api/auth/login') {
        const ip = req.socket.remoteAddress || 'unknown';
        const entry = loginAttempts.get(ip) || { count: 0, reset: Date.now() + 15 * 60 * 1000 };
        if (Date.now() > entry.reset) { entry.count = 0; entry.reset = Date.now() + 15 * 60 * 1000; }
        if (entry.count >= 12) return fail(res, 429, 'Too many sign-in attempts. Please try again later.');
        loginAttempts.set(ip, entry);
      }
      await handleApi(req, res, url);
      if (url.pathname === '/api/auth/login' && res.statusCode === 401) {
        const ip = req.socket.remoteAddress || 'unknown'; const entry = loginAttempts.get(ip); if (entry) entry.count++;
      }
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405, 'Method not allowed.');
    return await serveStatic(req, res, url);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) fail(res, err.status || 500, err.status ? err.message : 'Something went wrong. Please try again.', 'server_error');
    else res.end();
  }
});

seedDatabase().then(() => {
  server.listen(PORT, HOST, () => {
    console.log(`Healix is running at http://${HOST}:${PORT}`);
    console.log('Demo patient: demo@healix.health / Healix123!');
    console.log('Demo doctor: doctor@healix.health / Doctor123!');
    console.log('Demo data is fictional. Do not enter real patient information.');
  });
}).catch(err => { console.error('Could not initialise Healix:', err); process.exit(1); });

function shutdown() {
  server.close(() => {
    try { sqlite?.close(); } catch {}
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
