import { localDate } from './store.mjs';

const gpsLifetime = 60_000;
const stopTolerance = 65;
const localClock = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/Mexico_City',
});
const minutes = (value) => value ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5)) : null;

function distanceBetween(a, b) {
  const radians = (a.lat + b.lat) * Math.PI / 360;
  return Math.hypot((b.lng - a.lng) * 111_320 * Math.cos(radians), (b.lat - a.lat) * 111_320);
}

function project(stops, location, previous, accuracy) {
  if (accuracy > 125) return null;
  const matches = [];
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1];
    const b = stops[i];
    const length = b.distance - a.distance;
    if (length === 0) continue;
    const fromStart = distanceBetween(a, location);
    const fromEnd = distanceBetween(b, location);
    const fraction = Math.max(0, Math.min(1, (fromStart ** 2 + length ** 2 - fromEnd ** 2) / (2 * length ** 2)));
    const meters = length * fraction;
    const offset = Math.sqrt(Math.max(0, fromStart ** 2 - meters ** 2));
    matches.push({ progress: a.distance + meters, offset: fraction === 1 ? fromEnd : offset });
  }
  const nearby = matches.filter(({ offset, progress }) => offset <= 650 && (previous === null || progress >= previous - 240));
  if (!nearby.length) return null;
  const closest = Math.min(...nearby.map((match) => match.offset));
  const progress = Math.min(...nearby.filter((match) => match.offset <= closest + 35).map((match) => match.progress));
  return Math.max(previous ?? 0, progress);
}

function scheduledMinute(stops, distance) {
  const anchors = stops.filter((stop) => stop.planned !== null);
  const before = anchors.findLast((stop) => stop.distance <= distance);
  const after = anchors.find((stop) => stop.distance >= distance);
  if (!before || !after) return null;
  if (before.distance === after.distance) return before.planned;
  return before.planned + (after.planned - before.planned) * (distance - before.distance) / (after.distance - before.distance);
}

function estimatedMinutes(unit, stop, now = Date.now()) {
  if (!unit.location || !unit.matched || unit.progress === null || unit.progress > stop.distance + stopTolerance) return null;
  const distance = Math.max(0, stop.distance - unit.progress);
  const plannedNow = scheduledMinute(unit.stops, unit.progress);
  const plannedStop = scheduledMinute(unit.stops, stop.distance);
  const plannedDuration = plannedNow === null || plannedStop === null ? 0 : plannedStop - plannedNow;
  const duration = unit.speed >= 3 ? distance / unit.speed / 60 : Math.max(plannedDuration, distance / 560);
  return Math.ceil(Math.max(0, duration - (now - Date.parse(unit.location.updatedAt)) / 60_000));
}

const historyFields = `SELECT b.id, x.user_id AS userId, x.service_date AS date, u.name AS passenger, u.matricula, u.role,
  r.code AS routeCode, r.name AS route, COALESCE(bs.name, s.name) AS stop, ds.name AS alightStop,
  v.name AS vehicle, COALESCE(b.plate_at_boarding, v.plate) AS plate, d.name AS driver,
  b.boarded_at AS boardedAt, b.alighted_at AS alightedAt
  FROM boardings b JOIN reservations x ON x.id=b.reservation_id JOIN routes r ON r.id=x.route_id
  JOIN users u ON u.id=x.user_id JOIN stops s ON s.id=x.stop_id JOIN vehicles v ON v.id=b.vehicle_id
  JOIN users d ON d.id=b.driver_id LEFT JOIN stops bs ON bs.id=b.board_stop_id LEFT JOIN stops ds ON ds.id=b.alight_stop_id`;

