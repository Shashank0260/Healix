'use strict';

const state = { user: null, page: 'overview', authMode: 'login', doctors: [], dashboard: null, profile: null, meds: [], appointments: [], records: [], wellness: [], guideMessages: [] };
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
function initials(name) { return String(name || 'CN').split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase(); }
function localDate(d = new Date()) { const year = d.getFullYear(); const month = String(d.getMonth() + 1).padStart(2, '0'); const day = String(d.getDate()).padStart(2, '0'); return `${year}-${month}-${day}`; }
function dateLabel(value, opts = { day: 'numeric', month: 'short', year: 'numeric' }) { if (!value) return 'Not set'; const d = new Date(`${value}T12:00:00`); return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString('en-IN', opts); }
function timeLabel(value) { if (!value) return ''; const [h, m] = value.split(':').map(Number); const d = new Date(); d.setHours(h, m, 0, 0); return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }); }
function money(value) { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value || 0); }
function toast(message, type = 'success') {
  const region = $('#toast-region'); const el = document.createElement('div'); el.className = `toast ${type}`; el.textContent = message; region.appendChild(el); setTimeout(() => el.remove(), 3600);
}
async function api(url, options = {}) {
  const opts = { credentials: 'same-origin', ...options, headers: { ...(options.body && typeof options.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } };
  const response = await fetch(url, opts);
  if (response.status === 204) return {};
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    if (!response.ok) throw new Error(`Request failed (${response.status}).`);
    return response;
  }
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
  return payload;
}
function json(data) { return JSON.stringify(data); }
function setAuthMode(mode) {
  state.authMode = mode;
  const registering = mode === 'register';
  $('#auth-title').textContent = registering ? 'Create your account' : 'Welcome back';
  $('#auth-subtitle').textContent = registering ? 'A calmer place to organise your health.' : 'Sign in to continue to your health space.';
  $('#register-name-wrap').classList.toggle('hidden', !registering);
  $('#auth-name').required = registering;
  $('#auth-password').autocomplete = registering ? 'new-password' : 'current-password';
  $('#auth-submit').innerHTML = registering ? 'Create account <span>→</span>' : 'Sign in <span>→</span>';
  $('#auth-switch-copy').textContent = registering ? 'Already have an account?' : 'New to Healix?';
  $('#auth-switch').textContent = registering ? 'Sign in' : 'Create an account';
  $('#auth-error').textContent = '';
}
function showAuth() { $('#auth-view').classList.remove('hidden'); $('#app-view').classList.add('hidden'); }
function showApp() { $('#auth-view').classList.add('hidden'); $('#app-view').classList.remove('hidden'); }

async function handleAuthSubmit(event) {
  event.preventDefault(); const errorBox = $('#auth-error'); errorBox.textContent = '';
  const body = { email: $('#auth-email').value.trim(), password: $('#auth-password').value };
  if (state.authMode === 'register') body.name = $('#auth-name').value.trim();
  const submit = $('#auth-submit'); submit.disabled = true; submit.textContent = state.authMode === 'register' ? 'Creating your account…' : 'Signing in…';
  try {
    const result = await api(state.authMode === 'register' ? '/api/auth/register' : '/api/auth/login', { method: 'POST', body: json(body) });
    state.user = result.user; await enterApp();
  } catch (err) { errorBox.textContent = err.message; }
  finally { submit.disabled = false; submit.innerHTML = state.authMode === 'register' ? 'Create account <span>→</span>' : 'Sign in <span>→</span>'; }
}
async function demoLogin(role) {
  const patient = role === 'patient';
  $('#auth-email').value = patient ? 'demo@healix.health' : 'doctor@healix.health';
  $('#auth-password').value = patient ? 'Healix123!' : 'Doctor123!';
  $('#auth-error').textContent = '';
  try { const result = await api('/api/auth/login', { method: 'POST', body: json({ email: $('#auth-email').value, password: $('#auth-password').value }) }); state.user = result.user; await enterApp(); }
  catch (err) { $('#auth-error').textContent = err.message; }
}
async function enterApp() {
  showApp();
  $('#top-name').textContent = state.user.name; $('#top-avatar').textContent = initials(state.user.name); $('#top-role').textContent = state.user.role === 'doctor' ? 'Doctor demo account' : 'Patient account';
  $('#main-nav').innerHTML = state.user.role === 'doctor' ? `
    <button class="nav-item active" data-page="overview"><span class="nav-icon">⌂</span><span>Overview</span></button>
    <button class="nav-item" data-page="appointments"><span class="nav-icon">▦</span><span>Patient requests</span></button>
    <button class="nav-item" data-page="shared-records"><span class="nav-icon">▤</span><span>Shared reports</span></button>
  ` : `
    <button class="nav-item active" data-page="overview"><span class="nav-icon">⌂</span><span>Overview</span></button>
    <button class="nav-item" data-page="health"><span class="nav-icon">♡</span><span>My health</span></button>
    <button class="nav-item" data-page="medicines"><span class="nav-icon">✚</span><span>Medicines</span><span class="nav-count" id="nav-medicine-count">0</span></button>
    <button class="nav-item" data-page="appointments"><span class="nav-icon">▦</span><span>Appointments</span></button>
    <button class="nav-item" data-page="doctors"><span class="nav-icon">⚕</span><span>Find a doctor</span></button>
    <button class="nav-item" data-page="records"><span class="nav-icon">▤</span><span>Health records</span></button>
    <button class="nav-item" data-page="wellness"><span class="nav-icon">◉</span><span>Wellbeing</span></button>
    <button class="nav-item" data-page="healix-ai"><span class="nav-icon">◉</span><span>Healix AI</span><span class="nav-new">VOICE</span></button>
    <button class="nav-item" data-page="guide"><span class="nav-icon">✧</span><span>Care Guide</span></button>
  `;
  state.page = 'overview';
  await renderPage();
}
async function logout() {
  try { await api('/api/auth/logout', { method: 'POST', body: '{}' }); } catch {}
  state.user = null; state.page = 'overview'; showAuth(); $('#auth-form').reset(); setAuthMode('login');
}

