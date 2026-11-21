'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

let tempDir;
let child;
let baseUrl;
let patientCookie = '';
let doctorCookie = '';

async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try { const response = await fetch(`${baseUrl}/api/health`); if (response.ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error('Test server did not start.');
}
async function request(endpoint, { method = 'GET', body, cookie = '' } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(`${baseUrl}${endpoint}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const payload = (response.headers.get('content-type') || '').includes('application/json') ? await response.json() : await response.arrayBuffer();
  return { response, payload };
}

 test('Healix patient and doctor workflows work end-to-end', async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'healix-test-'));
  await fs.mkdir(path.join(tempDir, 'data'), { recursive: true });
  await fs.writeFile(path.join(tempDir, 'data', 'healix-db.json'), JSON.stringify({ wellnessLogs: [{ id: 'legacy_wellness_1', userId: 'usr_demo_patient', date: '2026-11-20', water: 6, steps: 1000 }] }));
  await fs.cp(path.join(__dirname, '..', 'server.js'), path.join(tempDir, 'server.js'));
  await fs.cp(path.join(__dirname, '..', 'public'), path.join(tempDir, 'public'), { recursive: true });
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['server.js'], { cwd: tempDir, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', TZ: 'Asia/Kolkata' }, stdio: 'ignore' });
  await waitForServer();

  const health = await request('/api/health');
  assert.equal(health.payload.database, 'sqlite');
  const sqlitePath = path.join(tempDir, 'data', 'healix.sqlite');
  assert.ok((await fs.stat(sqlitePath)).isFile(), 'SQLite database file should be created');
  const sqlite = new DatabaseSync(sqlitePath);
  const tableNames = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map(row => row.name);
  for (const table of ['users', 'sessions', 'doctors', 'medications', 'medication_logs', 'records', 'record_shares', 'appointments', 'wellness_logs', 'audit_logs']) assert.ok(tableNames.includes(table), `missing SQLite table: ${table}`);
  assert.ok(sqlite.prepare('SELECT COUNT(*) AS count FROM doctors').get().count >= 5);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM wellness_logs WHERE id = 'legacy_wellness_1'").get().count, 1, 'legacy JSON data should migrate into SQLite');
  assert.ok((await fs.stat(path.join(tempDir, 'data', 'healix-db.json'))).isFile(), 'legacy JSON should be retained as a backup');
  sqlite.close();

  const ttai = await request('/api/integrations/toughtongue');
  assert.equal(ttai.response.status, 200);
  assert.equal(ttai.payload.provider, 'Tough Tongue AI');
  assert.equal(ttai.payload.scenarioId, '6afc73158b20fba3b1cbc1ce');
  assert.match(ttai.payload.launchUrl, /^https:\/\/app\.toughtongueai\.com\/run\//);

  const register = await request('/api/auth/register', { method: 'POST', body: { name: 'Test Patient', email: 'test.patient@example.com', password: 'secure-test-password-123' } });
  assert.equal(register.response.status, 201);
  patientCookie = register.response.headers.get('set-cookie').split(';')[0];
  const me = await request('/api/me', { cookie: patientCookie });
  assert.equal(me.payload.user.email, 'test.patient@example.com');

  const profile = await request('/api/profile', { method: 'PATCH', cookie: patientCookie, body: { city: 'New Delhi', allergies: 'Demo allergy' } });
  assert.equal(profile.response.status, 200);
  assert.equal(profile.payload.profile.city, 'New Delhi');

  const med = await request('/api/medications', { method: 'POST', cookie: patientCookie, body: { name: 'Example reminder', dose: '1 tablet', times: ['08:00'] } });
  assert.equal(med.response.status, 201);
  const dose = await request(`/api/medications/${med.payload.medication.id}/taken`, { method: 'POST', cookie: patientCookie, body: { time: '08:00' } });
  assert.equal(dose.response.status, 201);
  const duplicateDose = await request(`/api/medications/${med.payload.medication.id}/taken`, { method: 'POST', cookie: patientCookie, body: { time: '08:00' } });
  assert.equal(duplicateDose.response.status, 409);

  const pdf = Buffer.from('%PDF-1.4\nHealix test fixture\n').toString('base64');
  const uploaded = await request('/api/records', { method: 'POST', cookie: patientCookie, body: { name: 'Test report.pdf', category: 'Lab report', mimeType: 'application/pdf', dataBase64: pdf } });
  assert.equal(uploaded.response.status, 201);
  const share = await request(`/api/records/${uploaded.payload.record.id}/share`, { method: 'POST', cookie: patientCookie, body: { doctorId: 'doc_asha_mehta', expiryHours: 24 } });
  assert.equal(share.response.status, 201);

  const appointmentDate = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const appointment = await request('/api/appointments', { method: 'POST', cookie: patientCookie, body: { doctorId: 'doc_asha_mehta', date: appointmentDate, time: '11:00', reason: 'Demo request' } });
  assert.equal(appointment.response.status, 201);

  const doctorLogin = await request('/api/auth/login', { method: 'POST', body: { email: 'doctor@healix.health', password: 'Doctor123!' } });
  assert.equal(doctorLogin.response.status, 200);
  doctorCookie = doctorLogin.response.headers.get('set-cookie').split(';')[0];
  const doctorShares = await request('/api/doctor/shared-records', { cookie: doctorCookie });
  assert.equal(doctorShares.response.status, 200);
  assert.equal(doctorShares.payload.sharedRecords.length, 1);
  const download = await fetch(`${baseUrl}/api/doctor/shared-records/${share.payload.share.id}/download`, { headers: { Cookie: doctorCookie } });
  assert.equal(download.status, 200);
  assert.match(Buffer.from(await download.arrayBuffer()).toString('ascii'), /^%PDF-/);

  const inbox = await request('/api/doctor/appointments', { cookie: doctorCookie });
  assert.equal(inbox.response.status, 200);
  const patientRequest = inbox.payload.appointments.find(a => a.reason === 'Demo request');
  assert.ok(patientRequest);
  const confirmed = await request(`/api/doctor/appointments/${patientRequest.id}`, { method: 'PATCH', cookie: doctorCookie, body: { status: 'confirmed' } });
  assert.equal(confirmed.response.status, 200);

  const revoke = await request(`/api/record-shares/${share.payload.share.id}/revoke`, { method: 'PATCH', cookie: patientCookie, body: {} });
  assert.equal(revoke.response.status, 200);
  const denied = await fetch(`${baseUrl}/api/doctor/shared-records/${share.payload.share.id}/download`, { headers: { Cookie: doctorCookie } });
  assert.equal(denied.status, 404);

  const deletedRecord = await request(`/api/records/${uploaded.payload.record.id}`, { method: 'DELETE', cookie: patientCookie });
  assert.equal(deletedRecord.response.status, 200);

  const unauthorised = await request('/api/profile');
  assert.equal(unauthorised.response.status, 401);

  const previousChild = child;
  await new Promise(resolve => { previousChild.once('exit', resolve); previousChild.kill('SIGTERM'); });
  child = spawn(process.execPath, ['server.js'], { cwd: tempDir, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', TZ: 'Asia/Kolkata' }, stdio: 'ignore' });
  await waitForServer();
  const persistedLogin = await request('/api/auth/login', { method: 'POST', body: { email: 'test.patient@example.com', password: 'secure-test-password-123' } });
  assert.equal(persistedLogin.response.status, 200, 'registered patient should persist after server restart');
});

test.after(async () => {
  if (child && !child.killed) child.kill('SIGTERM');
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
});
