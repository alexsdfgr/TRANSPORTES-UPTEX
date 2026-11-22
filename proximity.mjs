import webpush from 'web-push';
import { transaction } from './store.mjs';

export function pushEndpoint(input) {
  if (typeof input !== 'string' || input.length > 2048) return null;
  try {
    const url = new URL(input);
    const provider = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'push.services.mozilla.com'].includes(url.hostname)
      || url.hostname.endsWith('.push.apple.com') || url.hostname.endsWith('.notify.windows.com');
    if (provider && url.protocol === 'https:' && !url.port && !url.username && !url.password && !url.hash) return url.href;
  } catch {
    return null;
  }
  return null;
}

function validKey(value, size) {
  return typeof value === 'string' && /^[\w-]+$/.test(value) && Buffer.from(value, 'base64url').length === size;
}

export function createProximity(db, subject, candidates, check) {
  const vapidDetails = subject && transaction(db, () => {
    const stored = db.prepare("SELECT value FROM settings WHERE key='web_push_vapid'").get();
    if (stored) return { subject, ...JSON.parse(stored.value) };
    const keys = webpush.generateVAPIDKeys();
    db.prepare("INSERT INTO settings(key,value) VALUES('web_push_vapid',?)").run(JSON.stringify(keys));
    return { subject, ...keys };
  });
  const remove = db.prepare('DELETE FROM push_subscriptions WHERE endpoint=? AND user_id=?');
  const markDelivered = db.prepare(`INSERT OR IGNORE INTO proximity_notices(endpoint,reservation_id)
    SELECT p.endpoint,x.id FROM push_subscriptions p JOIN reservations x ON x.user_id=p.user_id
    WHERE p.endpoint=? AND p.subscription=? AND x.id=? AND x.stop_id=?`);
  const sending = new Set();

  function subscribe(userId, body) {
    check(vapidDetails, 'Las notificaciones aún no están disponibles.', 503);
    const endpoint = pushEndpoint(body.endpoint);
    const { p256dh, auth } = body.keys ?? {};
    check(endpoint && validKey(p256dh, 65) && validKey(auth, 16), 'Suscripción de notificaciones no válida.');
    const subscription = JSON.stringify({ endpoint, keys: { p256dh, auth } });
    transaction(db, () => {
      db.prepare('DELETE FROM push_subscriptions WHERE endpoint=? AND user_id<>?').run(endpoint, userId);
      db.prepare(`INSERT INTO push_subscriptions VALUES(?,?,?) ON CONFLICT(endpoint) DO UPDATE SET subscription=excluded.subscription`)
        .run(endpoint, userId, subscription);
    });
  }

  function notify(routeId) {
    if (!vapidDetails) return;
    for (const { id: stopId, endpoint, reservationId, subscription } of candidates(routeId)) {
      const key = reservationId + ':' + stopId + ':' + endpoint;
      if (sending.has(key)) continue;
      sending.add(key);
      const message = JSON.stringify({ title: 'Tu combi se acerca', body: 'Consulta el rastreo y prepárate para abordar.', tag: 'uptex-' + reservationId });
      Promise.resolve().then(() => webpush.sendNotification(JSON.parse(subscription), message, {
        vapidDetails, TTL: 120, timeout: 8000,
      })).then(() => {
        if (db.isOpen) markDelivered.run(endpoint, subscription, reservationId, stopId);
      }).catch((error) => {
        if (!db.isOpen) return;
        if ([404, 410].includes(error.statusCode)) {
          db.prepare('DELETE FROM push_subscriptions WHERE endpoint=? AND subscription=?').run(endpoint, subscription);
        } else {
          console.warn('Aviso de proximidad pendiente de reintento:', error.statusCode ?? error.code ?? 'error de envío');
        }
      }).finally(() => sending.delete(key));
    }
  }

  return { publicKey: vapidDetails?.publicKey ?? '', subscribe, notify, remove: (userId, endpoint) => remove.run(endpoint, userId) };
}