function setActiveNav() {
  $$('.nav-item').forEach(btn => btn.classList.toggle('active', btn.dataset.page === state.page));
  const titles = { overview: 'Overview', health: 'My health', medicines: 'Medicines', appointments: state.user?.role === 'doctor' ? 'Patient requests' : 'Appointments', doctors: 'Find a doctor', records: 'Health records', wellness: 'Wellbeing', guide: 'Care Guide', 'healix-ai': 'Healix AI', 'shared-records': 'Shared reports' };
  $('#page-title').textContent = titles[state.page] || 'Overview';
  $('#page-content').focus({ preventScroll: true });
  $('#sidebar').classList.remove('open');
}
async function navigate(page) {
  if (state.user?.role === 'doctor' && !['overview', 'appointments', 'shared-records'].includes(page)) page = 'overview';
  state.page = page; setActiveNav(); await renderPage();
}
async function renderPage() {
  setActiveNav(); const root = $('#page-content'); root.innerHTML = '<div class="loading-state">Getting things ready…</div>';
  try {
    if (state.user.role === 'doctor') {
      if (state.page === 'appointments') await renderDoctorAppointments(root); else if (state.page === 'shared-records') await renderDoctorSharedRecords(root); else await renderDoctorOverview(root);
    } else {
      const map = { overview: renderOverview, health: renderHealth, medicines: renderMedicines, appointments: renderAppointments, doctors: renderDoctors, records: renderRecords, wellness: renderWellness, guide: renderGuide, 'healix-ai': renderHealixAI };
      await (map[state.page] || renderOverview)(root);
    }
    const count = state.user.role === 'patient' ? state.meds.filter(m => m.active).length : 0;
    const countNode = $('#nav-medicine-count'); if (countNode) countNode.textContent = count;
  } catch (err) { root.innerHTML = `<div class="card empty-state"><div class="empty-icon">!</div><strong>We couldn't load this section</strong><p>${escapeHtml(err.message)}</p><button class="button button-soft" data-action="retry-page">Try again</button></div>`; }
}
function pageIntro(kicker, title, description, action = '') { return `<div class="page-intro"><div><div class="eyebrow-small">${escapeHtml(kicker)}</div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></div>${action}</div>`; }
function statCard(icon, value, label, color = '') { return `<div class="card stat-card"><div class="stat-icon ${color}">${icon}</div><div><div class="stat-value">${escapeHtml(value)}</div><div class="stat-label">${escapeHtml(label)}</div></div></div>`; }
function emptyState(icon, title, description, action = '') { return `<div class="empty-state"><div class="empty-icon">${icon}</div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(description)}</p>${action}</div>`; }
function badge(status) { const key = String(status || 'pending').toLowerCase(); const label = key.charAt(0).toUpperCase() + key.slice(1); return `<span class="status-pill ${escapeHtml(key)}"><span class="status-dot"></span>${escapeHtml(label)}</span>`; }
function doctorCard(doctor, compact = false) {
  const initialsText = initials(doctor.name);
  return `<div class="${compact ? 'list-row' : 'card'} ${compact ? '' : 'doctor-card'}"><div class="doctor-avatar">${escapeHtml(initialsText)}</div><div class="doctor-info"><strong>${escapeHtml(doctor.name)}</strong><p>${escapeHtml(doctor.specialty)} · ${escapeHtml(doctor.qualification || '')}</p><div class="doctor-meta"><span>⌖ ${escapeHtml(doctor.city)}</span><span>◷ ${doctor.experience} yrs experience</span><span>${money(doctor.consultationFee)}</span></div></div>${compact ? '' : `<div class="card-actions"><button class="button button-primary button-small" data-action="book-doctor" data-id="${escapeHtml(doctor.id)}">Request appointment</button></div>`}</div>`;
}
function medicationRow(med, full = false) {
  const times = (med.times || []).map(t => `<span class="time-chip">${timeLabel(t)}</span>`).join('');
  const taken = med.takenToday || [];
  return `<div class="list-row"><div class="list-icon">✚</div><div class="list-main"><strong>${escapeHtml(med.name)} ${escapeHtml(med.strength || '')}</strong><small>${escapeHtml(med.dose)} · ${times}</small>${full && med.instructions ? `<small>${escapeHtml(med.instructions)}</small>` : ''}</div><div class="list-action">${med.active ? (med.times || []).map(t => taken.includes(t) ? `<span class="status-pill">Done ${timeLabel(t)}</span>` : `<button class="button button-soft button-small" data-action="dose-taken" data-id="${escapeHtml(med.id)}" data-time="${escapeHtml(t)}">Taken · ${timeLabel(t)}</button>`).join(' ') : badge('completed')}</div></div>`;
}
function appointmentRow(a, doctorMode = false) {
  const person = doctorMode ? a.patient?.name || 'Patient' : a.doctor?.name || 'Care professional';
  return `<div class="list-row"><div class="list-icon">▦</div><div class="list-main"><strong>${escapeHtml(person)}</strong><small>${dateLabel(a.date, { day: 'numeric', month: 'short' })} · ${timeLabel(a.time)} · ${escapeHtml(a.reason || 'Consultation')}</small>${doctorMode && a.patient?.email ? `<small>${escapeHtml(a.patient.email)}</small>` : ''}</div><div class="list-action">${badge(a.status)}</div></div>`;
}

async function renderOverview(root) {
  const data = await api('/api/dashboard'); state.dashboard = data; state.meds = data.medications;
  const todayMeds = data.medications.filter(m => m.active).reduce((n, m) => n + (m.times || []).length, 0);
  const upcoming = data.appointments[0];
  root.innerHTML = `
    <section class="hero-card"><div class="hero-copy"><div class="eyebrow">A LITTLE MORE PEACE OF MIND</div><h2>Hello, ${escapeHtml(state.user.name.split(' ')[0])}.<br>Let's take today one step at a time.</h2><p>Your health space brings your reminders, records and care plans together. You don't have to remember everything on your own.</p><button class="button button-primary" data-page="medicines">View today's reminders <span>→</span></button></div><div class="hero-decoration">✳</div></section>
    <div class="grid grid-4">${statCard('✚', data.stats.activeMedications, 'Active medicine reminders')}${statCard('▦', data.stats.upcomingAppointments, 'Upcoming appointments', 'peach')}${statCard('▤', data.stats.savedReports, 'Saved health reports', 'blue')}${statCard('✓', data.stats.dosesLoggedToday, 'Reminders marked today', 'lilac')}</div>
    <div class="grid grid-2" style="margin-top:18px"><section class="card"><div class="card-title-row"><div><h3>Today's medicine reminders</h3><p class="small muted">Only mark a dose after you have taken it.</p></div><button class="section-link" data-page="medicines">See all →</button></div><div class="list-stack">${data.medications.length ? data.medications.filter(m => m.active).slice(0, 4).map(m => medicationRow(m)).join('') : emptyState('✚', 'No reminders yet', 'Add a reminder using the instructions from your healthcare professional.', '<button class="button button-soft button-small" data-action="add-medication">Add a reminder</button>')}</div></section>
    <section class="card"><div class="card-title-row"><div><h3>Your next appointment</h3><p class="small muted">A quick look at what's coming up.</p></div><button class="section-link" data-page="appointments">View all →</button></div>${upcoming ? `<div class="appointment-highlight"><div class="doctor-card"><div class="doctor-avatar">${escapeHtml(initials(upcoming.doctor?.name || 'DR'))}</div><div class="doctor-info"><strong>${escapeHtml(upcoming.doctor?.name || 'Care professional')}</strong><p>${escapeHtml(upcoming.doctor?.specialty || 'Consultation')}</p></div>${badge(upcoming.status)}</div><div class="grid grid-2" style="margin-top:17px"><div class="soft-info"><small>DATE</small><strong>${dateLabel(upcoming.date)}</strong></div><div class="soft-info"><small>TIME</small><strong>${timeLabel(upcoming.time)}</strong></div></div><p class="small muted">${escapeHtml(upcoming.reason || 'Consultation')}</p></div>` : emptyState('▦', 'Nothing scheduled yet', 'Find a doctor and request an appointment when you need one.', '<button class="button button-soft button-small" data-page="doctors">Find a doctor</button>')}</section></div>
    <div class="section-title"><div><h3>Care, made easier</h3><p>Choose what you'd like to do next.</p></div></div><div class="grid grid-3"><button class="card quick-action" data-page="records"><div class="stat-icon blue">▤</div><strong>Organise reports</strong><small>Keep documents together in one place.</small><span>Open records →</span></button><button class="card quick-action" data-page="doctors"><div class="stat-icon peach">⚕</div><strong>Find a care professional</strong><small>Explore the demonstration directory.</small><span>Browse directory →</span></button><button class="card quick-action" data-page="guide"><div class="stat-icon lilac">✧</div><strong>Need help using Healix?</strong><small>Ask the non-clinical Care Guide.</small><span>Open Care Guide →</span></button></div>
    <p class="prototype-footnote">Your dashboard uses sample data. Healix does not verify real-world provider availability or deliver reminders outside this browser session.</p>`;
}

