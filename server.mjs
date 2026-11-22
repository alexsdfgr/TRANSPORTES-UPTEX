import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createOperations } from './operations.mjs';
import { createProximity, pushEndpoint } from './proximity.mjs';
import {
  colors, demoAccounts, demoPassword, digest, localDate, noticeKinds, openStore,
  passwordHash, readNotices, readRoutes, roles, transaction, verifyPassword, writeRoute,
} from './store.mjs';

const assets = new Map(Object.entries({
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/maps.js': ['maps.js', 'text/javascript; charset=utf-8'],
  '/operations.js': ['operations.js', 'text/javascript; charset=utf-8'],
  '/icons.js': ['icons.js', 'text/javascript; charset=utf-8'],
  '/sw.js': ['sw.js', 'text/javascript; charset=utf-8'],
  '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'],
  '/uptex-logo.jpg': ['uptex-logo.jpg', 'image/jpeg'],
  '/qrcode.min.js': ['qrcode.min.js', 'text/javascript; charset=utf-8'],
  '/jsqr.js': ['jsqr.js', 'text/javascript; charset=utf-8'],
  '/icon-192.png': ['icon-192.png', 'image/png'],
  '/icon-512.png': ['icon-512.png', 'image/png'],
}));
const secureHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(self)',
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function check(valid, message, status = 400) {
  if (!valid) throw new HttpError(status, message);
}

function text(value, limit, label, optional = false) {
  check(typeof value === 'string' && value.trim().length <= limit && (optional || value.trim().length), label + ' no es válido.');
  return value.trim();
}

function time(value, label) {
  if (value === null || value === '') return null;
  check(typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value), label + ' no es válida.');
  return value;
}

function emailAddress(value) {
  const email = text(value, 180, 'El correo').toLowerCase();
  check(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'El correo no es válido.');
  return email;
}

async function readBody(req) {
  check(req.headers['content-type']?.split(';')[0] === 'application/json', 'Usa contenido JSON.', 415);
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 80_000) break;
    chunks.push(chunk);
  }
  check(size <= 80_000, 'La solicitud excede el tamaño máximo.', 413);
  let data;
  try {
    data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'No se pudo leer la solicitud.');
  }
  check(data && typeof data === 'object' && !Array.isArray(data), 'Se esperaba un objeto JSON.');
  return data;
}

function json(res, status, data, extra = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
  res.end(JSON.stringify(data));
}

function historyCursor(searchParams) {
  const before = searchParams.get('before');
  check(before === null || (/^[1-9]\d*$/.test(before) && Number.isSafeInteger(Number(before))), 'Página de historial no válida.');
  return before === null ? null : Number(before);
}

function routeInput(db, body, id) {
  const code = text(body.code, 12, 'El código').toUpperCase();
  const name = text(body.name, 100, 'El nombre');
  const zone = text(body.zone, 60, 'La zona', true);
  const notes = text(body.notes, 600, 'Las notas', true);
  check(/^[A-Z0-9-]{2,12}$/.test(code), 'El código debe tener de 2 a 12 letras, números o guiones.');
  check(!db.prepare('SELECT id FROM routes WHERE code = ? AND id != ?').get(code, id ?? 0), 'Ese código ya existe.', 409);
  check(colors.includes(body.color) && ['active', 'draft'].includes(body.status), 'El color o el estado no es válido.');
  const departure = time(body.departure, 'La hora de salida');
  const arrival = time(body.arrival, 'La hora de llegada');
  check(!departure || !arrival || departure <= arrival, 'La llegada debe ser igual o posterior a la salida.');
  let driverId = null;
  if (body.driverId !== null) {
    check(Number.isInteger(body.driverId) && db.prepare("SELECT id FROM users WHERE id = ? AND role = 'driver' AND active = 1").get(body.driverId), 'Selecciona un chofer activo.');
    driverId = body.driverId;
  }
  check(Array.isArray(body.stops) && body.stops.length <= 27, 'Una ruta admite hasta 27 paradas.');
  check(body.status === 'draft' || (departure && body.stops.length >= 2), 'Para publicar se requiere una salida y al menos dos paradas.');
  let previousTime = departure;
  const stops = body.stops.map((stop) => {
    check(stop && typeof stop === 'object', 'La parada no es válida.');
    const name = text(stop.name, 140, 'El nombre de la parada');
    const stopTime = time(stop.time, 'La hora de la parada');
    const { lat, lng, fare } = stop;
    check(Number.isFinite(lat) && Math.abs(lat) <= 90 && Number.isFinite(lng) && Math.abs(lng) <= 180, 'Revisa la latitud y longitud de las paradas.');
    check(fare === null || (Number.isFinite(fare) && fare >= 0 && fare <= 9999), 'La tarifa no es válida.');
    if (stopTime) {
      check((!previousTime || previousTime <= stopTime) && (!arrival || stopTime <= arrival), 'Las horas de las paradas deben respetar el orden del itinerario.');
      previousTime = stopTime;
    }
    return { name, lat, lng, fare, time: stopTime };
  });
  return { code, name, zone, notes, color: body.color, status: body.status, driverId, departure, arrival, stops };
}

