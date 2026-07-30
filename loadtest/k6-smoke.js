/**
 * k6 load test — simulates many concurrent users hitting the public,
 * read-heavy endpoints (the ones that get hammered at launch).
 *
 * Install k6:  https://k6.io/docs/get-started/installation/
 * Run:
 *   k6 run loadtest/k6-smoke.js
 *   k6 run -e BASE=https://api.glowora.life loadtest/k6-smoke.js
 *
 * The `stages` ramp climbs to 1,000 virtual users. To rehearse a launch
 * spike, raise the target and run from a machine close to your servers.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.BASE || 'http://localhost:5000/api/v1';

export const options = {
  stages: [
    { duration: '1m', target: 100 },   // warm up
    { duration: '2m', target: 500 },   // ramp
    { duration: '2m', target: 1000 },  // sustained load
    { duration: '1m', target: 0 },     // cool down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],  // 95% of requests under 500ms
    http_req_failed: ['rate<0.01'],    // <1% errors
  },
};

export default function () {
  // health
  check(http.get(`${BASE.replace('/api/v1', '')}/health`), { 'health 200': (r) => r.status === 200 });

  // public reads (most-hit endpoints at launch)
  check(http.get(`${BASE}/salons/nearby?city=Chandigarh`), { 'nearby 200': (r) => r.status === 200 });
  check(http.get(`${BASE}/salons/search?q=hair`), { 'search 200': (r) => r.status === 200 });
  check(http.get(`${BASE}/cities`), { 'cities 200': (r) => r.status === 200 });
  check(http.get(`${BASE}/banners`), { 'banners 200': (r) => r.status === 200 });

  sleep(1); // model a user pausing between actions
}
