import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { initialRoutes } from './seed.mjs';

export const roles = ['admin', 'driver', 'student', 'teacher'];
export const colors = ['blue', 'teal', 'orange', 'purple'];
export const noticeKinds = ['general', 'schedule', 'traffic'];
export const demoAccounts = [
  ['admin@demo.uptex.mx', 'Coordinación UPTex', 'admin'],
  ['chofer@demo.uptex.mx', 'Conductor de demostración', 'driver'],
  ['alumno@demo.uptex.mx', 'Estudiante de demostración', 'student'],
  ['profesor@demo.uptex.mx', 'Docente de demostración', 'teacher'],
];
export const demoPassword = 'UPTex-demo-2026';
export const digest = (input) => createHash('sha256').update(input).digest('hex');
export const localDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());

export function passwordHash(password, salt = randomBytes(16).toString('hex')) {
  return salt + ':' + scryptSync(password, salt, 64).toString('hex');
}

const dummyHash = passwordHash('credential unavailable');
export function verifyPassword(password, hash = dummyHash) {
  const [salt, expected] = hash.split(':');
  const actual = passwordHash(password, salt).split(':')[1];
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'));
}

const schema = `
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'driver', 'student', 'teacher')),
    password TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS passenger_profiles (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    qr_token TEXT NOT NULL UNIQUE
  );
  CREATE TABLE IF NOT EXISTS vehicles (
    id INTEGER PRIMARY KEY, driver_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
    name TEXT NOT NULL, plate TEXT NOT NULL UNIQUE, model TEXT NOT NULL DEFAULT '', capacity INTEGER NOT NULL DEFAULT 20,
    active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS reservations (
    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), route_id INTEGER NOT NULL REFERENCES routes(id),
    stop_id INTEGER NOT NULL REFERENCES stops(id), service_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'reserved',
    created_at TEXT NOT NULL, UNIQUE(user_id,service_date)
  );
  CREATE TABLE IF NOT EXISTS boardings (
    id INTEGER PRIMARY KEY, reservation_id INTEGER NOT NULL REFERENCES reservations(id),
    driver_id INTEGER NOT NULL REFERENCES users(id), vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
    boarded_at TEXT NOT NULL, alighted_at TEXT
  );
  CREATE TABLE IF NOT EXISTS driver_locations (
    driver_id INTEGER PRIMARY KEY REFERENCES users(id), route_id INTEGER NOT NULL REFERENCES routes(id),
    lat REAL NOT NULL, lng REAL NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS routes (
    id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, zone TEXT NOT NULL,
    color TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('active','draft')),
    departure TEXT, arrival TEXT, notes TEXT NOT NULL, driver_id INTEGER REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS stops (
    id INTEGER PRIMARY KEY, route_id INTEGER NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    position INTEGER NOT NULL, name TEXT NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL,
    time TEXT, fare REAL, active INTEGER NOT NULL DEFAULT 1, UNIQUE(route_id, position)
  );
  CREATE TABLE IF NOT EXISTS notices (
    id INTEGER PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL,
    kind TEXT NOT NULL, route_id INTEGER REFERENCES routes(id), published INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS notice_reads (
    user_id INTEGER NOT NULL REFERENCES users(id), notice_id INTEGER NOT NULL REFERENCES notices(id),
    PRIMARY KEY(user_id, notice_id)
  );
  CREATE TABLE IF NOT EXISTS trips (
    id INTEGER PRIMARY KEY, route_id INTEGER NOT NULL REFERENCES routes(id),
    driver_id INTEGER NOT NULL REFERENCES users(id), date TEXT NOT NULL,
    planned_departure TEXT NOT NULL, planned_arrival TEXT,
    departed_at TEXT NOT NULL, arrived_at TEXT, UNIQUE(route_id, date)
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
    expires INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_by_user ON sessions(user_id);
`;

