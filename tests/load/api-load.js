/* eslint-disable */
/**
 * k6 load profile for CareSync Hospital.
 *
 * Run against a build serving the profiling dataset, not the demo seed — 50,000
 * patients and 1.2m timeline events, so the numbers describe index behaviour
 * rather than a table that fits in cache. docs/LOAD_TESTING.md has the measured
 * results, how to reproduce them, and what they do not prove.
 *
 *   k6 run -e BASE_URL=http://127.0.0.1:3000 -e PASSWORD=… tests/load/api-load.js
 *
 * The mix is read-heavy in the same proportion the application is: a ward round
 * opens dashboards, patient lists and charts constantly, and writes a note or a
 * set of observations occasionally. A uniform mix would produce a prettier
 * number and describe nothing.
 *
 * Two things about the harness are worth knowing, because both were wrong on
 * the first attempt and both produced confident, meaningless output.
 *
 * Sessions are established once in setup() and shared, rather than each virtual
 * user signing in. Sign-in is bcrypt at cost 12 — deliberately expensive, once
 * per session — so twenty-five simultaneous sign-ins measure the KDF and
 * nothing else. Sign-in capacity is measured separately, in its own scenario.
 *
 * The cookie is sent explicitly. The session cookie is `Secure`, which is
 * correct, and k6 is not a browser: it will not store a Secure cookie received
 * over plain HTTP, so its jar stayed empty and every authenticated request came
 * back 401 in 1.7ms. That looked like a very fast application.
 */

import http from 'k6/http';
import { check, group, sleep, fail } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://127.0.0.1:3000';
const PASSWORD = __ENV.PASSWORD || 'CareSync#2026';
const VUS = Number(__ENV.VUS || 25);
const DURATION = __ENV.DURATION || '1m';
const LOGIN_VUS = Number(__ENV.LOGIN_VUS || 2);

const ACCOUNTS = [
  'doctor@caresync.demo',
  'specialist@caresync.demo',
  'nurse@caresync.demo',
  'admin@caresync.demo',
];

const dashboardTime = new Trend('caresync_dashboard_ms', true);
const patientListTime = new Trend('caresync_patient_list_ms', true);
const patientRecordTime = new Trend('caresync_patient_record_ms', true);
const timelineTime = new Trend('caresync_timeline_ms', true);
const searchTime = new Trend('caresync_search_ms', true);
const writeTime = new Trend('caresync_write_ms', true);
const loginTime = new Trend('caresync_login_ms', true);
const errorRate = new Rate('caresync_errors');