export function createOperations(db, check) {
  const stopsQuery = db.prepare('SELECT id, name, lat, lng, time FROM stops WHERE route_id=? AND active=1 ORDER BY position');
  function routeStops(routeId, departure, arrival) {
    const rows = stopsQuery.all(routeId);
    let distance = 0;
    return rows.map((stop, i) => {
      if (i) distance += distanceBetween(rows[i - 1], stop);
      const time = stop.time ?? (i === 0 ? departure : i === rows.length - 1 ? arrival : null);
      return { ...stop, time, planned: minutes(time), distance };
    });
  }

  const unitQuery = db.prepare(`SELECT t.id AS tripId,t.route_id AS routeId,t.driver_id AS driverId,t.departed_at AS departedAt,
    r.code,r.name AS route,r.color,t.planned_departure AS departure,t.planned_arrival AS arrival,
    v.id AS vehicleId,v.name AS vehicle,v.plate,v.capacity,u.name AS driver,l.lat,l.lng,l.updated_at AS updatedAt,
    l.progress_m AS progress,l.speed_mps AS speed,l.matched,
    (SELECT COUNT(*) FROM boardings b WHERE b.vehicle_id=v.id AND b.alighted_at IS NULL) AS occupied
    FROM trips t JOIN routes r ON r.id=t.route_id JOIN users u ON u.id=t.driver_id
    JOIN vehicles v ON v.id=t.vehicle_id OR (t.vehicle_id IS NULL AND v.driver_id=t.driver_id AND v.active=1)
    LEFT JOIN driver_locations l ON l.driver_id=t.driver_id AND l.trip_id=t.id
    WHERE t.date=? AND t.arrived_at IS NULL AND (? IS NULL OR t.route_id=?) ORDER BY r.code`);

  function units(routeId = null) {
    const now = Date.now();
    return unitQuery.all(localDate(), routeId, routeId).map((row) => {
      const { lat, lng, updatedAt, ...unit } = row;
      const location = updatedAt && now - Date.parse(updatedAt) <= gpsLifetime ? { lat, lng, updatedAt } : null;
      const stops = routeStops(unit.routeId, unit.departure, unit.arrival);
      const nextIndex = stops.findIndex((stop) => stop.distance >= (unit.progress ?? 0) - stopTolerance);
      const nextStop = stops[nextIndex] ?? null;
      const measured = location && unit.matched && unit.progress > 125 ? scheduledMinute(stops, unit.progress) : null;
      const planned = measured ?? minutes(unit.departure);
      const actualAt = measured === null ? unit.departedAt : location.updatedAt;
      const offsetMinutes = planned === null ? null : Math.round(minutes(localClock.format(new Date(actualAt))) - planned);
      return { ...unit, stops, nextIndex, nextStop, location, updatedAt, offsetMinutes };
    });
  }

  function publicUnit(unit) {
    const { tripId, routeId, code, route, color, vehicle, plate, capacity, occupied, location, updatedAt } = unit;
    return { tripId, routeId, code, route, color, vehicle, plate, capacity, occupied, location, updatedAt };
  }

  function stopIndex(unit, stop) {
    const exact = unit.stops.findIndex(({ id }) => id === stop.id);
    if (exact !== -1) return exact;
    return unit.stops.findIndex((candidate) => candidate.name === stop.name && distanceBetween(candidate, stop) < 80);
  }

  function approach(unit, stop, index) {
    const etaMinutes = estimatedMinutes(unit, stop);
    const stopsAway = unit.location && unit.matched && index >= unit.nextIndex && unit.nextIndex >= 0 ? index - unit.nextIndex + 1 : null;
    return { etaMinutes, stopsAway, passed: unit.progress !== null && unit.progress > stop.distance + stopTolerance };
  }

  function passengerTracking(userId) {
    const reservation = db.prepare(`SELECT x.id AS reservationId,x.route_id AS routeId,s.id,s.name,s.lat,s.lng,
      b.boarded_at AS boardedAt,b.alighted_at AS alightedAt
      FROM reservations x JOIN stops s ON s.id=x.stop_id LEFT JOIN boardings b ON b.reservation_id=x.id
      WHERE x.user_id=? AND x.service_date=? AND x.status='reserved'`).get(userId, localDate());
    if (!reservation) return null;
    const { id, name, lat, lng, boardedAt, alightedAt, routeId, reservationId } = reservation;
    const stop = { id, name, lat, lng };
    const unit = units(routeId)[0];
    const index = unit ? stopIndex(unit, stop) : -1;
    return { routeId, reservationId, stop, boardedAt, alightedAt, unit: unit ? publicUnit(unit) : null,
      ...(index >= 0 ? approach(unit, unit.stops[index], index) : { etaMinutes: null, stopsAway: null, passed: false }) };
  }

  function driverState(driverId) {
    const assignments = db.prepare(`SELECT r.id AS routeId,r.code,r.name,r.departure,r.arrival,v.id AS vehicleId,v.name AS vehicle,v.plate
      FROM routes r LEFT JOIN vehicles v ON v.driver_id=r.driver_id AND v.active=1
      WHERE r.status='active' AND r.driver_id=? ORDER BY r.code`).all(driverId);
    const vehicle = db.prepare('SELECT id,name,plate,model,capacity FROM vehicles WHERE driver_id=? AND active=1').get(driverId) ?? null;
    const unit = units().find((item) => item.driverId === driverId);
    const passengers = db.prepare(`SELECT x.id AS reservationId,x.route_id AS routeId,u.name,u.role,s.id AS stopId,s.name AS stop,
      s.lat,s.lng,b.boarded_at AS boardedAt,b.alighted_at AS alightedAt
      FROM reservations x JOIN users u ON u.id=x.user_id JOIN routes r ON r.id=x.route_id
      JOIN stops s ON s.id=x.stop_id LEFT JOIN boardings b ON b.reservation_id=x.id
      WHERE x.service_date=? AND x.status='reserved' AND u.active=1
      AND (r.driver_id=? OR r.id=?) AND (b.driver_id IS NULL OR b.driver_id=?) ORDER BY s.position,u.name`)
      .all(localDate(), driverId, unit?.routeId ?? null, driverId);
    const nextStop = unit?.nextStop && {
      id: unit.nextStop.id, name: unit.nextStop.name,
      waiting: passengers.filter((p) => p.routeId === unit.routeId && !p.boardedAt
        && stopIndex(unit, { id: p.stopId, name: p.stop, lat: p.lat, lng: p.lng }) === unit.nextIndex).length,
    };
    const occupied = vehicle ? db.prepare('SELECT COUNT(*) AS count FROM boardings WHERE vehicle_id=? AND alighted_at IS NULL').get(vehicle.id).count : 0;
    return { assignments, vehicle, passengers, occupied, locationUpdatedAt: unit?.updatedAt ?? null,
      shift: unit ? { ...publicUnit(unit), nextStop, stops: unit.stops.map(({ id, name }) => ({ id, name })) } : null };
  }

  function radar() {
    const aboard = db.prepare(`${historyFields} WHERE b.vehicle_id=? AND b.driver_id=? AND b.alighted_at IS NULL ORDER BY b.boarded_at`);
    return units().map((unit) => ({ ...publicUnit(unit), driver: unit.driver, departure: unit.departure,
      arrival: unit.arrival, departedAt: unit.departedAt, offsetMinutes: unit.offsetMinutes,
      nextStop: unit.nextStop?.name ?? null, manifest: aboard.all(unit.vehicleId, unit.driverId) }));
  }

  function history(userId, query, before) {
    const term = query ? '%' + query.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_') + '%' : '';
    const limit = 40;
    const rows = db.prepare(`${historyFields} WHERE (? IS NULL OR x.user_id=?) AND (? IS NULL OR b.id < ?)
      AND (? = '' OR u.name LIKE ? ESCAPE '\\' OR u.matricula LIKE ? ESCAPE '\\' OR b.plate_at_boarding LIKE ? ESCAPE '\\')
      ORDER BY b.id DESC LIMIT ?`).all(userId, userId, before, before, term, term, term, term, limit + 1);
    return { history: rows.slice(0, limit), next: rows.length > limit ? rows[limit - 1].id : null };
  }

  function ridership(date) {
    const rows = db.prepare(`SELECT r.code AS routeCode,COALESCE(bs.name,s.name) AS stop,b.boarded_at AS boardedAt
      FROM boardings b JOIN reservations x ON x.id=b.reservation_id JOIN routes r ON r.id=x.route_id
      JOIN stops s ON s.id=x.stop_id LEFT JOIN stops bs ON bs.id=b.board_stop_id WHERE x.service_date=? ORDER BY b.boarded_at`).all(date);
    const groups = new Map();
    for (const { routeCode, stop, boardedAt } of rows) {
      const hour = localClock.format(new Date(boardedAt)).slice(0, 2) + ':00';
      const key = JSON.stringify([hour, routeCode, stop]);
      const group = groups.get(key) ?? { hour, routeCode, stop, boarded: 0 };
      group.boarded++;
      groups.set(key, group);
    }
    return { date, total: rows.length, groups: [...groups.values()] };
  }

  function locate(driverId, body) {
    const { lat, lng, accuracy = 0, speed = null, measuredAt = Date.now() } = body;
    const now = Date.now();
    check(Number.isFinite(lat) && Math.abs(lat) <= 90 && Number.isFinite(lng) && Math.abs(lng) <= 180
      && Number.isFinite(accuracy) && accuracy >= 0 && Number.isFinite(measuredAt)
      && measuredAt <= now + 30_000 && measuredAt >= now - gpsLifetime, 'Ubicación no válida.');
    const shift = db.prepare('SELECT id, route_id, planned_departure, planned_arrival FROM trips WHERE driver_id=? AND date=? AND arrived_at IS NULL').get(driverId, localDate());
    check(shift && (body.tripId === undefined || body.tripId === shift.id), 'Inicia el turno para compartir ubicación.', 409);
    const last = db.prepare('SELECT progress_m,measured_at FROM driver_locations WHERE driver_id=? AND trip_id=?').get(driverId, shift.id);
    if (last?.measured_at >= measuredAt) return null;
    const stops = routeStops(shift.route_id, shift.planned_departure, shift.planned_arrival);
    const progress = project(stops, { lat, lng }, last?.progress_m ?? null, accuracy);
    db.prepare(`INSERT INTO driver_locations(driver_id,route_id,lat,lng,updated_at,trip_id,progress_m,speed_mps,measured_at,matched)
      VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(driver_id) DO UPDATE SET route_id=excluded.route_id, lat=excluded.lat,
      lng=excluded.lng, updated_at=excluded.updated_at, trip_id=excluded.trip_id, progress_m=excluded.progress_m,
      speed_mps=excluded.speed_mps, measured_at=excluded.measured_at, matched=excluded.matched`)
      .run(driverId, shift.route_id, lat, lng, new Date(now).toISOString(), shift.id, progress ?? last?.progress_m ?? null,
        Number.isFinite(speed) && speed >= 0 && speed <= 45 ? speed : null, measuredAt, Number(progress !== null));
    return shift.route_id;
  }

  function proximityCandidates(routeId) {
    const unit = units(routeId)[0];
    if (!unit?.location || !unit.matched) return [];
    const waiting = db.prepare(`SELECT x.id AS reservationId,s.id,s.name,s.lat,s.lng,p.endpoint,p.subscription
      FROM reservations x JOIN stops s ON s.id=x.stop_id JOIN users u ON u.id=x.user_id
      JOIN push_subscriptions p ON p.user_id=x.user_id LEFT JOIN proximity_notices n ON n.endpoint=p.endpoint AND n.reservation_id=x.id
      WHERE x.route_id=? AND x.service_date=? AND x.status='reserved' AND u.active=1 AND u.role IN ('student','teacher')
      AND n.endpoint IS NULL AND NOT EXISTS (SELECT 1 FROM boardings b WHERE b.reservation_id=x.id)`)
      .all(routeId, localDate());
    return waiting.filter((item) => {
      const index = stopIndex(unit, item);
      if (index < 0) return false;
      const { etaMinutes, stopsAway, passed } = approach(unit, unit.stops[index], index);
      return !passed && ((etaMinutes !== null && etaMinutes <= 5) || (stopsAway !== null && stopsAway <= 2));
    });
  }

  return { passengerTracking, driverState, radar, history, ridership, locate, proximityCandidates };
}
