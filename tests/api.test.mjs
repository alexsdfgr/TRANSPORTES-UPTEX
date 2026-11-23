import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import webpush from 'web-push';
import { createApp } from '../server.mjs';

async function start(t, config = {}) {
  const server = createApp({ dbPath: ':memory:', ...config });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  return async (path, { method = 'GET', body, cookie, clientHeader = true } = {}) => {
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    if (method !== 'GET' && clientHeader) headers['X-UPTEX-Request'] = '1';
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(base + path, { method, body: body === undefined ? undefined : JSON.stringify(body), headers });
    const data = response.headers.get('Content-Type')?.includes('json') ? await response.json() : await response.text();
    return { status: response.status, data, headers: response.headers };
  };
}

async function signIn(request, role) {
  const result = await request('/api/login', {
    method: 'POST', body: { email: role + '@demo.uptex.mx', password: 'UPTex-demo-2026' },
  });
  assert.equal(result.status, 200);
  assert.match(result.headers.get('Set-Cookie'), /HttpOnly; SameSite=Lax/);
  return result.headers.get('Set-Cookie').split(';')[0];
}

test('Catálogo público, folletos y recursos de la app móvil', async (t) => {
  const request = await start(t);
  const { status, data } = await request('/api/catalog');
  assert.equal(status, 200);
  assert.deepEqual(data.routes.map((route) => route.code), ['R01', 'R02', 'R03']);
  assert.deepEqual(data.routes.map((route) => route.stops.length), [9, 10, 17]);
  assert.deepEqual(data.routes.map((route) => route.departure), ['06:10', '06:10', '06:25']);
  assert.deepEqual(data.routes.map((route) => route.arrival), ['07:00', '07:00', null]);
  assert.equal(data.routes[0].stops[0].fare, 20);
  assert.equal(data.routes[1].stops[5].fare, 14);
  assert.ok(data.routes[2].stops.every((stop) => stop.fare === 14));
  assert.equal((await request('/api/admin/state')).status, 401);
  assert.equal((await request('/')).status, 200);
  assert.equal((await request('/manifest.webmanifest')).data.display, 'standalone');
  assert.match((await request('/sw.js')).data, /\/api\/catalog/);
});

test('Coordinación publica, edita y administra accesos; otros roles no pueden escribir como admin', async (t) => {
  const request = await start(t);
  const student = await signIn(request, 'alumno');
  const admin = await signIn(request, 'admin');
  assert.equal((await request('/api/admin/state', { cookie: student })).status, 403);
  assert.equal((await request('/api/admin/routes', { method: 'POST', body: {}, cookie: student })).status, 403);
  const { data: { routes } } = await request('/api/admin/state', { cookie: admin });
  const draft = routes.find(({ code }) => code === 'R04');
  assert.equal(draft.status, 'draft');
  const publish = { ...draft, status: 'active', departure: '06:15', arrival: '07:10', stops: routes[0].stops.slice(-2) };
  const routePath = '/api/admin/routes/' + draft.id;
  assert.equal((await request(routePath, { method: 'PUT', body: { ...publish, stops: [] }, cookie: admin })).status, 400);
  assert.equal((await request(routePath, { method: 'PUT', body: publish, cookie: admin, clientHeader: false })).status, 403);
  assert.equal((await request(routePath, { method: 'PUT', body: publish, cookie: admin })).status, 200);
  assert.equal((await request('/api/catalog')).data.routes.length, 4);

  const person = { name: 'Nuevo profesor', email: 'nuevo@example.com', role: 'teacher', active: true, password: 'primera-pass-14' };
  const created = await request('/api/admin/users', { method: 'POST', body: person, cookie: admin });
  assert.equal(created.status, 201);
  assert.equal(created.data.user.password, undefined);
  const login = await request('/api/login', { method: 'POST', body: person });
  assert.equal(login.data.user.role, 'teacher');
  const teacher = login.headers.get('Set-Cookie').split(';')[0];
  const updated = await request('/api/admin/users/' + created.data.user.id, {
    method: 'PUT', body: { ...person, active: false, password: '' }, cookie: admin,
  });
  assert.equal(updated.status, 200);
  assert.equal((await request('/api/dashboard', { cookie: teacher })).status, 401);
});