export const options = {
  scenarios: {
    clinical_session: {
      executor: 'constant-vus',
      vus: VUS,
      duration: DURATION,
      gracefulStop: '15s',
      exec: 'clinicalSession',
    },
    // Sign-in has its own budget because it is the one endpoint whose cost is
    // intentional. Kept small so it does not starve the read mix of CPU.
    sign_in: {
      executor: 'constant-vus',
      vus: LOGIN_VUS,
      duration: DURATION,
      gracefulStop: '15s',
      exec: 'signIn',
      startTime: '5s',
    },
  },
  thresholds: {
    'http_req_failed': ['rate<0.01'],
    'caresync_dashboard_ms': ['p(95)<1500'],
    'caresync_patient_list_ms': ['p(95)<1500'],
    'caresync_patient_record_ms': ['p(95)<2000'],
    'caresync_timeline_ms': ['p(95)<1500'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

function authenticate(email) {
  const res = http.post(
    `${BASE}/api/auth/login`,
    JSON.stringify({ email, password: PASSWORD }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'POST /api/auth/login' } },
  );
  if (res.status !== 200) return null;
  const raw = res.headers['Set-Cookie'];
  const header = Array.isArray(raw) ? raw.join(',') : raw;
  const match = /caresync_session=[^;,]+/.exec(header || '');
  return match ? match[0] : null;
}

export function setup() {
  const health = http.get(`${BASE}/api/health/db`);
  const db = health.json('data.database');
  console.log(`target ${BASE}  db reachable=${db && db.reachable}  latency=${db && db.latencyMs}ms`);

  const sessions = {};
  for (const email of ACCOUNTS) {
    const cookie = authenticate(email);
    if (!cookie) fail(`could not sign in as ${email} — is the profiling seed loaded?`);
    sessions[email] = cookie;
  }
  return { sessions };
}

export function clinicalSession(data) {
  const email = ACCOUNTS[__VU % ACCOUNTS.length];
  const params = { headers: { Cookie: data.sessions[email] } };
  let patientId = null;

  group('worklist', () => {
    const dash = http.get(`${BASE}/api/dashboard`, { ...params, tags: { name: 'GET /api/dashboard' } });
    dashboardTime.add(dash.timings.duration);
    errorRate.add(dash.status >= 400);
    check(dash, { 'dashboard ok': (r) => r.status === 200 });

    const list = http.get(`${BASE}/api/patients?pageSize=20`, { ...params, tags: { name: 'GET /api/patients' } });
    patientListTime.add(list.timings.duration);
    errorRate.add(list.status >= 400);
    check(list, { 'patient list ok': (r) => r.status === 200 });
    if (list.status === 200) {
      const rows = list.json('data');
      if (Array.isArray(rows) && rows.length) patientId = rows[Math.floor(Math.random() * rows.length)].id;
    }
  });

  if (patientId) {
    group('patient record', () => {
      const header = http.get(`${BASE}/api/patients/${patientId}`, { ...params, tags: { name: 'GET /api/patients/:id' } });
      patientRecordTime.add(header.timings.duration);
      errorRate.add(header.status >= 400);
      check(header, { 'patient record ok': (r) => r.status === 200 });

      const timeline = http.get(`${BASE}/api/patients/${patientId}/timeline?limit=25`, {
        ...params, tags: { name: 'GET /api/patients/:id/timeline' },
      });
      timelineTime.add(timeline.timings.duration);
      errorRate.add(timeline.status >= 400);

      const batch = http.batch([
        ['GET', `${BASE}/api/patients/${patientId}/vitals`, null, { ...params, tags: { name: 'GET /api/patients/:id/vitals' } }],
        ['GET', `${BASE}/api/patients/${patientId}/notes?limit=20`, null, { ...params, tags: { name: 'GET /api/patients/:id/notes' } }],
        ['GET', `${BASE}/api/patients/${patientId}/labs`, null, { ...params, tags: { name: 'GET /api/patients/:id/labs' } }],
      ]);
      batch.forEach((r) => errorRate.add(r.status >= 400));
    });
  }

  group('search', () => {
    const q = ['Sharma', 'Nair', 'Iyer', 'Priya Rao'][__ITER % 4];
    const res = http.get(`${BASE}/api/patients?q=${encodeURIComponent(q)}&pageSize=20`, {
      ...params, tags: { name: 'GET /api/patients?q=' },
    });
    searchTime.add(res.timings.duration);
    errorRate.add(res.status >= 400);
    check(res, { 'search ok': (r) => r.status === 200 });
  });

  // Roughly one write per ten reads, which is about the rate a clinician
  // records observations during a round.
  if (patientId && __ITER % 10 === 3) {
    group('write', () => {
      const res = http.post(
        `${BASE}/api/patients/${patientId}/vitals`,
        JSON.stringify({
          heartRate: 70 + (__ITER % 30),
          bloodPressureSystolic: 110 + (__ITER % 20),
          bloodPressureDiastolic: 70 + (__ITER % 10),
          spo2: 95 + (__ITER % 4),
          respiratoryRate: 14 + (__ITER % 5),
          temperatureC: 36.5,
        }),
        { ...params, headers: { ...params.headers, 'Content-Type': 'application/json' }, tags: { name: 'POST /api/patients/:id/vitals' } },
      );
      writeTime.add(res.timings.duration);
      // 403 is a correct answer: not every account is on every patient's care
      // team, and the visibility rules are the point of the system.
      errorRate.add(res.status >= 400 && res.status !== 403);
    });
  }

  sleep(Math.random() * 1.5 + 0.5);
}

export function signIn() {
  const email = ACCOUNTS[__ITER % ACCOUNTS.length];
  const res = http.post(
    `${BASE}/api/auth/login`,
    JSON.stringify({ email, password: PASSWORD }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'POST /api/auth/login' } },
  );
  loginTime.add(res.timings.duration);
  check(res, { 'sign-in 200': (r) => r.status === 200 });
  errorRate.add(res.status >= 400);
  sleep(1);
}