async function renderHealth(root) {
  const { profile } = await api('/api/profile'); state.profile = profile;
  root.innerHTML = `${pageIntro('YOUR INFORMATION', 'My health profile', 'Keep your details current. Share information only with people you trust.', '<button class="button button-outline" data-action="download-summary">Print / Save PDF</button>')}
    <form id="profile-form" class="card"><div class="card-title-row"><h3>Personal details</h3><span class="status-pill">Private to your account</span></div><div class="form-grid"><div class="field-wrap"><label for="profile-name">Full name</label><input id="profile-name" value="${escapeHtml(state.user.name)}" disabled><span class="field-hint">Account name is managed by sign-in details.</span></div><div class="field-wrap"><label for="profile-email">Email address</label><input id="profile-email" value="${escapeHtml(state.user.email)}" disabled></div><div class="field-wrap"><label for="profile-phone">Phone number</label><input id="profile-phone" name="phone" value="${escapeHtml(profile.phone)}" placeholder="Your contact number"></div><div class="field-wrap"><label for="profile-dob">Date of birth</label><input id="profile-dob" name="dateOfBirth" type="date" value="${escapeHtml(profile.dateOfBirth)}"></div><div class="field-wrap"><label for="profile-blood">Blood group (optional)</label><select id="profile-blood" name="bloodGroup"><option value="">Not set</option>${['A+','A-','B+','B-','AB+','AB-','O+','O-'].map(x => `<option ${profile.bloodGroup === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div><div class="field-wrap"><label for="profile-city">City</label><input id="profile-city" name="city" value="${escapeHtml(profile.city)}" placeholder="City"></div><div class="field-wrap span-2"><label for="profile-emergency">Emergency contact (for your reference)</label><input id="profile-emergency" name="emergencyContact" value="${escapeHtml(profile.emergencyContact)}" placeholder="Name and phone number"></div><div class="field-wrap span-2"><label for="profile-allergies">Allergies</label><textarea id="profile-allergies" name="allergies" placeholder="Enter known allergies, or leave blank if not known">${escapeHtml(profile.allergies)}</textarea></div><div class="field-wrap span-2"><label for="profile-conditions">Health conditions / relevant history</label><textarea id="profile-conditions" name="conditions" placeholder="Optional information you want to keep in your personal profile">${escapeHtml(profile.conditions)}</textarea></div><div class="field-wrap span-2"><label for="profile-notes">Additional notes</label><textarea id="profile-notes" name="notes" placeholder="Anything else you want to note">${escapeHtml(profile.notes)}</textarea></div></div><div class="form-actions"><button class="button button-primary" type="submit">Save my profile</button></div></form>
    <div class="card privacy-note" style="margin-top:16px"><div class="stat-icon">♧</div><div><strong>Your information deserves care.</strong><p class="small muted">This local prototype stores profile information on the server running on your computer. It does not yet include production patient-sharing consent, clinician access or certified healthcare data hosting.</p></div></div>`;
}

async function renderMedicines(root) {
  const { medications } = await api('/api/medications'); state.meds = medications;
  const active = medications.filter(m => m.active); const archived = medications.filter(m => !m.active);
  root.innerHTML = `${pageIntro('YOUR DAILY ROUTINE', 'Medicine reminders', 'Keep to the schedule your clinician prescribed. Healix never changes a dosage.', '<button class="button button-primary" data-action="add-medication">＋ Add reminder</button>')}
    <div class="card"><div class="card-title-row"><div><h3>Active reminders</h3><p class="small muted">Mark a scheduled dose only after taking it.</p></div><span class="status-pill">${active.length} active</span></div><div class="list-stack">${active.length ? active.map(m => medicationRow(m, true)).join('') : emptyState('✚','No active reminders','Add a medicine reminder using your clinician-issued instructions.','<button class="button button-soft button-small" data-action="add-medication">Add reminder</button>')}</div></div>
    ${archived.length ? `<div class="section-title"><h3>Archived reminders</h3></div><div class="card"><div class="list-stack">${archived.map(m => `<div class="list-row"><div class="list-icon">✚</div><div class="list-main"><strong>${escapeHtml(m.name)}</strong><small>${escapeHtml(m.dose)}</small></div>${badge('completed')}</div>`).join('')}</div></div>` : ''}
    <div class="safety-callout" style="margin-top:16px"><strong>Important medicine safety note</strong><p>Only add a medicine and dosage that has been recommended by your registered healthcare professional. A reminder is not a prescription. Ask your doctor or pharmacist if you are unsure about the instructions.</p></div>`;
}

async function renderAppointments(root) {
  const { appointments } = await api('/api/appointments'); state.appointments = appointments;
  const future = appointments.filter(a => ['pending','confirmed'].includes(a.status)); const previous = appointments.filter(a => !['pending','confirmed'].includes(a.status));
  root.innerHTML = `${pageIntro('YOUR CARE CONNECTIONS', 'Appointments', 'Keep track of your requests and upcoming consultations.', '<button class="button button-primary" data-page="doctors">＋ Find a doctor</button>')}
    <div class="card"><div class="card-title-row"><div><h3>Upcoming & requested</h3><p class="small muted">Requests in this prototype are stored locally only.</p></div><span class="status-pill">${future.length} upcoming</span></div><div class="list-stack">${future.length ? future.map(a => `<div class="list-row"><div class="list-icon">▦</div><div class="list-main"><strong>${escapeHtml(a.doctor?.name || 'Care professional')}</strong><small>${escapeHtml(a.doctor?.specialty || '')} · ${dateLabel(a.date)} · ${timeLabel(a.time)}</small><small>${escapeHtml(a.reason || 'Consultation')}</small></div><div class="list-action">${badge(a.status)}<button class="button button-quiet button-small" style="margin-top:5px" data-action="cancel-appointment" data-id="${escapeHtml(a.id)}">Cancel</button></div></div>`).join('') : emptyState('▦','No upcoming appointments','Browse the directory to request a time with a care professional.','<button class="button button-soft button-small" data-page="doctors">Find a doctor</button>')}</div></div>
    ${previous.length ? `<div class="section-title"><h3>Past and cancelled</h3></div><div class="card"><div class="list-stack">${previous.map(appointmentRow).join('')}</div></div>` : ''}`;
}

async function renderDoctors(root) {
  const { doctors } = await api('/api/doctors'); state.doctors = doctors;
  const specialties = [...new Set(doctors.map(d => d.specialty))].sort();
  root.innerHTML = `${pageIntro('CARE PROFESSIONAL DIRECTORY', 'Find a doctor', 'Explore sample profiles and request a demonstration appointment. These are not verified, bookable real-world providers.')}
    <div class="filter-row"><div class="search-field"><span>⌕</span><input id="doctor-search" placeholder="Search by name, speciality or city"></div><select class="filter-select" id="doctor-specialty"><option value="">All specialities</option>${specialties.map(s => `<option>${escapeHtml(s)}</option>`).join('')}</select></div>
    <div class="grid grid-2" id="doctor-list">${doctors.map(d => `<article class="card doctor-tile" data-search="${escapeHtml(`${d.name} ${d.specialty} ${d.city}`.toLowerCase())}" data-specialty="${escapeHtml(d.specialty)}">${doctorCard(d)}</article>`).join('')}</div>
    <p class="prototype-footnote">All doctor profiles in this demo are fictional placeholders. No professional registration has been verified and appointment requests do not reach a clinic.</p>`;
}

async function renderRecords(root) {
  const [{ records }, { shares }] = await Promise.all([api('/api/records'), api('/api/record-shares')]); state.records = records;
  root.innerHTML = `${pageIntro('YOUR DOCUMENT LIBRARY', 'Health records', 'Store your reports in one place and choose when a specific doctor can access a report.', '<button class="button button-primary" data-action="upload-record">＋ Upload a report</button>')}
    <div class="upload-drop card"><div class="upload-symbol">▤</div><div><strong>Add a health document</strong><p>PDF, JPG or PNG · Up to 6 MB per file</p></div><button class="button button-soft button-small" data-action="upload-record">Choose file</button></div>
    <div class="section-title"><div><h3>Your saved reports</h3><p>Only you can access these files unless you create a time-limited share.</p></div><span class="status-pill">${records.length} files</span></div>
    <div class="card"><div class="list-stack">${records.length ? records.map(r => `<div class="record-file"><div class="file-icon">${r.mimeType === 'application/pdf' ? 'PDF' : 'IMG'}</div><div class="file-main"><strong>${escapeHtml(r.name)}</strong><small>${escapeHtml(r.category)} · ${dateLabel(r.createdAt.slice(0,10))} · ${(r.size / 1024).toFixed(0)} KB</small></div><button class="button button-soft button-small" data-action="download-record" data-id="${escapeHtml(r.id)}">Download</button><button class="button button-outline button-small" data-action="share-record" data-id="${escapeHtml(r.id)}">Share</button><button class="icon-button" data-action="delete-record" data-id="${escapeHtml(r.id)}" aria-label="Delete report">×</button></div>`).join('') : emptyState('▤','Your report space is ready','Upload a report to begin organising your personal health documents.','<button class="button button-soft button-small" data-action="upload-record">Upload your first report</button>')}</div></div>
    <div class="section-title"><div><h3>Doctor access permissions</h3><p>Only the selected report is shared, and you can revoke access at any time.</p></div></div>
    <div class="card"><div class="list-stack">${shares.length ? shares.map(s => `<div class="list-row"><div class="list-icon">♧</div><div class="list-main"><strong>${escapeHtml(s.record?.name || 'Report')}</strong><small>Shared with ${escapeHtml(s.doctor?.name || 'Doctor')} · Expires ${new Date(s.expiresAt).toLocaleString('en-IN')}</small></div><div class="list-action">${s.active ? '<span class="status-pill">Active</span>' : '<span class="status-pill cancelled">Expired / revoked</span>'}${s.active ? `<button class="button button-danger button-small" style="margin-top:5px" data-action="revoke-share" data-id="${escapeHtml(s.id)}">Revoke access</button>` : ''}</div></div>`).join('') : emptyState('♧','No reports shared','When you share an individual report with a doctor, its permission will appear here.')}</div></div>
    <div class="privacy-note" style="margin-top:16px"><div class="stat-icon">♧</div><div><strong>Patient-controlled sharing</strong><p>Each share is limited to one selected demo doctor and expires after the time you choose. The doctor can download only while permission is active. This local prototype is not a production-grade health information exchange.</p></div></div>`;
}

async function renderWellness(root) {
  const { logs } = await api('/api/wellness'); state.wellness = logs; const latest = logs[0];
  root.innerHTML = `${pageIntro('SMALL STEPS, YOUR WAY', 'Everyday wellbeing', 'Record your own activity and food information. These logs are not a medical assessment.')}
    <div class="grid grid-3">${statCard('♧', latest?.waterMl != null ? `${latest.waterMl} ml` : '—', 'Most recent water log')}${statCard('⌁', latest?.steps != null ? latest.steps.toLocaleString('en-IN') : '—', 'Most recent steps', 'blue')}${statCard('◌', latest?.calories != null ? latest.calories.toLocaleString('en-IN') : '—', 'Most recent calorie log', 'peach')}</div>
    <div class="grid grid-2" style="margin-top:17px"><form class="card" id="wellness-form"><div class="card-title-row"><h3>Add today's entry</h3><span class="status-pill">Optional</span></div><div class="form-grid"><div class="field-wrap"><label for="water">Water (ml)</label><input id="water" name="waterMl" type="number" min="0" max="10000" placeholder="e.g. 1500"></div><div class="field-wrap"><label for="steps">Steps</label><input id="steps" name="steps" type="number" min="0" max="100000" placeholder="e.g. 4500"></div><div class="field-wrap span-2"><label for="calories">Calories you logged (optional)</label><input id="calories" name="calories" type="number" min="0" max="15000" placeholder="Enter a value from your food tracker"><span class="field-hint">Healix does not calculate a personal calorie target.</span></div><div class="field-wrap span-2"><label for="well-note">Note</label><textarea id="well-note" name="note" placeholder="How are you feeling today? (optional)"></textarea></div></div><button class="button button-primary" type="submit" style="margin-top:14px">Save entry</button></form>
    <section class="card"><div class="card-title-row"><h3>Recent entries</h3></div><div class="list-stack">${logs.length ? logs.slice(0, 8).map(l => `<div class="list-row"><div class="list-icon">◉</div><div class="list-main"><strong>${dateLabel(l.date)}</strong><small>${l.waterMl == null ? 'Water —' : `${l.waterMl} ml water`} · ${l.steps == null ? 'Steps —' : `${l.steps} steps`} · ${l.calories == null ? 'Calories —' : `${l.calories} kcal logged`}</small>${l.note ? `<small>${escapeHtml(l.note)}</small>` : ''}</div></div>`).join('') : emptyState('◉','No entries yet','Add a simple wellbeing entry to see it here.')}</div></section></div>
    <div class="safety-callout" style="margin-top:16px"><strong>Personal nutrition is individual.</strong><p>Calorie, vitamin and supplement needs can vary with health conditions, medicines, pregnancy, age and other factors. Discuss personalised targets and supplements with a qualified clinician or dietitian.</p></div>`;
}

async function renderHealixAI(root) {
  let integration;
  try { integration = await api('/api/integrations/toughtongue'); }
  catch { integration = { configured: false, launchUrl: '', note: 'The AI service configuration could not be loaded.' }; }
  root.innerHTML = `${pageIntro('YOUR 24/7 HEALTH COMPANION', 'Healix AI', 'Speak naturally in English, Hindi or Hinglish with your Healix voice assistant.')}
    <div class="grid grid-2" style="align-items:stretch">
      <section class="card" style="padding:28px">
        <div class="stat-icon blue" style="width:54px;height:54px;font-size:24px">◉</div>
        <div class="eyebrow" style="margin-top:18px">TOUGH TONGUE AI · VOICE ASSISTANT</div>
        <h2 style="margin:8px 0">Talk to Healix AI</h2>
        <p class="muted">Discuss a health concern, understand medical terms or ask for general health guidance. The assistant is designed to recognise warning signs and direct you to emergency care when needed.</p>
        <div class="filter-row" style="margin:18px 0"><span class="status-pill">24/7 hosted voice session</span><span class="status-pill">English · Hindi · Hinglish</span></div>
        <a class="button button-primary" href="${escapeHtml(integration.launchUrl || 'https://app.toughtongueai.com')}" target="_blank" rel="noopener noreferrer">Start voice conversation <span aria-hidden="true">↗</span></a>
        <p class="small muted" style="margin-top:12px">Your voice conversation opens securely on Tough Tongue AI in a new tab. Sign in there if requested.</p>
      </section>
      <aside class="card" style="padding:28px">
        <div class="eyebrow">IMPORTANT SAFETY INFORMATION</div>
        <h3>AI support, not emergency care</h3>
        <p class="muted">Healix AI is not a licensed doctor and cannot provide a confirmed diagnosis, prescribe medication, book an appointment or contact emergency services.</p>
        <div class="safety-callout"><strong>If this may be an emergency</strong><p>Do not wait for an AI response. Call 112 in India or your local emergency number and get help from someone nearby.</p><a class="button button-outline button-small" href="tel:112">Call 112</a></div>
        <p class="small muted" style="margin-top:16px">For privacy, Healix currently does not pass your saved profile, medicines or uploaded reports into the voice session. Share only information you are comfortable discussing.</p>
      </aside>
    </div>
    <section class="card" style="margin-top:16px"><div class="card-title-row"><div><h3>How this integration works</h3><p class="small muted">Connected to your existing Healix AI scenario</p></div><span class="status-pill">Scenario linked</span></div>
      <div class="list-stack">
        <div class="list-row"><div class="list-icon">✓</div><div class="list-main"><strong>Existing scenario</strong><small>Healix AI — 24/7 Healthcare Voice Assistant</small></div></div>
        <div class="list-row"><div class="list-icon">↗</div><div class="list-main"><strong>Hosted voice experience</strong><small>Voice sessions are handled by Tough Tongue AI; this website provides the secure launch point.</small></div></div>
        <div class="list-row"><div class="list-icon">🔒</div><div class="list-main"><strong>Patient data boundary</strong><small>No health records or profile data are transmitted by this integration.</small></div></div>
      </div>
    </section>`;
}

async function renderGuide(root) {
  if (!state.guideMessages.length) state.guideMessages.push({ role: 'assistant', text: 'Hello! I’m the Healix Guide, a non-clinical helper for using this website. I can help you find your records, understand where to add reminders or request an appointment. I cannot diagnose, prescribe or interpret symptoms. What would you like help with?' });
  root.innerHTML = `${pageIntro('A FRIENDLY HAND WHEN YOU NEED IT', 'Care Guide', 'A simple guide to using Healix. This assistant is not a doctor and does not provide medical advice.')}
    <div class="guide-layout"><section class="card chat-card"><div class="card-title-row"><div><h3>Talk to Healix Guide</h3><p class="small muted">Website help · Not clinical care</p></div><span class="status-pill">Demo assistant</span></div><div class="chat-messages" id="chat-messages">${state.guideMessages.map(m => `<div class="chat-message ${m.role}">${escapeHtml(m.text).replace(/\n/g,'<br>')}</div>`).join('')}</div><form class="chat-input-row" id="guide-form"><input id="guide-input" aria-label="Message Healix Guide" placeholder="Ask how to use Healix…" autocomplete="off"><button type="button" class="button button-soft" id="voice-input" title="Use voice input">🎙</button><button class="button button-primary" type="submit">Send</button></form><div class="filter-row" style="margin:12px 0 0"><button class="helper-chip" data-guide-prompt="How do I add a medicine reminder?">Add a reminder</button><button class="helper-chip" data-guide-prompt="How do I upload a medical report?">Upload a report</button><button class="helper-chip" data-guide-prompt="How do I request a doctor appointment?">Book an appointment</button></div></section>
    <aside class="chat-side-note"><strong>Need medical help?</strong> This guide cannot assess symptoms or tell you what medicine to take. Contact a registered healthcare professional for medical advice. If someone may be in immediate danger in India, call 112.<br><br><a href="tel:112" class="button button-outline button-small">Call emergency services · 112</a><hr style="border:0;border-top:1px solid #ecdccc;margin:15px 0"><strong>Your privacy matters</strong>Do not enter passwords, identity numbers or sensitive medical details into this demo assistant.</aside></div>`;
  $('#chat-messages').scrollTop = $('#chat-messages').scrollHeight;
}

function guideReply(text) {
  const q = text.toLowerCase();
  if (/medicine|reminder|dose|pill/.test(q)) return 'To add a reminder, open Medicines in the left menu and choose “Add reminder”. Enter the name and dosage exactly as written by your healthcare professional, then add the reminder times. Healix does not recommend or change medicines or doses.';
  if (/report|pdf|upload|record/.test(q)) return 'Open Health records and choose “Upload a report”. You can add a PDF, JPG or PNG file up to 6 MB. In this prototype, the document is stored on the local server running this website and is not automatically shared with a doctor.';
  if (/doctor|appointment|book|consult/.test(q)) return 'Open Find a doctor to browse the sample directory. Choose “Request appointment”, select a future date and time, and submit the form. This is a demonstration only: no real clinic is contacted and no real appointment is booked.';
  if (/profile|allerg|condition|health history/.test(q)) return 'Open My health to update the personal details and notes you want to keep in your profile. Please use fictional or non-sensitive information while testing this prototype.';
  if (/water|calorie|nutrition|steps|wellness/.test(q)) return 'Open Wellbeing to record water, steps or calories that you have tracked yourself. Healix does not calculate medical nutrition targets or recommend supplements in this prototype.';
  if (/emergency|chest pain|can't breathe|cannot breathe|unconscious|stroke|bleeding/.test(q)) return 'I cannot assess emergencies. If someone may be in immediate danger, call India’s emergency number 112 now or go to the nearest emergency department. Do not wait for a reply from this assistant.';
  if (/diagnos|disease|symptom|medicine should|what should i take|prescrib/.test(q)) return 'I can’t diagnose symptoms, interpret a condition for you or recommend/prescribe medicines. Please contact a registered medical practitioner who can assess your situation. I can help you find the appointment section in this demo.';
  if (/privacy|secure|data/.test(q)) return 'This is a local prototype, not a production healthcare service. Do not upload real patient information. Production use would require security hardening, data-protection compliance, access controls, backups and appropriate healthcare-provider governance.';
  return 'I can help with website tasks such as finding your health profile, adding a reminder, saving a document, recording wellbeing information or requesting a sample appointment. I cannot provide medical diagnosis or treatment advice. What would you like to do in Healix?';
}
function addGuideMessage(role, text) { state.guideMessages.push({ role, text }); if (state.guideMessages.length > 30) state.guideMessages = state.guideMessages.slice(-30); }
async function sendGuide(text) {
  const clean = String(text || '').trim(); if (!clean) return;
  addGuideMessage('user', clean); addGuideMessage('assistant', guideReply(clean)); await renderGuide($('#page-content'));
}

async function renderDoctorOverview(root) {
  const { appointments } = await api('/api/doctor/appointments'); state.appointments = appointments;
  const pending = appointments.filter(a => a.status === 'pending'); const confirmed = appointments.filter(a => a.status === 'confirmed');
  root.innerHTML = `<section class="hero-card"><div class="hero-copy"><div class="eyebrow">PROFESSIONAL WORKSPACE · DEMO</div><h2>Welcome, ${escapeHtml(state.user.name)}.</h2><p>Review patient appointment requests and keep your demonstration schedule organised. This portal is not connected to a real clinic.</p><button class="button button-primary" data-page="appointments">Review patient requests <span>→</span></button></div><div class="hero-decoration">⚕</div></section>
  <div class="grid grid-3">${statCard('▦', appointments.length, 'All appointment requests')}${statCard('◷', pending.length, 'Awaiting your response', 'peach')}${statCard('✓', confirmed.length, 'Confirmed requests', 'blue')}</div>
  <div class="section-title"><h3>Recent appointment requests</h3><button class="section-link" data-page="appointments">View all →</button></div><div class="card"><div class="list-stack">${appointments.length ? appointments.slice(0,5).map(a => appointmentRow(a, true)).join('') : emptyState('▦','No patient requests','New demonstration requests will appear here.')}</div></div>
  <p class="prototype-footnote">Doctor access is a demonstration role. Provider registration, licence verification, patient consent and clinical record permissions are not implemented for production.</p>`;
}
async function renderDoctorAppointments(root) {
  const { appointments } = await api('/api/doctor/appointments'); state.appointments = appointments;
  root.innerHTML = `${pageIntro('PROFESSIONAL WORKSPACE', 'Patient appointment requests', 'Review and update requests assigned to this demonstration doctor.')}
  <div class="card"><div class="card-title-row"><div><h3>Appointment list</h3><p class="small muted">Only sample appointment data is shown here.</p></div><span class="status-pill">${appointments.length} total</span></div><div class="list-stack">${appointments.length ? appointments.map(a => `<div class="list-row"><div class="list-icon">▦</div><div class="list-main"><strong>${escapeHtml(a.patient?.name || 'Patient')}</strong><small>${escapeHtml(a.patient?.email || '')} · ${dateLabel(a.date)} · ${timeLabel(a.time)}</small><small>${escapeHtml(a.reason || 'Consultation')}</small></div><div class="list-action">${badge(a.status)}${a.status === 'pending' ? `<div class="card-actions"><button class="button button-primary button-small" data-action="doctor-status" data-id="${escapeHtml(a.id)}" data-status="confirmed">Confirm</button><button class="button button-danger button-small" data-action="doctor-status" data-id="${escapeHtml(a.id)}" data-status="declined">Decline</button></div>` : a.status === 'confirmed' ? `<div class="card-actions"><button class="button button-soft button-small" data-action="doctor-status" data-id="${escapeHtml(a.id)}" data-status="completed">Mark completed</button></div>` : ''}</div></div>`).join('') : emptyState('▦','No requests yet','Patient demo requests assigned to you will appear here.')}</div></div>
  <p class="prototype-footnote">This demonstration does not include clinical notes, prescriptions, patient medical-record access or a real scheduling service.</p>`;
}

async function renderDoctorSharedRecords(root) {
  const { sharedRecords } = await api('/api/doctor/shared-records');
  root.innerHTML = `${pageIntro('PATIENT-CONTROLLED ACCESS', 'Shared reports', 'Only reports a patient has explicitly shared with this demo doctor appear here.')}
    <div class="card"><div class="card-title-row"><div><h3>Currently shared with you</h3><p class="small muted">Access automatically expires or can be revoked by the patient.</p></div><span class="status-pill">${sharedRecords.length} active</span></div><div class="list-stack">${sharedRecords.length ? sharedRecords.map(s => `<div class="record-file"><div class="file-icon">${s.record.mimeType === 'application/pdf' ? 'PDF' : 'IMG'}</div><div class="file-main"><strong>${escapeHtml(s.record.name)}</strong><small>Patient: ${escapeHtml(s.patient.name)} · ${escapeHtml(s.patient.email)}</small><small>${escapeHtml(s.record.category)} · Access expires ${new Date(s.expiresAt).toLocaleString('en-IN')}</small></div><button class="button button-primary button-small" data-action="download-shared-record" data-id="${escapeHtml(s.shareId)}">Download</button></div>`).join('') : emptyState('▤','No reports have been shared','A patient must select a report and explicitly grant access before it appears here.')}</div></div>
    <p class="prototype-footnote">Every download is recorded in the local demo audit log. This prototype does not support clinical annotations or prescribing.</p>`;
}

function modal(title, subtitle, body, submitText = 'Save') {
  $('#modal-root').innerHTML = `<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}"><header class="modal-header"><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(subtitle)}</p></div><button class="icon-button" data-action="close-modal" aria-label="Close dialog">×</button></header><div class="modal-body">${body}</div><footer class="modal-footer"><button class="button button-quiet" data-action="close-modal">Cancel</button><button class="button button-primary" id="modal-submit">${escapeHtml(submitText)}</button></footer></section></div>`;
  $('.modal', $('#modal-root')).addEventListener('click', e => e.stopPropagation());
}
function closeModal() { $('#modal-root').innerHTML = ''; }
function openMedicationModal() {
  modal('Add a medicine reminder', 'Enter instructions exactly as prescribed by your healthcare professional.', `<form id="medication-form" class="form-grid"><div class="field-wrap span-2"><label for="med-name">Medicine name</label><input id="med-name" name="name" required placeholder="Medicine name"></div><div class="field-wrap"><label for="med-strength">Strength (optional)</label><input id="med-strength" name="strength" placeholder="As written on the pack"></div><div class="field-wrap"><label for="med-dose">Dose / amount</label><input id="med-dose" name="dose" required placeholder="e.g. 1 tablet"></div><div class="field-wrap span-2"><label for="med-times">Reminder times</label><input id="med-times" name="times" required placeholder="08:00, 20:00"><span class="field-hint">Use 24-hour time, separated by commas. Example: 08:00, 20:00.</span></div><div class="field-wrap"><label for="med-start">Start date (optional)</label><input id="med-start" name="startDate" type="date"></div><div class="field-wrap"><label for="med-end">End date (optional)</label><input id="med-end" name="endDate" type="date"></div><div class="field-wrap span-2"><label for="med-instructions">Instructions (optional)</label><textarea id="med-instructions" name="instructions" placeholder="Only copy instructions supplied by your clinician or pharmacist."></textarea></div><p class="field-hint span-2">This creates a reminder only. It does not verify the prescription or send a notification when the browser is closed.</p></form>`);
  $('#modal-submit').addEventListener('click', async () => {
    const form = $('#medication-form'); if (!form.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form)); const times = data.times.split(',').map(t => t.trim());
    try { await api('/api/medications', { method: 'POST', body: json({ ...data, times }) }); closeModal(); toast('Medicine reminder added.'); await renderPage(); }
    catch (err) { toast(err.message, 'error'); }
  });
}
function openBookModal(doctorId) {
  const doctor = state.doctors.find(d => d.id === doctorId); if (!doctor) return;
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  modal('Request an appointment', `${doctor.name} · ${doctor.specialty} · ${money(doctor.consultationFee)} demo fee`, `<form id="appointment-form" class="form-grid"><input type="hidden" name="doctorId" value="${escapeHtml(doctorId)}"><div class="field-wrap"><label for="apt-date">Preferred date</label><input id="apt-date" name="date" type="date" min="${localDate()}" value="${localDate(tomorrow)}" required></div><div class="field-wrap"><label for="apt-time">Preferred time</label><input id="apt-time" name="time" type="time" value="11:00" required></div><div class="field-wrap span-2"><label for="apt-reason">Reason for appointment (optional)</label><textarea id="apt-reason" name="reason" maxlength="500" placeholder="A brief note for your own reference. Avoid sharing sensitive details in this demo."></textarea></div><p class="field-hint span-2">This is a local demo request. It is not sent to the provider and does not create a real appointment.</p></form>`,'Send demo request');
  $('#modal-submit').addEventListener('click', async () => { const form = $('#appointment-form'); if (!form.reportValidity()) return; const data = Object.fromEntries(new FormData(form)); try { await api('/api/appointments', { method: 'POST', body: json(data) }); closeModal(); toast('Demo appointment request saved.'); await navigate('appointments'); } catch (err) { toast(err.message, 'error'); } });
}
function openRecordModal() {
  modal('Upload a health report', 'PDF, JPG or PNG · Maximum file size 6 MB', `<form id="record-form" class="form-grid"><div class="field-wrap span-2"><label for="record-name">Report name</label><input id="record-name" name="name" required placeholder="e.g. Blood test — November"></div><div class="field-wrap"><label for="record-category">Document type</label><select id="record-category" name="category"><option>Lab report</option><option>Prescription</option><option>Imaging report</option><option>Discharge summary</option><option>Other</option></select></div><div class="field-wrap"><label for="record-file">Choose file</label><input id="record-file" name="file" type="file" accept="application/pdf,image/jpeg,image/png" required></div><p class="field-hint span-2">Use fictional or non-sensitive test documents only. This prototype stores uploaded files on the local server.</p></form>`,'Upload report');
  $('#modal-submit').addEventListener('click', async () => {
    const form = $('#record-form'); if (!form.reportValidity()) return; const file = $('#record-file').files[0];
    if (!file) return; if (file.size > 6 * 1024 * 1024) return toast('The file must be 6 MB or smaller.', 'error');
    const allowed = ['application/pdf','image/jpeg','image/png']; if (!allowed.includes(file.type)) return toast('Choose a PDF, JPG or PNG file.', 'error');
    const reader = new FileReader(); reader.onload = async () => {
      try { await api('/api/records', { method: 'POST', body: json({ name: $('#record-name').value, category: $('#record-category').value, mimeType: file.type, dataBase64: String(reader.result).split(',')[1] }) }); closeModal(); toast('Report uploaded.'); await renderPage(); }
      catch (err) { toast(err.message, 'error'); }
    }; reader.onerror = () => toast('Could not read that file.', 'error'); reader.readAsDataURL(file);
  });
}