export function openStore(path, { demo, adminEmail, adminPassword }) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(schema);
  if (!db.prepare('PRAGMA table_info(stops)').all().some(({ name }) => name === 'active')) {
    db.exec('ALTER TABLE stops ADD COLUMN active INTEGER NOT NULL DEFAULT 1');
  }
  const missingProfiles = db.prepare("SELECT id FROM users WHERE role IN ('student','teacher') AND id NOT IN (SELECT user_id FROM passenger_profiles)").all();
  const createProfile = db.prepare('INSERT OR IGNORE INTO passenger_profiles(user_id,qr_token) VALUES(?,?)');
  for (const { id } of missingProfiles) createProfile.run(id, randomBytes(32).toString('hex'));
  const initialized = db.prepare("SELECT value FROM settings WHERE key = 'mode'").get();
  if (initialized && initialized.value !== (demo ? 'demo' : 'operation')) {
    throw new Error('Usa una base distinta al cambiar DEMO_MODE.');
  }
  if (initialized) return db;
  if (!demo && (!adminEmail || !adminPassword || adminPassword.length < 12 || adminPassword === demoPassword)) {
    throw new Error('Configura ADMIN_EMAIL y una ADMIN_PASSWORD de al menos 12 caracteres.');
  }
  transaction(db, () => {
    const insert = db.prepare('INSERT INTO users(email,name,role,password) VALUES(?,?,?,?)');
    let demoDriver = null;
    if (demo) {
      for (const [email, name, role] of demoAccounts) {
        const { lastInsertRowid } = insert.run(email, name, role, passwordHash(demoPassword));
        if (role === 'driver') demoDriver = lastInsertRowid;
      }
    } else {
      insert.run(adminEmail, 'Coordinación UPTex', 'admin', passwordHash(adminPassword));
    }
    for (const route of initialRoutes) {
      writeRoute(db, { ...route, driverId: route.code === 'R01' ? demoDriver : null });
    }
    if (demo) {
      const createNotice = db.prepare('INSERT INTO notices(title,body,kind,route_id,created_at) VALUES(?,?,?,?,?)');
      const now = new Date().toISOString();
      createNotice.run('Horarios de referencia', 'Los horarios y tarifas provienen de los folletos de transporte compartidos para el proyecto. Confirma su vigencia con coordinación.', 'general', null, now);
      createNotice.run('Espera en Gasolinera Chiautla', 'La ruta Tepetitlán pasa a las 06:15. El folleto indica que retoma el recorrido a las 06:20.', 'schedule', 2, now);
    }
    db.prepare('INSERT INTO settings VALUES(?,?)').run('mode', demo ? 'demo' : 'operation');
  });
  const profilesToCreate = db.prepare("SELECT id FROM users WHERE role IN ('student','teacher') AND id NOT IN (SELECT user_id FROM passenger_profiles)").all();
  for (const { id } of profilesToCreate) createProfile.run(id, randomBytes(32).toString('hex'));
  return db;
}

export function transaction(db, work) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function readRoutes(db, includeDrafts = false, user = null) {
  const routes = db.prepare(`
    SELECT id, code, name, zone, color, status, departure, arrival, notes, driver_id AS driverId
    FROM routes WHERE status = 'active' OR ? = 1 ORDER BY code
  `).all(Number(includeDrafts));
  const stops = db.prepare('SELECT id,name,lat,lng,time,fare FROM stops WHERE route_id = ? AND active = 1 ORDER BY position');
  const trips = db.prepare('SELECT id, driver_id AS tripDriverId, departed_at AS departedAt, arrived_at AS arrivedAt, planned_departure AS plannedDeparture, planned_arrival AS plannedArrival FROM trips WHERE date = ? AND route_id = ?');
  const today = localDate();
  return routes.map((route) => {
    const { driverId, ...publicRoute } = route;
    const { tripDriverId, ...trip } = trips.get(today, route.id) ?? {};
    const assigned = user?.role === 'driver' && (user.id === driverId || (tripDriverId === user.id && !trip.arrivedAt));
    return {
      ...publicRoute,
      ...(includeDrafts && { driverId }),
      canRecord: user?.role === 'admin' || assigned,
      stops: stops.all(route.id),
      trip: trip.id ? trip : null,
    };
  });
}

export function writeRoute(db, route, id = null) {
  const { code, name, zone, color, status, departure, arrival, notes, driverId, stops } = route;
  const fields = [code, name, zone, color, status, departure, arrival, notes, driverId];
  if (id === null) {
    id = db.prepare('INSERT INTO routes(code,name,zone,color,status,departure,arrival,notes,driver_id) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(...fields).lastInsertRowid;
  } else {
    db.prepare('UPDATE routes SET code=?,name=?,zone=?,color=?,status=?,departure=?,arrival=?,notes=?,driver_id=? WHERE id=?')
      .run(...fields, id);
    // Keep old stop rows as snapshots for reservations that reference them.
    db.prepare('UPDATE stops SET active=0,position=-id WHERE route_id=?').run(id);
  }
  const insert = db.prepare('INSERT INTO stops(route_id,position,name,lat,lng,time,fare) VALUES(?,?,?,?,?,?,?)');
  stops.forEach((stop, index) => insert.run(id, index + 1, stop.name, stop.lat, stop.lng, stop.time, stop.fare));
  return id;
}

export function readNotices(db, user, includeArchived = false) {
  return db.prepare(`
    SELECT n.id, n.title, n.body, n.kind, n.route_id AS routeId, r.name AS routeName,
    n.published, n.created_at AS createdAt, nr.notice_id IS NOT NULL AS isRead
    FROM notices n LEFT JOIN routes r ON r.id = n.route_id
    LEFT JOIN notice_reads nr ON nr.notice_id = n.id AND nr.user_id = ?
    WHERE ? = 1 OR (n.published = 1 AND (n.route_id IS NULL OR r.status = 'active'))
    ORDER BY n.created_at DESC, n.id DESC
  `).all(user?.id ?? null, Number(includeArchived));
}
