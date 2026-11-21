import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  colors, demoAccounts, demoPassword, digest, localDate, noticeKinds, openStore,
  passwordHash, readNotices, readRoutes, roles, transaction, verifyPassword, writeRoute,
} from './store.mjs';

const assets = new Map(Object.entries({
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/maps.js': ['maps.js', 'text/javascript; charset=utf-8'],
  '/icons.js': ['icons.js', 'text/javascript; charset=utf-8'],
  '/sw.js': ['sw.js', 'text/javascript; charset=utf-8'],
  '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'],
  '/uptex-logo.jpg': ['uptex-logo.jpg', 'image/jpeg'],
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

const userFields = 'id,email,name,role,active';
export function createApp({
  dbPath = resolve('data', 'uptex.sqlite'), demo = true, secureCookies = false,
  browserKey = '', mapId = '', adminEmail = '', adminPassword = '',
} = {}) {
  const db = openStore(dbPath, { demo, adminEmail: adminEmail ? emailAddress(adminEmail) : '', adminPassword });
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
    return db.prepare('SELECT u.id,u.email,u.name,u.role,u.active FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=? AND s.expires>? AND u.active=1')
      .get(token, Date.now()) ?? null;
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
    const { id, name, role } = account;
    json(res, 200, { user: { id, email, name, role } }, { 'Set-Cookie': cookie(token, sessionLifetime / 1000) });
  }

  function saveUser(body, id) {
    const email = emailAddress(body.email);
    const name = text(body.name, 120, 'El nombre');
    const { role, active } = body;
    check(roles.includes(role) && typeof active === 'boolean', 'Revisa el rol y el estado.');
    const previous = id && db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    check(!id || previous, 'El usuario no existe.', 404);
    check(!db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email, id ?? 0), 'Ese correo ya está registrado.', 409);
    const password = text(body.password, 160, 'La contraseña', Boolean(id));
    check((id && !password) || password.length >= 12, 'La contraseña debe tener al menos 12 caracteres.');
    if (previous?.active && previous.role === 'admin' && (!active || role !== 'admin')) {
      check(db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND active = 1").get().count > 1, 'Debe quedar una cuenta de coordinación activa.', 409);
    }
    if (!id) {
      id = db.prepare('INSERT INTO users(email,name,role,active,password) VALUES(?,?,?,?,?)').run(email, name, role, Number(active), passwordHash(password)).lastInsertRowid;
    } else {
      db.prepare('UPDATE users SET email=?,name=?,role=?,active=?,password=? WHERE id=?')
        .run(email, name, role, Number(active), password ? passwordHash(password) : previous.password, id);
      if (!active || role !== previous.role || password || email !== previous.email) {
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
      }
      if (!active || role !== 'driver') db.prepare('UPDATE routes SET driver_id=NULL WHERE driver_id=?').run(id);
    }
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
      db.prepare('INSERT INTO trips(route_id,driver_id,date,planned_departure,planned_arrival,departed_at) VALUES(?,?,?,?,?,?)')
        .run(routeId, route.driver_id ?? user.id, date, route.departure, route.arrival, new Date().toISOString());
      return;
    }
    check(trip && !trip.arrived_at, 'Registra una salida vigente antes de marcar la llegada.', 409);
    db.prepare('UPDATE trips SET arrived_at=? WHERE id=?').run(new Date().toISOString(), trip.id);
  }

  async function api(req, res, pathname) {
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
      return json(res, 200, { demo, browserKey, mapId, demoAccounts: demo ? demoAccounts.map(([email, name, role]) => ({ email, name, role })) : [] });
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
      const id = transaction(db, () => {
        check(!db.prepare('SELECT id FROM users WHERE email=?').get(email), 'Ese correo ya está registrado.', 409);
        const userId = db.prepare('INSERT INTO users(email,name,role,password) VALUES(?,?,?,?)').run(email,name,role,passwordHash(password)).lastInsertRowid;
        db.prepare('INSERT INTO passenger_profiles(user_id,qr_token) VALUES(?,?)').run(userId,token);
        return userId;
      });
      return json(res, 201, { message: 'Cuenta creada. Inicia sesión para reservar tu ruta.' });
    }
    if (method === 'POST' && pathname === '/api/logout') {
      db.prepare('DELETE FROM sessions WHERE token=?').run(session(req));
      return json(res, 200, {}, { 'Set-Cookie': cookie('', 0) });
    }
    check(user, 'Inicia sesión para continuar.', 401);
    if (method === 'GET' && pathname === '/api/my/ride') {
      check(['student','teacher'].includes(user.role), 'Solo alumnos y maestros pueden consultar sus viajes.', 403);
      const profile = db.prepare('SELECT qr_token AS qrToken FROM passenger_profiles WHERE user_id=?').get(user.id);
      const reservation = db.prepare('SELECT x.route_id AS routeId,x.stop_id AS stopId,b.id AS boardingId,b.boarded_at AS boardedAt,b.alighted_at AS alightedAt,v.name AS vehicle,v.plate,r.code,r.name AS route,s.name AS stop,r.departure,du.name AS driver FROM reservations x JOIN routes r ON r.id=x.route_id JOIN stops s ON s.id=x.stop_id LEFT JOIN users du ON du.id=r.driver_id LEFT JOIN vehicles v ON v.driver_id=r.driver_id AND v.active=1 LEFT JOIN boardings b ON b.reservation_id=x.id WHERE x.user_id=? AND x.service_date=? AND x.status=?').get(user.id,localDate(),'reserved');
      return json(res,200,{qrToken:profile?.qrToken??null,reservation:reservation??null,routes:readRoutes(db)});
    }
    if (method === 'POST' && pathname === '/api/my/ride') {
      check(['student','teacher'].includes(user.role), 'Solo alumnos y maestros pueden reservar.', 403);
      const body=await readBody(req); const routeId=Number(body.routeId),stopId=Number(body.stopId);
      check(db.prepare("SELECT id FROM routes WHERE id=? AND status='active'").get(routeId),'Selecciona una ruta activa.');
      check(db.prepare('SELECT id FROM stops WHERE id=? AND route_id=?').get(stopId,routeId),'Selecciona una parada de esa ruta.');
      const current=db.prepare('SELECT x.id,b.id AS boardingId FROM reservations x LEFT JOIN boardings b ON b.reservation_id=x.id WHERE x.user_id=? AND x.service_date=?').get(user.id,localDate());
      check(!current?.boardingId,'No puedes cambiar la reservación después de abordar.',409);
      const now=new Date().toISOString();
      const id=transaction(db,()=>db.prepare("INSERT INTO reservations(user_id,route_id,stop_id,service_date,created_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id,service_date) DO UPDATE SET route_id=excluded.route_id,stop_id=excluded.stop_id,status='reserved',created_at=excluded.created_at RETURNING id").get(user.id,routeId,stopId,localDate(),now).id);
      return json(res,200,{id});
    }
    if (method === 'GET' && pathname === '/api/driver/state') {
      check(user.role==='driver'||user.role==='admin','Solo choferes o coordinación.',403);
      const rows=db.prepare("SELECT r.id AS routeId,r.code,r.name,r.departure,r.arrival,v.id AS vehicleId,v.name AS vehicle,v.plate FROM routes r LEFT JOIN vehicles v ON v.driver_id=r.driver_id AND v.active=1 WHERE r.status='active' AND r.driver_id=?").all(user.id);
      const passengers=db.prepare("SELECT x.id AS reservationId,u.name,u.role,s.name AS stop,b.boarded_at AS boardedAt,b.alighted_at AS alightedAt FROM reservations x JOIN users u ON u.id=x.user_id JOIN routes r ON r.id=x.route_id JOIN stops s ON s.id=x.stop_id LEFT JOIN boardings b ON b.reservation_id=x.id WHERE x.service_date=? AND r.driver_id=? ORDER BY s.position,u.name").all(localDate(),user.id);
      const locationUpdatedAt=db.prepare('SELECT updated_at AS updatedAt FROM driver_locations WHERE driver_id=?').get(user.id)?.updatedAt??null;
      return json(res,200,{assignments:rows,passengers,locationUpdatedAt,vehicle:db.prepare('SELECT id,name,plate,model,capacity FROM vehicles WHERE driver_id=? AND active=1').get(user.id)??null});
    }
    if (method === 'POST' && pathname === '/api/driver/vehicle') {
      check(user.role==='driver','Solo choferes pueden registrar una unidad.',403);
      const b=await readBody(req);const name=text(b.name,80,'El nombre de unidad');const plate=text(b.plate,16,'La placa').toUpperCase();const model=text(b.model||'',80,'El modelo');const capacity=Number(b.capacity||20);
      check(Number.isInteger(capacity)&&capacity>=1&&capacity<=100,'Capacidad no válida.');
      check(!db.prepare('SELECT id FROM vehicles WHERE plate=? AND driver_id<>?').get(plate,user.id),'Esa placa ya está registrada en otra unidad.',409);
      db.prepare('INSERT INTO vehicles(driver_id,name,plate,model,capacity,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(driver_id) DO UPDATE SET name=excluded.name,plate=excluded.plate,model=excluded.model,capacity=excluded.capacity,active=1').run(user.id,name,plate,model,capacity,new Date().toISOString());return json(res,200,{});
    }
    if (method === 'POST' && pathname === '/api/driver/scan') {
      check(user.role==='driver','Solo el chofer asignado puede escanear.',403);
      const b=await readBody(req);const profile=db.prepare('SELECT user_id FROM passenger_profiles WHERE qr_token=?').get(text(b.qrToken,80,'El QR'));
      check(profile,'QR no reconocido.',404);const ride=db.prepare("SELECT x.id,x.route_id FROM reservations x JOIN routes r ON r.id=x.route_id WHERE x.user_id=? AND x.service_date=? AND x.status='reserved' AND r.driver_id=?").get(profile.user_id,localDate(),user.id);
      check(ride,'No hay reservación activa de esta persona en la ruta asignada.',404);const vehicle=db.prepare('SELECT id FROM vehicles WHERE driver_id=? AND active=1').get(user.id);check(vehicle,'Registra una unidad antes de escanear.');
      const now=new Date().toISOString();if(b.action==='alight'){const trip=db.prepare('SELECT id FROM boardings WHERE reservation_id=? AND alighted_at IS NULL').get(ride.id);check(trip,'No hay abordaje activo para bajar.',409);db.prepare('UPDATE boardings SET alighted_at=? WHERE id=?').run(now,trip.id);}else{check(b.action==='board','Selecciona abordar o bajar.');check(!db.prepare('SELECT id FROM boardings WHERE reservation_id=?').get(ride.id),'Este QR ya fue registrado hoy.',409);db.prepare('INSERT INTO boardings(reservation_id,driver_id,vehicle_id,boarded_at) VALUES(?,?,?,?)').run(ride.id,user.id,vehicle.id,now);}return json(res,200,{registered:true,action:b.action,at:now});
    }
    if (method === 'POST' && pathname === '/api/driver/location') {
      check(user.role==='driver','Solo choferes pueden compartir ubicación.',403);const b=await readBody(req);const lat=Number(b.lat),lng=Number(b.lng);check(Number.isFinite(lat)&&lat>=-90&&lat<=90&&Number.isFinite(lng)&&lng>=-180&&lng<=180,'Ubicación no válida.');const route=db.prepare('SELECT id FROM routes WHERE driver_id=? AND status=\'active\' LIMIT 1').get(user.id);check(route,'No tienes ruta asignada.');db.prepare('INSERT INTO driver_locations(driver_id,route_id,lat,lng,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(driver_id) DO UPDATE SET route_id=excluded.route_id,lat=excluded.lat,lng=excluded.lng,updated_at=excluded.updated_at').run(user.id,route.id,lat,lng,new Date().toISOString());return json(res,200,{});
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
      transaction(db, () => recordTrip(user, Number(tripMatch[1]), body.action));
      return json(res, 200, {});
    }
    check(pathname.startsWith('/api/admin/'), 'Recurso no encontrado.', 404);
    check(user.role === 'admin', 'Esta sección requiere permisos de coordinación.', 403);
    if (method === 'GET' && pathname === '/api/admin/state') {
      return json(res, 200, {
        routes: readRoutes(db, true, user),
        users: db.prepare('SELECT ' + userFields + ' FROM users ORDER BY name').all(),
        notices: readNotices(db, user, true),
        trips: db.prepare('SELECT t.date,t.departed_at AS departedAt,t.arrived_at AS arrivedAt,t.planned_departure AS plannedDeparture,t.planned_arrival AS plannedArrival,r.code,r.name FROM trips t JOIN routes r ON r.id=t.route_id ORDER BY t.departed_at DESC LIMIT 60').all(),
        vehicles: db.prepare("SELECT v.id,v.name,v.plate,v.model,v.capacity,u.name AS driver,u.email AS driverEmail,r.code AS routeCode,r.name AS route FROM vehicles v JOIN users u ON u.id=v.driver_id LEFT JOIN routes r ON r.driver_id=u.id AND r.status='active' WHERE v.active=1 ORDER BY u.name").all(),
        locations: db.prepare("SELECT l.lat,l.lng,l.updated_at AS updatedAt,u.name AS driver,r.code AS routeCode,r.name AS route FROM driver_locations l JOIN users u ON u.id=l.driver_id JOIN routes r ON r.id=l.route_id WHERE r.status='active' AND l.updated_at>=? ORDER BY l.updated_at DESC").all(new Date(Date.now()-120000).toISOString()),
        passengers: db.prepare("SELECT x.service_date AS date,u.name AS passenger,u.role,r.code AS routeCode,r.name AS route,s.name AS stop,v.name AS vehicle,v.plate,d.name AS driver,b.boarded_at AS boardedAt,b.alighted_at AS alightedAt FROM reservations x JOIN users u ON u.id=x.user_id JOIN routes r ON r.id=x.route_id JOIN stops s ON s.id=x.stop_id LEFT JOIN users d ON d.id=r.driver_id LEFT JOIN vehicles v ON v.driver_id=r.driver_id AND v.active=1 LEFT JOIN boardings b ON b.reservation_id=x.id WHERE x.service_date=? AND x.status='reserved' ORDER BY r.code,s.position,u.name").all(localDate()),
      });
    }
    const routeMatch = pathname.match(/^\/api\/admin\/routes(?:\/([1-9]\d*))?$/);
    if (routeMatch && ((method === 'POST' && !routeMatch[1]) || (method === 'PUT' && routeMatch[1]))) {
      const id = routeMatch[1] ? Number(routeMatch[1]) : null;
      const body = await readBody(req);
      const routeId = transaction(db, () => {
        check(!id || db.prepare('SELECT id FROM routes WHERE id=?').get(id), 'La ruta no existe.', 404);
        const route = routeInput(db, body, id);
        if (route.status !== 'active') {
          check(!db.prepare('SELECT id FROM trips WHERE route_id=? AND date=? AND arrived_at IS NULL').get(id, localDate()), 'Registra la llegada del viaje antes de pasar la ruta a borrador.', 409);
        }
        return writeRoute(db, route, id);
      });
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
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (pathname.startsWith('/api/')) return await api(req, res, pathname);
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
  });
  server.listen(port, host, () => console.log('Transportes UPTex en http://' + (host === '0.0.0.0' ? 'localhost' : host) + ':' + server.address().port));
}