test('Chofer asignado registra la salida y llegada, y avisos mantienen estado por usuario', async (t) => {
  const request = await start(t);
  const driver = await signIn(request, 'chofer');
  const admin = await signIn(request, 'admin');
  const student = await signIn(request, 'alumno');
  const trip = (id, action, cookie) => request('/api/routes/' + id + '/trip', { method: 'POST', body: { action }, cookie });
  assert.equal((await trip(2, 'departure', driver)).status, 403);
  assert.equal((await trip(1, 'departure', student)).status, 403);
  assert.equal((await trip(1, 'arrival', driver)).status, 409);
  assert.equal((await trip(1, 'departure', driver)).status, 200);
  assert.equal((await trip(1, 'departure', driver)).status, 409);
  assert.equal((await trip(1, 'arrival', driver)).status, 200);
  const { data: catalog } = await request('/api/catalog');
  assert.equal(catalog.routes[0].trip.plannedDeparture, '06:10');
  assert.ok(catalog.routes[0].trip.arrivedAt);
  assert.equal(catalog.routes[0].trip.driverId, undefined);

  const { data } = await request('/api/admin/notices', {
    method: 'POST', body: { title: 'Desvío temporal', body: 'Consulta el aviso de coordinación.', kind: 'traffic', routeId: 1 }, cookie: admin,
  });
  const path = '/api/notices/' + data.id + '/read';
  assert.equal((await request(path, { method: 'POST', cookie: student })).status, 200);
  assert.equal((await request('/api/dashboard', { cookie: student })).data.notices.find(({ id }) => id === data.id).isRead, 1);
  assert.equal((await request('/api/dashboard', { cookie: driver })).data.notices.find(({ id }) => id === data.id).isRead, 0);
  assert.equal((await request('/api/admin/notices/' + data.id, { method: 'PUT', body: { published: false }, cookie: admin })).status, 200);
  assert.ok(!(await request('/api/catalog')).data.notices.some(({ id }) => id === data.id));
});

test('Operación comienza con un administrador propio y cookies seguras', async (t) => {
  const request = await start(t, { demo: false, secureCookies: true, adminEmail: 'coord@example.com', adminPassword: 'coordinacion-segura-1' });
  const { data } = await request('/api/config');
  assert.equal(data.demo, false);
  assert.deepEqual(data.demoAccounts, []);
  assert.equal((await request('/api/login', {
    method: 'POST', body: { email: 'admin@demo.uptex.mx', password: 'UPTex-demo-2026' },
  })).status, 401);
  const login = await request('/api/login', { method: 'POST', body: { email: 'coord@example.com', password: 'coordinacion-segura-1' } });
  assert.match(login.headers.get('Set-Cookie'), /; Secure$/);
  assert.equal(login.data.user.role, 'admin');
});

