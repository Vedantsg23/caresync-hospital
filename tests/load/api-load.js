/* eslint-disable */
/**
 * k6 load profile for CareSync Hospital.
 *
 * Run against a build that is serving the profiling dataset, not the demo
 * seed — 50,000 patients and 1.2m timeline events, so that the numbers describe
 * index behaviour rather than a table that fits in cache. See
 * docs/LOAD_TESTING.md for how to reproduce, and for the measured results and
 * the limits of what they prove.
 *
 *   k6 run -e BASE_URL=http://127.0.0.1:3000 -e PASSWORD=... tests/load/api-load.js
 *
 * The mix is deliberately read-heavy in the same proportion as the application
 * itself: a ward round opens dashboards, patient lists and charts constantly
 * and writes a note or a set of observations occasionally. A uniform mix would
 * produce a prettier number and describe nothing.
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://127.0.0.1:3000';
const PASSWORD = __ENV.PASSWORD || 'CareSync#2026';
const VUS = Number(__ENV.VUS || 25);
const DURATION = __ENV.DURATION || '1m';

// Accounts the profiling seed creates. Each VU takes one so that sessions,
// per-user rate limits and per-user visibility filters are all exercised
// rather than one hot session being reused.
const ACCOUNTS = [
  'doctor@caresync.demo',
  'specialist@caresync.demo',
  'nurse@caresync.demo',
  'admin@caresync.demo',
];

const loginTime = new Trend('caresync_login_ms', true);
const dashboardTime = new Trend('caresync_dashboard_ms', true);
const patientListTime = new Trend('caresync_patient_list_ms', true);
const patientRecordTime = new Trend('caresync_patient_record_ms', true);
const timelineTime = new Trend('caresync_timeline_ms', true);
const searchTime = new Trend('caresync_search_ms', true);
const writeTime = new Trend('caresync_write_ms', true);
const authFailures = new Counter('caresync_auth_failures');
const errorRate = new Rate('caresync_errors');

export const options = {
  scenarios: {
    clinical_session: {
      executor: 'constant-vus',
      vus: VUS,
      duration: DURATION,
      gracefulStop: '15s',
    },
  },
  thresholds: {
    // Stated as intent, not as a claim. A failing threshold is the point of
    // running this; see the recorded results before quoting any of them.
    'http_req_failed': ['rate<0.01'],
    'caresync_dashboard_ms': ['p(95)<1500'],
    'caresync_patient_list_ms': ['p(95)<1500'],
    'caresync_patient_record_ms': ['p(95)<2000'],
    'caresync_timeline_ms': ['p(95)<1500'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

function login(email) {
  const res = http.post(
    `${BASE}/api/auth/login`,
    JSON.stringify({ email, password: PASSWORD }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'POST /api/auth/login' } },
  );
  loginTime.add(res.timings.duration);
  const ok = check(res, { 'login 200': (r) => r.status === 200 });
  if (!ok) authFailures.add(1);
  return ok;
}

export function setup() {
  const res = http.get(`${BASE}/api/health/db`);
  const body = res.json();
  console.log(`target: ${BASE}  db=${JSON.stringify(body.data?.database ?? body)}`);
  return {};
}

export default function () {
  const email = ACCOUNTS[__VU % ACCOUNTS.length];

  // One sign-in per iteration would measure bcrypt rather than the
  // application; a real session signs in once and then works.
  if (!__ITER) {
    if (!login(email)) {
      sleep(1);
      return;
    }
  }

  let patientId = null;

  group('worklist', () => {
    const dash = http.get(`${BASE}/api/dashboard`, { tags: { name: 'GET /api/dashboard' } });
    dashboardTime.add(dash.timings.duration);
    errorRate.add(dash.status >= 400);
    check(dash, { 'dashboard ok': (r) => r.status === 200 });

    const list = http.get(`${BASE}/api/patients?pageSize=20`, { tags: { name: 'GET /api/patients' } });
    patientListTime.add(list.timings.duration);
    errorRate.add(list.status >= 400);
    if (list.status === 200) {
      const rows = list.json('data');
      if (Array.isArray(rows) && rows.length) {
        patientId = rows[Math.floor(Math.random() * rows.length)].id;
      }
    }
  });

  if (patientId) {
    group('patient record', () => {
      const header = http.get(`${BASE}/api/patients/${patientId}`, { tags: { name: 'GET /api/patients/:id' } });
      patientRecordTime.add(header.timings.duration);
      errorRate.add(header.status >= 400);

      const timeline = http.get(`${BASE}/api/patients/${patientId}/timeline?limit=25`, {
        tags: { name: 'GET /api/patients/:id/timeline' },
      });
      timelineTime.add(timeline.timings.duration);
      errorRate.add(timeline.status >= 400);

      const batch = http.batch([
        ['GET', `${BASE}/api/patients/${patientId}/vitals`, null, { tags: { name: 'GET /api/patients/:id/vitals' } }],
        ['GET', `${BASE}/api/patients/${patientId}/notes?limit=20`, null, { tags: { name: 'GET /api/patients/:id/notes' } }],
        ['GET', `${BASE}/api/patients/${patientId}/labs`, null, { tags: { name: 'GET /api/patients/:id/labs' } }],
      ]);
      batch.forEach((r) => errorRate.add(r.status >= 400));
    });
  }

  group('search', () => {
    const q = ['Sharma', 'Nair', 'PS-000', 'Iyer'][__ITER % 4];
    const res = http.get(`${BASE}/api/search?q=${q}`, { tags: { name: 'GET /api/search' } });
    searchTime.add(res.timings.duration);
    errorRate.add(res.status >= 400);
  });

  // One write in roughly every ten iterations, which is about the rate a
  // clinician actually records observations during a round.
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
        { headers: { 'Content-Type': 'application/json' }, tags: { name: 'POST /api/patients/:id/vitals' } },
      );
      writeTime.add(res.timings.duration);
      // 403 is a correct answer here: not every account is on every patient's
      // care team, and the visibility rules are the point of the system.
      errorRate.add(res.status >= 400 && res.status !== 403);
    });
  }

  sleep(Math.random() * 1.5 + 0.5);
}