async function openShareModal(recordId) {
  try {
    if (!state.doctors.length) state.doctors = (await api('/api/doctors')).doctors;
    const record = state.records.find(r => r.id === recordId) || (await api('/api/records')).records.find(r => r.id === recordId);
    if (!record) return toast('Report not found.', 'error');
    modal('Share this report', `Choose one doctor for “${record.name}”. You can revoke access later.`, `<form id="share-form" class="form-grid"><div class="field-wrap span-2"><label for="share-doctor">Doctor</label><select id="share-doctor" name="doctorId" required>${state.doctors.map(d => `<option value="${escapeHtml(d.id)}">${escapeHtml(d.name)} · ${escapeHtml(d.specialty)}</option>`).join('')}</select></div><div class="field-wrap span-2"><label for="share-expiry">Access duration</label><select id="share-expiry" name="expiryHours"><option value="24">24 hours</option><option value="72">3 days</option><option value="168">7 days</option></select></div><p class="field-hint span-2">The selected doctor can download this single report until the permission expires or you revoke it. Demo doctor identities are fictional.</p></form>`,'Grant access');
    $('#modal-submit').addEventListener('click', async () => {
      const form = $('#share-form'); if (!form.reportValidity()) return; const data = Object.fromEntries(new FormData(form));
      try { await api(`/api/records/${encodeURIComponent(recordId)}/share`, { method: 'POST', body: json(data) }); closeModal(); toast('Time-limited access granted.'); await renderPage(); }
      catch (err) { toast(err.message, 'error'); }
    });
  } catch (err) { toast(err.message, 'error'); }
}