test('Rastreo, aforo y manifiesto se actualizan con el turno y los escaneos reales', async (t) => {
  const request = await start(t);
  const admin = await signIn(request, 'admin');
  const driver = await signIn(request, 'chofer');
  const student = await signIn(request, 'alumno');
  const teacher = await signIn(request, 'profesor');
  const send = (path, body, cookie, method = 'POST') => request('/api/' + path, { method, body, cookie });
  const get = async (path, cookie) => (await request('/api/' + path, { cookie })).data;
  const route = (await get('catalog')).routes.find((item) => item.code === 'R01');
  const { id: stopId, lat, lng } = route.stops[0];
  const reserve = { routeId: route.id, stopId };
  const account = (await get('session', student)).user;
  assert.equal((await send('admin/users/' + account.id, { ...account, matricula: 'a-202601', active: true, password: '' }, admin, 'PUT')).status, 200);
  assert.equal((await send('my/ride', reserve, student)).status, 200);
  assert.equal((await send('my/ride', reserve, teacher)).status, 200);

  const shift = (action) => send('driver/shift', { routeId: route.id, action }, driver);
  assert.equal((await shift('departure')).status, 409);
  assert.equal((await send('driver/vehicle', { name: 'Combi 01', plate: 'TEX-010', capacity: 1 }, driver)).status, 200);
  const started = await shift('departure');
  assert.equal(started.status, 200);
  assert.equal(started.data.shift.nextStop.waiting, 2);
  const { tripId } = started.data.shift;
  const measuredAt = Date.now();
  assert.equal((await send('driver/location', { lat, lng, tripId, measuredAt }, driver)).status, 200);
  assert.equal((await send('driver/location', { lat: route.stops[2].lat, lng: route.stops[2].lng, tripId, measuredAt: measuredAt - 1 }, driver)).status, 200);
  const { tracking } = await get('my/tracking', student);
  assert.equal(tracking.etaMinutes, 0);
  assert.equal(tracking.stopsAway, 1);
  assert.equal(tracking.unit.location.lat, lat);
  assert.equal(tracking.unit.manifest, undefined);
  assert.equal((await request('/api/admin/radar', { cookie: student })).status, 403);
  assert.equal((await request('/api/live')).status, 401);

  const { qrToken } = await get('my/ride', student);
  const { qrToken: teacherToken } = await get('my/ride', teacher);
  const scan = (action, token, stop) => send('driver/scan', { qrToken: token, action, stopId: stop }, driver);
  assert.equal((await scan('board', qrToken)).status, 200);
  assert.equal((await send('my/ride', reserve, student)).status, 409);
  assert.equal((await scan('board', qrToken)).status, 409);
  assert.equal((await scan('board', teacherToken)).status, 409);
  assert.equal((await shift('arrival')).status, 409);
  const [unit] = (await get('admin/radar', admin)).units;
  assert.equal(unit.occupied, 1);
  assert.equal(unit.manifest[0].matricula, 'A-202601');
  assert.equal(unit.manifest[0].role, 'student');
  assert.equal(unit.plate, 'TEX-010');
  assert.equal((await get('driver/state', driver)).shift.nextStop.waiting, 1);

  const terminal = route.stops.at(-1);
  assert.equal((await scan('alight', qrToken, terminal.id)).status, 200);
  assert.deepEqual((await get('admin/radar', admin)).units[0].manifest, []);
  assert.equal((await get('my/history', teacher)).history.length, 0);
  const [record] = (await get('my/history', student)).history;
  assert.equal(record.stop, route.stops[0].name);
  assert.equal(record.alightStop, terminal.name);
  assert.ok(record.alightedAt >= record.boardedAt);
  assert.equal((await get('admin/history?q=a-202601', admin)).history[0].id, record.id);
  const report = await get('admin/ridership?date=' + record.date, admin);
  assert.equal(report.total, 1);
  assert.equal(report.groups[0].stop, route.stops[0].name);
  assert.equal(report.groups[0].routeCode, route.code);
  assert.equal((await shift('arrival')).status, 200);
  assert.deepEqual((await get('admin/radar', admin)).units, []);
  assert.ok((await get('my/tracking', student)).tracking.alightedAt);
  assert.equal((await send('my/ride', reserve, student)).status, 409);
  const nextRoute = (await get('catalog')).routes.find((item) => item.code === 'R02');
  assert.equal((await send('my/ride', { routeId: nextRoute.id, stopId: nextRoute.stops[0].id }, student)).status, 200);
  const nextRide = await get('my/ride', student);
  assert.equal(nextRide.qrToken, qrToken);
  assert.equal(nextRide.reservation.routeId, nextRoute.id);
  assert.equal((await get('my/tracking', student)).tracking.alightedAt, null);
  assert.deepEqual((await get('my/history', student)).history, [record]);
  assert.equal((await send('driver/vehicle', { name: 'Combi 02', plate: 'TEX-020', capacity: 1 }, driver)).status, 200);
  assert.equal((await get('my/history', student)).history[0].plate, 'TEX-010');
});

test('La proximidad genera un aviso por reservación y dispositivo elegibles', async (t) => {
  const sendPush = t.mock.method(webpush, 'sendNotification', async () => {});
  const request = await start(t, { pushSubject: 'https://example.com' });
  const driver = await signIn(request, 'chofer');
  const student = await signIn(request, 'alumno');
  const send = (path, body, cookie) => request('/api/' + path, { method: 'POST', body, cookie });
  const config = (await request('/api/config')).data;
  assert.match(config.pushKey, /^[\w-]+$/);
  const endpoint = 'https://fcm.googleapis.com/fcm/send/uptex-test';
  const subscription = { endpoint, keys: { p256dh: config.pushKey, auth: Buffer.alloc(16).toString('base64url') } };
  assert.equal((await send('my/push', { ...subscription, endpoint: 'https://example.com/push' }, student)).status, 400);
  assert.equal((await send('my/push', subscription, student)).status, 200);
  const route = (await request('/api/catalog')).data.routes[0];
  assert.equal((await send('my/ride', { routeId: route.id, stopId: route.stops[2].id }, student)).status, 200);
  assert.equal((await send('driver/vehicle', { name: 'Combi', plate: 'TEX-01' }, driver)).status, 200);
  const shift = (await send('driver/shift', { routeId: route.id, action: 'departure' }, driver)).data.shift;
  const locate = async (index) => {
    const { lat, lng } = route.stops[index];
    assert.equal((await send('driver/location', { lat, lng, tripId: shift.tripId }, driver)).status, 200);
  };
  await locate(0);
  assert.equal(sendPush.mock.callCount(), 0);
  await locate(1);
  assert.equal(sendPush.mock.callCount(), 1);
  assert.equal(sendPush.mock.calls[0].arguments[0].endpoint, endpoint);
  assert.equal(JSON.parse(sendPush.mock.calls[0].arguments[1]).title, 'Tu combi se acerca');
  await locate(2);
  assert.equal(sendPush.mock.callCount(), 1);
});