const passengerRoles = ['student', 'teacher'];
const userFields = 'id,email,name,role,active,matricula';
export function createApp({
  dbPath = resolve('data', 'uptex.sqlite'), demo = true, secureCookies = false,
  browserKey = '', mapId = '', adminEmail = '', adminPassword = '', pushSubject = '',
} = {}) {
  const db = openStore(dbPath, { demo, adminEmail: adminEmail ? emailAddress(adminEmail) : '', adminPassword });
  const operations = createOperations(db, check);
  const proximity = createProximity(db, pushSubject, operations.proximityCandidates, check);
  const subscribers = new Set();
  const attempts = new Map();
  const sessionLifetime = 12 * 60 * 60 * 1000;
  const cookie = (value, maxAge) => 'uptex_session=' + value + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + maxAge + (secureCookies ? '; Secure' : '');

  function session(req) {
    const token = req.headers.cookie?.match(/(?:^|;\s*)uptex_session=([a-f0-9]{64})(?:;|$)/)?.[1];
    return token ? digest(token) : null;
  }

  function currentUser(req) {
    const token = session(req);
    if (!token) return null;
    return db.prepare('SELECT u.id,u.email,u.name,u.role,u.active,u.matricula FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=? AND s.expires>? AND u.active=1')
      .get(token, Date.now()) ?? null;
  }

  function matrícula(value, userId = 0) {
    const input = text(value ?? '', 30, 'La matrícula', true).toUpperCase();
    check(!input || /^[A-Z0-9-]+$/.test(input), 'La matrícula admite letras, números y guiones.');
    check(!input || !db.prepare('SELECT id FROM users WHERE matricula=? AND id<>?').get(input, userId), 'Esa matrícula ya está registrada.', 409);
    return input || null;
  }

  function liveStream(req, res, user) {
    check([...subscribers].filter((entry) => entry.userId === user.id).length < 8, 'Hay demasiadas conexiones en vivo.', 429);
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no' });
    const entry = { req, res, userId: user.id };
    subscribers.add(entry);
    res.write('retry: 5000\nevent: refresh\ndata: {}\n\n');
    const heartbeat = setInterval(() => {
      if (!currentUser(req) || res.writableLength > 16_384) return res.end();
      res.write(': heartbeat\n\n');
    }, 20_000);
    heartbeat.unref();
    res.once('close', () => { clearInterval(heartbeat); subscribers.delete(entry); });
  }

  function announce(routeId, userId = null) {
    for (const entry of subscribers) {
      const user = currentUser(entry.req);
      if (!user || entry.res.writableLength > 16_384) { entry.res.end(); continue; }
      const relevant = user.role === 'admin' || user.id === userId || (user.role === 'driver'
        ? db.prepare('SELECT 1 FROM routes WHERE id=? AND driver_id=? UNION SELECT 1 FROM trips WHERE route_id=? AND date=? AND driver_id=?').get(routeId, user.id, routeId, localDate(), user.id)
        : db.prepare("SELECT 1 FROM reservations WHERE route_id=? AND user_id=? AND service_date=? AND status='reserved'").get(routeId, user.id, localDate()));
      if (relevant) entry.res.write('event: refresh\ndata: {}\n\n');
    }
  }

  function login(req, res, body) {
    const now = Date.now();
    for (const [key, entry] of attempts) if (entry.until <= now) attempts.delete(key);
    const ip = req.socket.remoteAddress;
    const attempt = attempts.get(ip) ?? { count: 0, until: now + 10 * 60 * 1000 };
    check(attempt.count < 20, 'Demasiados intentos. Intenta de nuevo en unos minutos.', 429);
    const password = text(body.password, 160, 'La contraseña');
    const email = emailAddress(body.email);
    const account = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!verifyPassword(password, account?.password) || !account?.active) {
      if (attempts.size >= 4096 && !attempts.has(ip)) attempts.delete(attempts.keys().next().value);
      attempts.set(ip, { ...attempt, count: attempt.count + 1 });
      throw new HttpError(401, 'Correo o contraseña incorrectos.');
    }
    attempts.delete(ip);
    const token = randomBytes(32).toString('hex');
    transaction(db, () => {
      db.prepare('DELETE FROM sessions WHERE expires <= ? OR token = ?').run(now, session(req));
      db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(token), account.id, now + sessionLifetime);
    });
    const { id, name, role, matricula } = account;
    json(res, 200, { user: { id, email, name, role, matricula } }, { 'Set-Cookie': cookie(token, sessionLifetime / 1000) });
  }

  function saveUser(body, id) {
    const email = emailAddress(body.email);
    const name = text(body.name, 120, 'El nombre');
    const { role, active } = body;
    check(roles.includes(role) && typeof active === 'boolean', 'Revisa el rol y el estado.');
    const previous = id && db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    check(!id || previous, 'El usuario no existe.', 404);
    const matricula = matrícula(body.matricula ?? previous?.matricula, id ?? 0);
    check(!db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email, id ?? 0), 'Ese correo ya está registrado.', 409);
    const password = text(body.password, 160, 'La contraseña', Boolean(id));
    check((id && !password) || password.length >= 12, 'La contraseña debe tener al menos 12 caracteres.');
    if (previous?.active && previous.role === 'admin' && (!active || role !== 'admin')) {
      check(db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND active = 1").get().count > 1, 'Debe quedar una cuenta de coordinación activa.', 409);
    }
    if (!id) {
      id = db.prepare('INSERT INTO users(email,name,role,active,password,matricula) VALUES(?,?,?,?,?,?)').run(email, name, role, Number(active), passwordHash(password), matricula).lastInsertRowid;
    } else {
      db.prepare('UPDATE users SET email=?,name=?,role=?,active=?,password=?,matricula=? WHERE id=?')
        .run(email, name, role, Number(active), password ? passwordHash(password) : previous.password, matricula, id);
      if (!active || role !== previous.role || password || email !== previous.email) {
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
      }
      if (!active || role !== 'driver') db.prepare('UPDATE routes SET driver_id=NULL WHERE driver_id=?').run(id);
      if (!active || !passengerRoles.includes(role)) db.prepare('DELETE FROM push_subscriptions WHERE user_id=?').run(id);
    }
    if (passengerRoles.includes(role)) db.prepare('INSERT OR IGNORE INTO passenger_profiles(user_id,qr_token) VALUES(?,?)').run(id, randomBytes(32).toString('hex'));
    return db.prepare('SELECT ' + userFields + ' FROM users WHERE id = ?').get(id);
  }

  function recordTrip(user, routeId, action) {
    const route = db.prepare("SELECT * FROM routes WHERE id=? AND status='active'").get(routeId);
    check(route, 'La ruta no está disponible.', 404);
    const date = localDate();
    const trip = db.prepare('SELECT * FROM trips WHERE route_id=? AND date=?').get(routeId, date);
    const driver = user.role === 'driver' && (user.id === route.driver_id || (action === 'arrival' && user.id === trip?.driver_id));
    check(user.role === 'admin' || driver, 'Solo coordinación o el chofer a cargo puede registrar este viaje.', 403);
    check(['departure', 'arrival'].includes(action), 'El registro no es válido.');
    if (action === 'departure') {
      check(!trip, 'La salida de hoy ya quedó registrada.', 409);
      const driverId = route.driver_id ?? user.id;
      check(!db.prepare('SELECT id FROM trips WHERE driver_id=? AND date=? AND arrived_at IS NULL').get(driverId, date), 'Ya hay un turno activo para el chofer.', 409);
      const vehicle = db.prepare('SELECT id FROM vehicles WHERE driver_id=? AND active=1').get(driverId);
      check(!vehicle || !db.prepare('SELECT id FROM boardings WHERE vehicle_id=? AND alighted_at IS NULL').get(vehicle.id), 'Registra la bajada de los pasajeros del turno anterior.', 409);
      db.prepare('INSERT INTO trips(route_id,driver_id,date,planned_departure,planned_arrival,departed_at,vehicle_id) VALUES(?,?,?,?,?,?,?)')
        .run(routeId, driverId, date, route.departure, route.arrival, new Date().toISOString(), vehicle?.id ?? null);
      return;
    }
    check(trip && !trip.arrived_at, 'Registra una salida vigente antes de marcar la llegada.', 409);
    check(!db.prepare(`SELECT b.id FROM boardings b JOIN reservations x ON x.id=b.reservation_id
      WHERE b.driver_id=? AND x.route_id=? AND b.alighted_at IS NULL`).get(trip.driver_id, routeId), 'Registra la bajada de los pasajeros antes de finalizar el turno.', 409);
    db.prepare('UPDATE trips SET arrived_at=? WHERE id=?').run(new Date().toISOString(), trip.id);
    db.prepare('DELETE FROM driver_locations WHERE trip_id=?').run(trip.id);
  }

  function scanPassenger(user, body) {
    const action = body.action;
    check(['board', 'alight'].includes(action), 'Selecciona abordar o bajar.');
    const token = text(body.qrToken, 100, 'El código QR');
    const passenger = db.prepare(`SELECT u.id,u.name,u.role,u.active FROM passenger_profiles p JOIN users u ON u.id=p.user_id
      WHERE p.qr_token=?`).get(token);
    check(passenger, 'Código QR no reconocido.', 404);
    const now = new Date().toISOString();
    const aboard = db.prepare(`SELECT b.id,b.driver_id AS driverId,x.route_id AS routeId FROM boardings b
      JOIN reservations x ON x.id=b.reservation_id WHERE x.user_id=? AND b.alighted_at IS NULL ORDER BY b.id DESC`).all(passenger.id);
    if (action === 'alight') {
      const boarding = aboard.find((item) => item.driverId === user.id || user.role === 'admin');
      check(boarding, 'No hay un abordaje activo de este pasajero en tu unidad.', 409);
      const stop = body.stopId == null
        ? db.prepare('SELECT id,name FROM stops WHERE route_id=? AND active=1 ORDER BY position DESC LIMIT 1').get(boarding.routeId)
        : db.prepare('SELECT id,name FROM stops WHERE id=? AND route_id=? AND active=1').get(body.stopId, boarding.routeId);
      check(stop, 'Selecciona una parada de bajada de esta ruta.');
      db.prepare('UPDATE boardings SET alighted_at=?,alight_stop_id=? WHERE id=?').run(now, stop.id, boarding.id);
      return { registered: true, action, at: now, passenger: passenger.name, stop: stop.name, routeId: boarding.routeId };
    }
    check(passenger.active && passengerRoles.includes(passenger.role), 'El pase del pasajero no está activo.', 403);
    check(!aboard.length, 'El pasajero ya está a bordo.', 409);
    const reservation = db.prepare(`SELECT x.id,x.route_id AS routeId,x.stop_id AS stopId,s.name AS stop
      FROM reservations x JOIN stops s ON s.id=x.stop_id WHERE x.user_id=? AND x.service_date=? AND x.status='reserved'`).get(passenger.id, localDate());
    check(reservation, 'El pasajero no tiene una reservación para hoy.', 404);
    const shift = db.prepare(`SELECT t.driver_id AS driverId,v.id AS vehicleId,v.capacity FROM trips t
      JOIN vehicles v ON v.id=t.vehicle_id OR (t.vehicle_id IS NULL AND v.driver_id=t.driver_id AND v.active=1)
      WHERE t.route_id=? AND t.date=? AND t.arrived_at IS NULL`).get(reservation.routeId, localDate());
    check(shift && (shift.driverId === user.id || user.role === 'admin'), 'La reservación no corresponde al turno activo de esta unidad.', 403);
    check(!db.prepare('SELECT id FROM boardings WHERE reservation_id=?').get(reservation.id), 'Este pase ya se usó para el viaje de hoy.', 409);
    const occupied = db.prepare('SELECT COUNT(*) AS count FROM boardings WHERE vehicle_id=? AND alighted_at IS NULL').get(shift.vehicleId).count;
    check(occupied < shift.capacity, 'La unidad está llena. Registra una bajada para liberar un lugar.', 409);
    const stop = body.stopId == null ? { id: reservation.stopId, name: reservation.stop }
      : db.prepare('SELECT id,name FROM stops WHERE id=? AND route_id=? AND active=1').get(body.stopId, reservation.routeId);
    check(stop, 'Selecciona una parada de abordaje de esta ruta.');
    db.prepare(`INSERT INTO boardings(reservation_id,driver_id,vehicle_id,boarded_at,board_stop_id,plate_at_boarding)
      VALUES(?,?,?,?,?,(SELECT plate FROM vehicles WHERE id=?))`).run(reservation.id, shift.driverId, shift.vehicleId, now, stop.id, shift.vehicleId);
    return { registered: true, action, at: now, passenger: passenger.name, stop: stop.name, routeId: reservation.routeId };
  }

  async function api(req, res, url) {
    const { pathname, searchParams } = url;
    const { method } = req;
    const writing = !['GET', 'HEAD', 'OPTIONS'].includes(method);
    if (writing) {
      check(req.headers['x-uptex-request'] === '1' && !['cross-site', 'same-site'].includes(req.headers['sec-fetch-site']), 'Solicitud fuera del origen permitido.', 403);
    }
    const user = currentUser(req);
    if (method === 'GET' && pathname === '/api/health') return json(res, 200, { status: 'ok' });
    if (method === 'GET' && pathname === '/api/catalog') {
      return json(res, 200, { routes: readRoutes(db), notices: readNotices(db, null) });
    }
    if (method === 'GET' && pathname === '/api/notices') {
      return json(res, 200, { notices: readNotices(db, user) });
    }
    if (method === 'GET' && pathname === '/api/config') {
      return json(res, 200, { demo, browserKey, mapId, pushKey: proximity.publicKey, demoAccounts: demo ? demoAccounts.map(([email, name, role]) => ({ email, name, role })) : [] });
    }
    if (method === 'GET' && pathname === '/api/session') return json(res, 200, { user });
    if (method === 'POST' && pathname === '/api/login') return login(req, res, await readBody(req));
    if (method === 'POST' && pathname === '/api/register') {
      const body = await readBody(req);
      const name = text(body.name, 120, 'El nombre');
      const email = emailAddress(body.email);
      const role = body.role;
      check(['student', 'teacher'].includes(role), 'Selecciona alumno o maestro.');
      const password = text(body.password, 160, 'La contraseña');
      check(password.length >= 12, 'La contraseña debe tener al menos 12 caracteres.');
      const token = randomBytes(32).toString('hex');
      transaction(db, () => {
        check(!db.prepare('SELECT id FROM users WHERE email=?').get(email), 'Ese correo ya está registrado.', 409);
        const userId = db.prepare('INSERT INTO users(email,name,role,password,matricula) VALUES(?,?,?,?,?)')
          .run(email, name, role, passwordHash(password), matrícula(body.matricula)).lastInsertRowid;
        db.prepare('INSERT INTO passenger_profiles(user_id,qr_token) VALUES(?,?)').run(userId,token);
        return userId;
      });
      return json(res, 201, { message: 'Cuenta creada. Inicia sesión para reservar tu ruta.' });
    }
    if (method === 'POST' && pathname === '/api/logout') {
      const endpoint = req.headers['content-type'] ? pushEndpoint((await readBody(req)).endpoint) : null;
      if (user && endpoint) proximity.remove(user.id, endpoint);
      db.prepare('DELETE FROM sessions WHERE token=?').run(session(req));
      for (const entry of subscribers) if (session(req) === session(entry.req)) entry.res.end();
      return json(res, 200, {}, { 'Set-Cookie': cookie('', 0) });
    }
    check(user, 'Inicia sesión para continuar.', 401);
    if (method === 'GET' && pathname === '/api/live') return liveStream(req, res, user);
    if (method === 'GET' && ['/api/my/tracking', '/api/my/history'].includes(pathname)) {
      check(passengerRoles.includes(user.role), 'Esta sección es para pasajeros.', 403);
      if (pathname.endsWith('/tracking')) return json(res, 200, { tracking: operations.passengerTracking(user.id) });
      return json(res, 200, operations.history(user.id, '', historyCursor(searchParams)));
    }
    if (['POST', 'DELETE'].includes(method) && pathname === '/api/my/push') {
      check(passengerRoles.includes(user.role), 'Esta sección es para pasajeros.', 403);
      const body = await readBody(req);
      if (method === 'POST') {
        proximity.subscribe(user.id, body);
        const tracking = operations.passengerTracking(user.id);
        if (tracking) proximity.notify(tracking.routeId);
      } else {
        const endpoint = pushEndpoint(body.endpoint);
        check(endpoint, 'Suscripción de notificaciones no válida.');
        proximity.remove(user.id, endpoint);
      }
      return json(res, 200, {});
    }
    if (method === 'GET' && pathname === '/api/my/ride') {
      check(['student','teacher'].includes(user.role), 'Solo alumnos y maestros pueden consultar sus viajes.', 403);
      const profile = db.prepare('SELECT qr_token AS qrToken FROM passenger_profiles WHERE user_id=?').get(user.id);
      const reservation = db.prepare(`SELECT x.route_id AS routeId,x.stop_id AS stopId,b.id AS boardingId,b.boarded_at AS boardedAt,b.alighted_at AS alightedAt,
        v.name AS vehicle,COALESCE(b.plate_at_boarding,v.plate) AS plate,r.code,r.name AS route,s.name AS stop,r.departure,du.name AS driver
        FROM reservations x JOIN routes r ON r.id=x.route_id JOIN stops s ON s.id=x.stop_id LEFT JOIN boardings b ON b.reservation_id=x.id
        LEFT JOIN users du ON du.id=COALESCE(b.driver_id,r.driver_id)
        LEFT JOIN vehicles v ON v.id=b.vehicle_id OR (b.id IS NULL AND v.driver_id=r.driver_id AND v.active=1)
        WHERE x.user_id=? AND x.service_date=? AND x.status='reserved'`).get(user.id,localDate());
      return json(res,200,{qrToken:profile?.qrToken??null,reservation:reservation??null,routes:readRoutes(db)});
    }
    if (method === 'POST' && pathname === '/api/my/ride') {
      check(['student','teacher'].includes(user.role), 'Solo alumnos y maestros pueden reservar.', 403);
      const body=await readBody(req); const routeId=Number(body.routeId),stopId=Number(body.stopId);
      check(db.prepare("SELECT id FROM routes WHERE id=? AND status='active'").get(routeId),'Selecciona una ruta activa.');
      check(db.prepare('SELECT id FROM stops WHERE id=? AND route_id=? AND active=1').get(stopId,routeId),'Selecciona una parada de esa ruta.');
      const today = localDate();
      const current = db.prepare(`SELECT x.id,x.route_id AS routeId,x.stop_id AS stopId,b.id AS boardingId FROM reservations x
        LEFT JOIN boardings b ON b.reservation_id=x.id WHERE x.user_id=? AND x.service_date=?`).get(user.id, today);
      const id = transaction(db, () => {
        check(!current?.boardingId, 'No puedes cambiar la reservación después de abordar.', 409);
        if (current && (current.routeId !== routeId || current.stopId !== stopId)) db.prepare('DELETE FROM proximity_notices WHERE reservation_id=?').run(current.id);
        return db.prepare(`INSERT INTO reservations(user_id,route_id,stop_id,service_date,created_at) VALUES(?,?,?,?,?)
          ON CONFLICT(user_id,service_date) DO UPDATE SET route_id=excluded.route_id,stop_id=excluded.stop_id,status='reserved',created_at=excluded.created_at
          RETURNING id`).get(user.id, routeId, stopId, today, new Date().toISOString()).id;
      });
      if (current && current.routeId !== routeId) announce(current.routeId);
      announce(routeId, user.id);
      proximity.notify(routeId);
      return json(res,200,{id});
    }
    if (method === 'GET' && pathname === '/api/driver/state') {
      check(['driver', 'admin'].includes(user.role), 'Solo choferes o coordinación.', 403);
      return json(res, 200, operations.driverState(user.id));
    }
    if (method === 'POST' && pathname === '/api/driver/vehicle') {
      check(['driver', 'admin'].includes(user.role), 'Solo choferes pueden registrar una unidad.', 403);
      const body = await readBody(req);
      const name = text(body.name, 80, 'El nombre de unidad');
      const plate = text(body.plate, 16, 'La placa').toUpperCase();
      const model = text(body.model ?? '', 80, 'El modelo', true);
      const capacity = Number(body.capacity || 20);
      check(Number.isInteger(capacity) && capacity >= 1 && capacity <= 100, 'Capacidad no válida.');
      transaction(db, () => {
        const vehicle = db.prepare('SELECT id,plate FROM vehicles WHERE driver_id=?').get(user.id);
        const occupied = vehicle ? db.prepare('SELECT COUNT(*) AS count FROM boardings WHERE vehicle_id=? AND alighted_at IS NULL').get(vehicle.id).count : 0;
        check(capacity >= occupied, 'La capacidad no puede ser menor que el aforo actual.', 409);
        const shift = db.prepare('SELECT id FROM trips WHERE driver_id=? AND date=? AND arrived_at IS NULL').get(user.id, localDate());
        check(!vehicle || vehicle.plate === plate || (!occupied && !shift), 'Finaliza el turno y registra las bajadas para cambiar de placas.', 409);
        check(!db.prepare('SELECT id FROM vehicles WHERE plate=? AND driver_id<>?').get(plate, user.id), 'Esa placa ya está registrada en otra unidad.', 409);
        db.prepare(`INSERT INTO vehicles(driver_id,name,plate,model,capacity,created_at) VALUES(?,?,?,?,?,?)
          ON CONFLICT(driver_id) DO UPDATE SET name=excluded.name,plate=excluded.plate,model=excluded.model,capacity=excluded.capacity,active=1`)
          .run(user.id, name, plate, model, capacity, new Date().toISOString());
      });
      for (const assignment of operations.driverState(user.id).assignments) announce(assignment.routeId, user.id);
      return json(res, 200, {});
    }
    if (method === 'POST' && pathname === '/api/driver/shift') {
      check(user.role === 'driver', 'Solo choferes pueden iniciar o finalizar su turno.', 403);
      const body = await readBody(req);
      const { routeId, action } = body;
      check(Number.isSafeInteger(routeId) && ['departure', 'arrival'].includes(action), 'Selecciona una ruta y una acción válidas.');
      transaction(db, () => {
        check(action === 'arrival' || db.prepare('SELECT id FROM vehicles WHERE driver_id=? AND active=1').get(user.id), 'Registra la unidad antes de iniciar el turno.', 409);
        recordTrip(user, routeId, action);
      });
      announce(routeId, user.id);
      return json(res, 200, operations.driverState(user.id));
    }
    if (method === 'POST' && pathname === '/api/driver/scan') {
      check(['driver', 'admin'].includes(user.role), 'Solo el chofer o coordinación pueden escanear.', 403);
      const body = await readBody(req);
      check(body.stopId == null || Number.isSafeInteger(body.stopId), 'Selecciona una parada válida.');
      const result = transaction(db, () => scanPassenger(user, body));
      announce(result.routeId, user.id);
      return json(res, 200, result);
    }
    if (method === 'POST' && pathname === '/api/driver/location') {
      check(user.role === 'driver', 'Solo choferes pueden compartir ubicación.', 403);
      const body = await readBody(req);
      const routeId = transaction(db, () => operations.locate(user.id, body));
      if (routeId !== null) {
        announce(routeId);
        proximity.notify(routeId);
      }
      return json(res, 200, {});
    }
    if (method === 'GET' && pathname === '/api/dashboard') {
      return json(res, 200, { routes: readRoutes(db, false, user), notices: readNotices(db, user) });
    }
    const readMatch = pathname.match(/^\/api\/notices\/([1-9]\d*)\/read$/);
    if (method === 'POST' && readMatch) {
      const id = Number(readMatch[1]);
      check(readNotices(db, user).some((notice) => notice.id === id), 'El aviso no está disponible.', 404);
      db.prepare('INSERT OR IGNORE INTO notice_reads VALUES(?,?)').run(user.id, id);
      return json(res, 200, {});
    }
    const tripMatch = pathname.match(/^\/api\/routes\/([1-9]\d*)\/trip$/);
    if (method === 'POST' && tripMatch) {
      const body = await readBody(req);
      const routeId = Number(tripMatch[1]);
      transaction(db, () => recordTrip(user, routeId, body.action));
      announce(routeId, user.id);
      return json(res, 200, {});
    }
    check(pathname.startsWith('/api/admin/'), 'Recurso no encontrado.', 404);
    check(user.role === 'admin', 'Esta sección requiere permisos de coordinación.', 403);
    if (method === 'GET' && pathname === '/api/admin/radar') return json(res, 200, { units: operations.radar() });
    if (method === 'GET' && pathname === '/api/admin/history') {
      return json(res, 200, operations.history(null, text(searchParams.get('q') ?? '', 120, 'La búsqueda', true), historyCursor(searchParams)));
    }
    if (method === 'GET' && pathname === '/api/admin/ridership') {
      const date = searchParams.get('date') || localDate();
      const parsed = new Date(date + 'T00:00:00Z');
      check(/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(parsed.getTime()) && parsed.toISOString().startsWith(date), 'Selecciona una fecha válida.');
      return json(res, 200, operations.ridership(date));
    }
    if (method === 'GET' && pathname === '/api/admin/state') {
      return json(res, 200, {
        routes: readRoutes(db, true, user),
        users: db.prepare('SELECT ' + userFields + ' FROM users ORDER BY name').all(),
        notices: readNotices(db, user, true),
        trips: db.prepare('SELECT t.date,t.departed_at AS departedAt,t.arrived_at AS arrivedAt,t.planned_departure AS plannedDeparture,t.planned_arrival AS plannedArrival,r.code,r.name FROM trips t JOIN routes r ON r.id=t.route_id ORDER BY t.departed_at DESC LIMIT 60').all(),
        vehicles: db.prepare("SELECT v.id,v.name,v.plate,v.model,v.capacity,u.name AS driver,u.email AS driverEmail,r.code AS routeCode,r.name AS route FROM vehicles v JOIN users u ON u.id=v.driver_id LEFT JOIN routes r ON r.driver_id=u.id AND r.status='active' WHERE v.active=1 ORDER BY u.name").all(),
        locations: db.prepare(`SELECT l.lat,l.lng,l.updated_at AS updatedAt,u.name AS driver,r.code AS routeCode,r.name AS route
          FROM driver_locations l JOIN users u ON u.id=l.driver_id JOIN routes r ON r.id=l.route_id
          WHERE r.status='active' AND l.updated_at>=? ORDER BY l.updated_at DESC`).all(new Date(Date.now() - 120_000).toISOString()),
        passengers: db.prepare(`SELECT x.service_date AS date,u.name AS passenger,u.role,r.code AS routeCode,r.name AS route,
          s.name AS stop,v.name AS vehicle,COALESCE(b.plate_at_boarding,v.plate) AS plate,d.name AS driver,
          b.boarded_at AS boardedAt,b.alighted_at AS alightedAt
          FROM reservations x JOIN users u ON u.id=x.user_id JOIN routes r ON r.id=x.route_id JOIN stops s ON s.id=x.stop_id
          LEFT JOIN boardings b ON b.reservation_id=x.id LEFT JOIN users d ON d.id=COALESCE(b.driver_id,r.driver_id)
          LEFT JOIN vehicles v ON v.id=b.vehicle_id OR (b.id IS NULL AND v.driver_id=r.driver_id AND v.active=1)
          WHERE x.service_date=? AND x.status='reserved' ORDER BY r.code,s.position,u.name`).all(localDate()),
      });
    }
    const routeMatch = pathname.match(/^\/api\/admin\/routes(?:\/([1-9]\d*))?$/);
    if (routeMatch && ((method === 'POST' && !routeMatch[1]) || (method === 'PUT' && routeMatch[1]))) {
      const id = routeMatch[1] ? Number(routeMatch[1]) : null;
      const body = await readBody(req);
      const routeId = transaction(db, () => {
        check(!id || db.prepare('SELECT id FROM routes WHERE id=?').get(id), 'La ruta no existe.', 404);
        const route = routeInput(db, body, id);
        check(!db.prepare('SELECT id FROM trips WHERE route_id=? AND date=? AND arrived_at IS NULL').get(id, localDate()), 'Finaliza el turno antes de editar esta ruta.', 409);
        return writeRoute(db, route, id);
      });
      announce(routeId);
      return json(res, id ? 200 : 201, { id: routeId });
    }
    const userMatch = pathname.match(/^\/api\/admin\/users(?:\/([1-9]\d*))?$/);
    if (userMatch && ((method === 'POST' && !userMatch[1]) || (method === 'PUT' && userMatch[1]))) {
      const body = await readBody(req);
      const id = userMatch[1] ? Number(userMatch[1]) : null;
      const saved = transaction(db, () => saveUser(body, id));
      return json(res, id ? 200 : 201, { user: saved });
    }
    if (method === 'POST' && pathname === '/api/admin/notices') {
      const body = await readBody(req);
      const title = text(body.title, 100, 'El título');
      const content = text(body.body, 600, 'El mensaje');
      check(noticeKinds.includes(body.kind), 'El tipo de aviso no es válido.');
      check(body.routeId === null || (Number.isInteger(body.routeId) && db.prepare("SELECT id FROM routes WHERE id=? AND status='active'").get(body.routeId)), 'Selecciona una ruta publicada.');
      const { lastInsertRowid } = db.prepare('INSERT INTO notices(title,body,kind,route_id,created_at) VALUES(?,?,?,?,?)')
        .run(title, content, body.kind, body.routeId, new Date().toISOString());
      return json(res, 201, { id: lastInsertRowid });
    }
    const noticeMatch = pathname.match(/^\/api\/admin\/notices\/([1-9]\d*)$/);
    if (method === 'PUT' && noticeMatch) {
      const body = await readBody(req);
      check(typeof body.published === 'boolean', 'El estado de publicación no es válido.');
      const { changes } = db.prepare('UPDATE notices SET published=? WHERE id=?').run(Number(body.published), Number(noticeMatch[1]));
      check(changes, 'El aviso no existe.', 404);
      return json(res, 200, {});
    }
    throw new HttpError(404, 'Recurso no encontrado.');
  }

  const server = createServer(async (req, res) => {
    for (const [header, value] of Object.entries(secureHeaders)) res.setHeader(header, value);
    try {
      const url = new URL(req.url, 'http://localhost');
      const { pathname } = url;
      if (pathname.startsWith('/api/')) return await api(req, res, url);
      if (['GET', 'HEAD'].includes(req.method) && assets.has(pathname)) {
        const [filename, mime] = assets.get(pathname);
        const content = await readFile(new URL('./public/' + filename, import.meta.url));
        res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache', 'Content-Length': content.length });
        return res.end(req.method === 'HEAD' ? undefined : content);
      }
      json(res, 404, { error: 'Recurso no encontrado.' });
    } catch (error) {
      if (!(error instanceof HttpError)) console.error(error);
      if (!res.headersSent && !res.destroyed) json(res, error.status ?? 500, { error: error.status ? error.message : 'Ocurrió un error interno.' });
    }
  });
  server.on('close', () => db.close());
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || '3000');
  const demo = process.env.DEMO_MODE ? process.env.DEMO_MODE === '1' : ['127.0.0.1', 'localhost', '::1'].includes(host);
  const server = createApp({
    demo,
    dbPath: resolve(process.env.DB_PATH || (demo ? 'data/demo.sqlite' : 'data/uptex.sqlite')),
    secureCookies: process.env.SECURE_COOKIES === '1',
    browserKey: process.env.GOOGLE_MAPS_BROWSER_KEY || '',
    mapId: process.env.GOOGLE_MAPS_MAP_ID || '',
    adminEmail: process.env.ADMIN_EMAIL || '',
    adminPassword: process.env.ADMIN_PASSWORD || '',
    pushSubject: process.env.WEB_PUSH_SUBJECT || (process.env.RAILWAY_PUBLIC_DOMAIN ? 'https://' + process.env.RAILWAY_PUBLIC_DOMAIN : ''),
  });
  server.listen(port, host, () => console.log('Transportes UPTex en http://' + (host === '0.0.0.0' ? 'localhost' : host) + ':' + server.address().port));
}