async function printHealthSummary() {
  const win = window.open('', '_blank');
  if (!win) return toast('Allow pop-ups to print your health summary.', 'error');
  win.document.write('<title>Preparing Healix health summary</title><p style="font-family:Arial;padding:30px">Preparing your summary…</p>'); win.document.close();
  try {
    const [profileResult, medResult, recordResult, appointmentResult] = await Promise.all([api('/api/profile'), api('/api/medications'), api('/api/records'), api('/api/appointments')]);
    const p = profileResult.profile; const rows = (items, fn, empty) => items.length ? items.map(fn).join('') : `<tr><td colspan="3">${empty}</td></tr>`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Healix Health Summary</title><style>body{font:14px Arial,sans-serif;color:#17324d;max-width:850px;margin:38px auto;padding:0 24px}h1{font-size:28px;margin-bottom:4px}h2{font-size:17px;margin:28px 0 10px;color:#0f766e}p,td{line-height:1.55}.muted{color:#657b87;font-size:11px}.banner{background:#eef7f3;padding:14px;border-radius:10px;margin:20px 0}table{width:100%;border-collapse:collapse}td,th{padding:9px;border-bottom:1px solid #e3ece8;text-align:left;font-size:12px}th{background:#f4f8f6}.warning{border:1px solid #eed9c8;background:#fff7ef;padding:12px;border-radius:8px;margin-top:25px;font-size:11px}@media print{body{margin:12mm auto}}</style></head><body><h1>Healix · Personal Health Summary</h1><p class="muted">Generated ${new Date().toLocaleString('en-IN')} · Private document</p><div class="banner"><strong>${escapeHtml(state.user.name)}</strong><p>${escapeHtml(state.user.email)} · ${escapeHtml(p.city || 'City not provided')}</p><p>Date of birth: ${escapeHtml(p.dateOfBirth || 'Not provided')} · Blood group: ${escapeHtml(p.bloodGroup || 'Not provided')}</p><p>Phone: ${escapeHtml(p.phone || 'Not provided')}</p></div><h2>Health information</h2><p><strong>Allergies:</strong> ${escapeHtml(p.allergies || 'Not provided')}</p><p><strong>Conditions / history:</strong> ${escapeHtml(p.conditions || 'Not provided')}</p><p><strong>Emergency contact:</strong> ${escapeHtml(p.emergencyContact || 'Not provided')}</p><p><strong>Additional notes:</strong> ${escapeHtml(p.notes || 'None')}</p><h2>Active medicine reminders</h2><table><tr><th>Medicine</th><th>Dose entered</th><th>Reminder times</th></tr>${rows(medResult.medications.filter(m=>m.active),m=>`<tr><td>${escapeHtml(m.name)} ${escapeHtml(m.strength)}</td><td>${escapeHtml(m.dose)}</td><td>${escapeHtml((m.times||[]).join(', '))}</td></tr>`,'No active reminders')}</table><h2>Saved reports</h2><table><tr><th>Report</th><th>Category</th><th>Added</th></tr>${rows(recordResult.records,r=>`<tr><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.category)}</td><td>${escapeHtml(r.createdAt.slice(0,10))}</td></tr>`,'No uploaded reports')}</table><h2>Appointments</h2><table><tr><th>Professional</th><th>Date and time</th><th>Status</th></tr>${rows(appointmentResult.appointments,a=>`<tr><td>${escapeHtml(a.doctor?.name||'Care professional')}</td><td>${escapeHtml(a.date)} · ${escapeHtml(a.time)}</td><td>${escapeHtml(a.status)}</td></tr>`,'No appointments')}</table><div class="warning"><strong>Important:</strong> This summary is a user-organised record, not a medical report, diagnosis or prescription. Reminder entries are not verified prescriptions. Please confirm clinical information with your healthcare professional. Healix demo data and providers are fictional.</div><p class="muted">To save as PDF, choose Print → Save as PDF in your browser.</p></body></html>`;
    win.document.open(); win.document.write(html); win.document.close(); win.focus(); win.print();
  } catch (err) { win.close(); toast(err.message, 'error'); }
}

async function downloadRecord(recordId) {
  try { const response = await fetch(`/api/records/${encodeURIComponent(recordId)}/download`, { credentials: 'same-origin' }); if (!response.ok) { const msg = await response.json().catch(() => ({})); throw new Error(msg.error || 'Download failed.'); } const blob = await response.blob(); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'Healix-health-record'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); }
  catch (err) { toast(err.message, 'error'); }
}

async function downloadSharedRecord(shareId) {
  try { const response = await fetch(`/api/doctor/shared-records/${encodeURIComponent(shareId)}/download`, { credentials: 'same-origin' }); if (!response.ok) { const msg = await response.json().catch(() => ({})); throw new Error(msg.error || 'Download failed.'); } const blob = await response.blob(); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'healix-shared-report'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); }
  catch (err) { toast(err.message, 'error'); }
}

async function actionClick(button) {
  const action = button.dataset.action; const id = button.dataset.id;
  if (action === 'retry-page') return renderPage();
  if (action === 'close-modal') return closeModal();
  if (action === 'add-medication') return openMedicationModal();
  if (action === 'upload-record') return openRecordModal();
  if (action === 'share-record') return openShareModal(id);
  if (action === 'download-summary') return printHealthSummary();
  if (action === 'download-shared-record') return downloadSharedRecord(id);
  if (action === 'revoke-share') { if (!confirm('Revoke this doctor’s access now?')) return; try { await api(`/api/record-shares/${encodeURIComponent(id)}/revoke`, { method: 'PATCH', body: '{}' }); toast('Sharing permission revoked.'); await renderPage(); } catch (err) { toast(err.message, 'error'); } }
  if (action === 'book-doctor') return openBookModal(id);
  if (action === 'dose-taken') {
    try { await api(`/api/medications/${encodeURIComponent(id)}/taken`, { method: 'POST', body: json({ time: button.dataset.time }) }); toast('Reminder marked as taken.'); await renderPage(); }
    catch (err) { toast(err.message, 'error'); }
  }
  if (action === 'cancel-appointment') {
    if (!confirm('Cancel this demonstration appointment request?')) return;
    try { await api(`/api/appointments/${encodeURIComponent(id)}/cancel`, { method: 'PATCH', body: '{}' }); toast('Appointment request cancelled.'); await renderPage(); }
    catch (err) { toast(err.message, 'error'); }
  }
  if (action === 'download-record') return downloadRecord(id);
  if (action === 'delete-record') {
    if (!confirm('Delete this file from the local Healix demo?')) return;
    try { await api(`/api/records/${encodeURIComponent(id)}`, { method: 'DELETE' }); toast('Report deleted.'); await renderPage(); }
    catch (err) { toast(err.message, 'error'); }
  }
  if (action === 'doctor-status') {
    try { await api(`/api/doctor/appointments/${encodeURIComponent(id)}`, { method: 'PATCH', body: json({ status: button.dataset.status }) }); toast('Appointment status updated.'); await renderPage(); }
    catch (err) { toast(err.message, 'error'); }
  }
}

function updateDoctorFilters() {
  const q = ($('#doctor-search')?.value || '').trim().toLowerCase(); const specialty = $('#doctor-specialty')?.value || '';
  $$('.doctor-tile').forEach(card => { const visible = (!q || card.dataset.search.includes(q)) && (!specialty || card.dataset.specialty === specialty); card.classList.toggle('hidden', !visible); });
}
async function saveProfile(event) {
  event.preventDefault(); const form = event.currentTarget; const data = Object.fromEntries(new FormData(form));
  try { const result = await api('/api/profile', { method: 'PATCH', body: json(data) }); state.profile = result.profile; toast('Your profile has been saved.'); }
  catch (err) { toast(err.message, 'error'); }
}
async function saveWellness(event) {
  event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget));
  try { await api('/api/wellness', { method: 'POST', body: json(data) }); toast('Wellbeing entry saved.'); await renderPage(); }
  catch (err) { toast(err.message, 'error'); }
}
async function saveGuide(event) { event.preventDefault(); const input = $('#guide-input'); const text = input.value; input.value = ''; await sendGuide(text); }
function setSidebarOpen(open) {
  const sidebar = $('#sidebar'), scrim = $('#sidebar-scrim'), trigger = $('#menu-toggle');
  sidebar.classList.toggle('open', open); scrim.classList.toggle('visible', open); trigger.setAttribute('aria-expanded', String(open));
}
function toggleDesktopSidebar() { $('#app-view').classList.toggle('sidebar-collapsed'); }


// Event delegation keeps the UI interactive without inline JavaScript.
document.addEventListener('click', async event => {
  const nav = event.target.closest('[data-page]'); if (nav) { event.preventDefault(); return navigate(nav.dataset.page); }
  const action = event.target.closest('[data-action]'); if (action) { if (action.dataset.action === 'close-modal' && event.target === action && action.classList.contains('modal-backdrop')) return closeModal(); return actionClick(action); }
  const demo = event.target.closest('[data-demo-login]'); if (demo) return demoLogin(demo.dataset.demoLogin);
  const prompt = event.target.closest('[data-guide-prompt]'); if (prompt) return sendGuide(prompt.dataset.guidePrompt);
});
document.addEventListener('submit', async event => {
  if (event.target.id === 'auth-form') return handleAuthSubmit(event);
  if (event.target.id === 'profile-form') return saveProfile(event);
  if (event.target.id === 'wellness-form') return saveWellness(event);
  if (event.target.id === 'guide-form') return saveGuide(event);
});
document.addEventListener('input', event => { if (event.target.id === 'doctor-search') updateDoctorFilters(); });
document.addEventListener('change', event => {
  if (event.target.id === 'doctor-specialty') updateDoctorFilters();
});
$('#auth-switch').addEventListener('click', () => setAuthMode(state.authMode === 'login' ? 'register' : 'login'));
$('#toggle-password').addEventListener('click', () => { const input = $('#auth-password'); const show = input.type === 'password'; input.type = show ? 'text' : 'password'; $('#toggle-password').textContent = show ? 'Hide' : 'Show'; });
$('#logout-button').addEventListener('click', logout);
$('#profile-trigger').addEventListener('click', () => $('#profile-menu').classList.toggle('hidden'));
$('#menu-toggle').addEventListener('click', () => {
  if (window.matchMedia('(min-width: 1100px)').matches) toggleDesktopSidebar();
  else setSidebarOpen(!$('#sidebar').classList.contains('open'));
});
$('#sidebar-scrim').addEventListener('click', () => setSidebarOpen(false));
window.addEventListener('resize', () => { if (window.matchMedia('(min-width: 1100px)').matches) setSidebarOpen(false); });
document.addEventListener('click', event => {
  if (!event.target.closest('#voice-input')) return;
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return toast('Voice input is not supported in this browser. You can type your question.', 'error');
  const recognition = new SpeechRecognition(); recognition.lang = 'en-IN'; recognition.interimResults = false; recognition.maxAlternatives = 1;
  recognition.onresult = e => { $('#guide-input').value = e.results[0][0].transcript; $('#guide-input').focus(); };
  recognition.onerror = () => toast('Voice input was not available. Please type your question.', 'error'); recognition.start();
});
$('#profile-menu').addEventListener('click', e => { if (e.target === $('#profile-menu')) return; $('#profile-menu').classList.add('hidden'); });
$('#profile-trigger').addEventListener('keydown', e => { if (e.key === 'Escape') $('#profile-menu').classList.add('hidden'); });
$('#page-content').addEventListener('click', event => { if (event.target.closest('.quick-action')) return; });

async function boot() {
  setAuthMode('login');
  try { const result = await api('/api/me'); state.user = result.user; await enterApp(); }
  catch { showAuth(); }
}
boot();
