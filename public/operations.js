import { icon } from './icons.js';
import { RouteMap, mapControls } from './maps.js';

const exactClock = new Intl.DateTimeFormat('es-MX', {
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZone: 'America/Mexico_City',
});
const exactTime = (value) => value ? exactClock.format(new Date(value)) : '—';
const dateLabel = (value) => value.split('-').reverse().join('/');

export function createOperationPages({ main, state, escape, option, empty, input, heading, routeBadge, roleNames, api, showFlash }) {
  function passStatus() {
    const reservation = state.ride?.reservation;
    const booked = reservation && '<div class="pass-reservation">' + routeBadge({ ...reservation, color: state.routes.find((r) => r.id === reservation.routeId)?.color ?? 'teal' })
      + '<div><b>' + escape(reservation.route) + '</b><p>' + escape(reservation.stop) + '</p></div></div>';
    return booked || (state.offline ? '' : '<a class="button primary" href="#rastreo">' + icon('pin', 17) + 'Reservar viaje</a>');
  }

  function passengerPage() {
    const qrToken = state.ride?.qrToken;
    main.innerHTML = heading('Mi pase', escape(state.user.name))
      + '<section class="card pass-card" aria-label="Pase digital"><div class="pass-title"><span class="panel-glyph">' + icon('qr', 22) + '</span><div><h2>Pase de abordaje</h2>'
      + '<p>Muéstralo al subir y al bajar.</p></div></div>'
      + (qrToken ? '<canvas id="passenger-qr" width="280" height="280" role="img" aria-label="Código QR de abordaje"></canvas>'
        + (state.passSaved ? '<p class="pass-offline">' + icon(state.offline ? 'lock' : 'check', 15)
          + (state.offline ? 'Pase guardado · Sin conexión' : 'Disponible sin conexión') + '</p>' : '')
        + '<details class="pass-code"><summary>Código para captura manual</summary><code class="qr-token">' + escape(qrToken) + '</code></details>'
        : empty('qr', state.offline ? 'Conéctate para guardar tu pase en este dispositivo.' : 'No se encontró tu pase digital.'))
      + '<div id="pass-reservation">' + passStatus() + '</div></section>';
    if (qrToken && window.QRCode?.toCanvas) {
      window.QRCode.toCanvas(main.querySelector('#passenger-qr'), qrToken, {
        width: 280, margin: 4, color: { dark: '#000000', light: '#ffffff' },
      }).catch(() => showFlash('No se pudo mostrar el QR. Usa el código para captura manual.', true));
    }
  }

  function mountLiveMap(routes, selected, index = 0, onUnit) {
    state.map = new RouteMap(main.querySelector('.live-map'), state.config, {
      onStop: () => {}, onEstimate: () => {}, onUnit, live: true,
      onStatus: (status) => {
        const label = main.querySelector('#map-mode span');
        if (label) label.textContent = status === 'google' ? 'Google Maps' : 'Mapa de referencia';
      },
    });
    state.map.show(routes, selected, index);
  }

  function liveMap(label) {
    return '<div class="map-area live-map"><canvas aria-label="' + label + '"></canvas><div class="map-units"></div>'
      + '<div class="google-map" aria-label="' + label + ' en Google Maps" hidden></div>' + mapControls() + '</div>';
  }

  function trackingMarkup(tracking) {
    const unit = tracking?.unit;
    if (!tracking) return empty('pin', 'Reserva una ruta y parada para seguir tu combi.');
    if (tracking.alightedAt) return empty('check', 'Viaje completado a las ' + exactTime(tracking.alightedAt) + '.');
    if (!unit) return empty('bus', 'La unidad aún no ha iniciado el recorrido.');
    const approaching = !tracking.boardedAt && !tracking.passed && unit.location
      && (tracking.etaMinutes !== null && tracking.etaMinutes <= 5 || tracking.stopsAway !== null && tracking.stopsAway <= 2);
    const eta = tracking.boardedAt ? 'A bordo' : tracking.passed ? 'La unidad pasó por tu parada'
      : tracking.etaMinutes === null ? 'ETA pendiente' : tracking.etaMinutes === 0 ? 'En tu parada' : 'Aprox. ' + tracking.etaMinutes + ' min';
    return '<div class="tracking-summary"><span class="panel-glyph">' + icon('bus', 21) + '</span><div><h3>' + eta + '</h3><p>'
      + escape(approaching ? 'Tu combi se acerca a ' + tracking.stop.name : tracking.stop.name)
      + '</p></div><span class="status-tag ' + (unit.occupied >= unit.capacity ? 'capacity-full' : 'published') + '">'
      + (unit.occupied >= unit.capacity ? 'Unidad llena' : unit.occupied + ' / ' + unit.capacity + ' ocupados') + '</span></div>'
      + '<div class="tracking-meta"><span>' + escape([unit.code, unit.vehicle, unit.plate].join(' · ')) + '</span><span>'
      + (unit.location ? 'GPS ' + exactTime(unit.location.updatedAt) : unit.updatedAt ? 'Sin señal reciente' : 'Esperando señal GPS') + '</span></div>';
  }

  function trackingPage() {
    const reservation = state.ride?.reservation;
    const routes = state.ride?.routes ?? state.routes;
    const route = routes.find((item) => item.id === reservation?.routeId);
    const selected = route ?? routes[0];
    const options = (selected?.stops ?? []).map((stop) => option(stop.id, stop.name, reservation?.stopId)).join('');
    const form = '<form data-form="reservation"><label class="field"><span>Ruta</span><select name="routeId" data-passenger-route required>'
      + routes.map((item) => option(item.id, item.code + ' · ' + item.name, selected?.id)).join('')
      + '</select></label><label class="field"><span>Parada de abordaje</span><select name="stopId" required>' + options
      + '</select></label><p class="form-error" role="alert" hidden></p><button class="button primary" type="submit">'
      + (reservation ? 'Actualizar reservación' : 'Reservar para hoy') + '</button></form>';
    const title = heading('¿Dónde viene mi combi?', 'Rastreo y reservación de hoy');
    if (state.offline) {
      main.innerHTML = title + '<section class="card">' + empty('pin', 'Conéctate para ver el rastreo y reservar.') + '</section>';
      return;
    }
    main.innerHTML = title + '<div class="ops-stack">'
      + (route ? '<section class="card map-card tracking-card"><div id="tracking-status" aria-live="polite">' + trackingMarkup(state.tracking) + '</div>'
        + liveMap('Mapa de seguimiento de tu combi') + '</section>' : '')
      + (!reservation?.boardedAt ? '<section class="card ops-card"><h2>' + (reservation ? 'Mi reservación' : 'Reserva tu ruta') + '</h2>'
        + (routes.length ? form : empty('route', 'Aún no hay rutas publicadas.')) + '</section>' : '')
      + (state.config.pushKey && 'PushManager' in window ? '<section class="card ops-card alert-settings"><div><h2>Alerta de proximidad</h2>'
        + '<p>A 5 minutos o 2 paradas de tu destino de abordaje.</p></div><button type="button" class="button secondary" data-action="push-toggle" data-enabled="false">'
        + icon('bell', 16) + '<span>Activar avisos</span></button></section>' : '') + '</div>';
    if (route) {
      const index = route.stops.findIndex((stop) => stop.id === reservation.stopId || stop.name === reservation.stop);
      mountLiveMap([route], route, Math.max(0, index));
      updateTracking();
    }
    void syncPushButton();
  }

  function updateTracking() {
    const status = main.querySelector('#tracking-status');
    if (!status) return;
    const markup = trackingMarkup(state.tracking);
    replaceMarkup('tracking-status', markup);
    const unit = state.tracking?.unit;
    state.map?.setUnits(unit ? [unit] : [], unit?.tripId);
  }

  async function syncPushButton() {
    const button = main.querySelector('[data-action="push-toggle"]');
    if (!button || !('serviceWorker' in navigator)) return;
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      setPushButton(button, Boolean(subscription) && Notification.permission === 'granted');
    } catch {
      setPushButton(button, false);
    }
  }

  function setPushButton(button, enabled) {
    button.dataset.enabled = String(enabled);
    button.querySelector('span').textContent = enabled ? 'Desactivar avisos' : 'Activar avisos';
  }

  async function togglePush(button) {
    button.disabled = true;
    try {
      if (button.dataset.enabled !== 'true' && await Notification.requestPermission() !== 'granted') {
        throw new Error('Permite las notificaciones desde la configuración del navegador.');
      }
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration?.active) throw new Error('La app todavía se está preparando. Intenta de nuevo en un momento.');
      const existing = await registration.pushManager.getSubscription();
      if (button.dataset.enabled === 'true' && existing) {
        await api('my/push', { method: 'DELETE', body: { endpoint: existing.endpoint } });
        await existing.unsubscribe();
        setPushButton(button, false);
        showFlash('Avisos de proximidad desactivados.');
        return;
      }
      const subscription = existing ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: state.config.pushKey });
      try {
        await api('my/push', { method: 'POST', body: subscription.toJSON() });
      } catch (error) {
        if (!existing) await subscription.unsubscribe();
        throw error;
      }
      setPushButton(button, true);
      showFlash('Avisos de proximidad activados.');
    } finally {
      button.disabled = false;
    }
  }

  function capacityMarkup(occupied, capacity) {
    const fraction = capacity ? occupied / capacity : 0;
    const style = fraction >= 1 ? 'capacity-full' : fraction >= .8 ? 'capacity-warning' : '';
    return '<div class="card ops-card occupancy ' + style + '"><h2>Aforo</h2><p><strong>' + occupied + '</strong> / ' + (capacity ?? '—') + '</p>'
      + (capacity ? '<meter min="0" max="' + capacity + '" value="' + occupied + '" aria-label="Lugares ocupados"></meter>' : '')
      + '<span>' + (fraction >= 1 ? 'Unidad llena' : capacity ? Math.max(0, capacity - occupied) + ' lugares disponibles' : 'Registra una unidad') + '</span></div>';
  }

  function driverPage() {
    const { assignments = [], vehicle, shift } = state.driverData ?? {};
    const routeOptions = assignments.map((route) => option(route.routeId, route.code + ' · ' + route.name, state.shiftRouteId)).join('');
    const vehicleForm = '<form data-form="vehicle">' + input('Nombre o número económico', 'name', vehicle?.name ?? '', { required: true, max: 80 })
      + input('Placas', 'plate', vehicle?.plate ?? '', { required: true, max: 16 }) + input('Modelo', 'model', vehicle?.model ?? '', { max: 80 })
      + input('Capacidad', 'capacity', vehicle?.capacity ?? 20, { type: 'number', min: 1, max: 100 })
      + '<p class="form-error" role="alert" hidden></p><button class="button primary" type="submit">Guardar unidad</button></form>';
    main.innerHTML = heading('Operación de chofer', vehicle ? escape(vehicle.name + ' · ' + vehicle.plate) : 'Transporte UPTex')
      + '<div class="ops-stack"><section class="driver-overview" aria-label="Estado del turno"><div id="driver-occupancy"></div><section class="card ops-card next-stop">'
      + '<h2>Próxima parada</h2><div id="driver-next-stop"></div></section></section>'
      + '<section class="card ops-card"><div class="ops-card-head"><div><h2>Mi turno</h2><p>' + (shift ? escape(shift.code + ' · ' + shift.route) : 'Selecciona una ruta asignada.') + '</p></div>'
      + (shift ? '<span class="status-tag published">En curso</span>' : '') + '</div>'
      + (shift ? '<div class="operation-actions"><button class="button secondary" type="button" data-action="resume-gps">' + icon('pin', 17) + 'Activar GPS</button>'
        + '<button class="button secondary" type="button" data-action="end-shift">Finalizar turno</button></div>'
        : assignments.length ? '<form data-form="shift"><label class="field"><span>Ruta</span><select name="routeId" required>' + routeOptions + '</select></label>'
        + '<p class="form-error" role="alert" hidden></p><button class="button primary" type="submit"' + (vehicle ? '' : ' disabled') + '>' + icon('pin', 17) + 'Iniciar turno y GPS</button></form>'
        : '<p>Coordinación aún no te asigna una ruta.</p>')
      + '<p id="location-status" class="location-status" aria-live="polite">Mantén la app visible para compartir el GPS durante el turno.</p></section>'
      + '<section class="card ops-card scanner"><h2>Escáner QR</h2><div class="operation-actions scan-modes" aria-label="Tipo de lectura">'
      + '<button class="button secondary" type="button" data-action="scan-mode" data-mode="board">Abordaje</button>'
      + '<button class="button secondary" type="button" data-action="scan-mode" data-mode="alight">Bajada</button></div>'
      + '<label class="field" id="scan-stop-wrap" hidden><span>Parada del escaneo</span><select id="scan-stop"></select></label>'
      + '<div class="camera-view"><video id="qr-camera" playsinline muted hidden></video><span class="camera-guide" aria-hidden="true"></span></div><canvas id="qr-frame" hidden></canvas>'
      + '<button class="button primary scanner-toggle" type="button" data-action="scan-camera">' + icon('camera', 19) + '<span>Abrir cámara</span></button>'
      + '<div id="scan-result" aria-live="polite"></div><details><summary>Ingresar código manualmente</summary><form data-form="scan">'
      + '<label class="field"><span>Código QR</span><input name="qrToken" autocomplete="off" maxlength="100" required></label>'
      + '<p class="form-error" role="alert" hidden></p><button class="button secondary" type="submit">Registrar lectura</button></form></details></section>'
      + '<details class="card ops-card unit-settings"' + (vehicle ? '' : ' open') + '><summary>Configurar unidad</summary>' + vehicleForm + '</details>'
      + '<section class="card ops-card driver-manifest"><h2>Reservaciones de mi ruta</h2><div id="driver-expected"></div></section></div>';
    updateDriver();
    setScanMode(state.scanAction);
  }

  function replaceMarkup(id, markup) {
    const target = main.querySelector('#' + id);
    if (target && target.dataset.markup !== markup) {
      target.dataset.markup = markup;
      target.innerHTML = markup;
    }
  }

  function updateDriver() {
    if (!main.querySelector('#driver-occupancy')) return;
    const { occupied = 0, vehicle, passengers = [], shift } = state.driverData ?? {};
    replaceMarkup('driver-occupancy', capacityMarkup(occupied, vehicle?.capacity));
    const nextStop = shift?.nextStop;
    replaceMarkup('driver-next-stop', nextStop ? '<strong>' + escape(nextStop.name) + '</strong><p>' + nextStop.waiting
      + (nextStop.waiting === 1 ? ' persona espera abordar' : ' personas esperan abordar') + '</p>' : '<p>Disponible al iniciar turno.</p>');
    const stopSelect = main.querySelector('#scan-stop');
    const board = state.scanAction === 'board';
    const selected = stopSelect.dataset[state.scanAction] ?? (board ? '' : nextStop?.id ?? '');
    const options = (board ? option('', 'Parada de la reservación', selected) : '')
      + (shift?.stops ?? []).map((stop) => option(stop.id, stop.name, selected)).join('');
    if (stopSelect.dataset.options !== options) {
      stopSelect.innerHTML = options;
      stopSelect.dataset.options = options;
    }
    const rows = shift ? passengers.filter((p) => p.routeId === shift.routeId) : passengers;
    replaceMarkup('driver-expected', rows.length ? '<div class="table-wrap"><table><thead><tr><th>Pasajero</th><th>Parada</th><th>Estado</th></tr></thead><tbody>'
      + rows.map((p) => '<tr><td>' + escape(p.name) + '</td><td>' + escape(p.stop) + '</td><td>'
        + (p.alightedAt ? 'Bajó ' + exactTime(p.alightedAt) : p.boardedAt ? 'Abordó ' + exactTime(p.boardedAt) : 'Por abordar')
        + '</td></tr>').join('') + '</tbody></table></div>' : empty('users', 'Sin reservaciones para mostrar.'));
  }

  function setScanMode(mode) {
    state.scanAction = mode;
    main.querySelectorAll('[data-action="scan-mode"]').forEach((button) => {
      const pressed = button.dataset.mode === mode;
      button.classList.toggle('active', pressed);
      button.setAttribute('aria-pressed', String(pressed));
    });
    const stop = main.querySelector('#scan-stop-wrap');
    stop.hidden = !state.driverData?.shift?.stops.length;
    stop.querySelector('span').textContent = mode === 'alight' ? 'Parada de bajada' : 'Parada de abordaje';
    updateDriver();
  }

  function radarPage() {
    main.innerHTML = heading('Torre de Control UPTex', 'Ubicación de unidades y pasajeros a bordo')
      + '<div class="radar-grid"><section class="card map-card"><div class="panel-head"><div class="panel-title"><span class="panel-glyph">'
      + icon('map', 22) + '</span><div><h2>Radar de unidades</h2><p id="radar-count">Cargando unidades…</p></div></div></div>'
      + liveMap('Mapa de las unidades en servicio') + '<div id="radar-units" class="route-pills radar-units" aria-label="Unidades en servicio"></div></section>'
      + '<section class="card ops-card" id="radar-manifest" aria-label="Manifiesto de pasajeros"></section></div>';
    mountLiveMap(state.routes, null, 0, chooseUnit);
    updateRadar();
  }

  function chooseUnit(id) {
    state.unitId = id;
    updateRadar();
  }

  function updateRadar() {
    const status = main.querySelector('#radar-count');
    if (!status) return;
    const units = state.units ?? [];
    const selected = units.find((unit) => unit.tripId === state.unitId) ?? units[0];
    state.unitId = selected?.tripId;
    status.textContent = units.length ? units.filter((unit) => unit.location).length + ' de ' + units.length + ' unidades con señal GPS' : 'No hay turnos activos';
    state.map?.setUnits(units, state.unitId);
    const focused = document.activeElement?.closest('[data-action="radar-unit"]')?.dataset.id;
    replaceMarkup('radar-units', units.map((unit) => '<button class="route-pill tone-' + unit.color + (unit.tripId === state.unitId ? ' selected' : '')
      + '" data-action="radar-unit" data-id="' + unit.tripId + '" aria-pressed="' + (unit.tripId === state.unitId) + '"><span></span><b>'
      + escape(unit.code) + '</b> ' + escape(unit.plate) + '</button>').join(''));
    if (focused) main.querySelector('[data-action="radar-unit"][data-id="' + focused + '"]')?.focus({ preventScroll: true });
    replaceMarkup('radar-manifest', selected ? manifestMarkup(selected) : '<h2>Pasajeros a bordo</h2>' + empty('bus', 'El manifiesto aparece al iniciar un turno.'));
  }

  function manifestMarkup(unit) {
    const offset = unit.offsetMinutes;
    const status = offset === null ? 'Horario por confirmar' : offset === 0 ? 'A tiempo' : Math.abs(offset) + ' min ' + (offset > 0 ? 'de retraso' : 'de adelanto');
    return '<div class="ops-card-head"><div>' + routeBadge(unit) + ' <strong>' + escape(unit.route) + '</strong><p>'
      + escape(unit.vehicle + ' · ' + unit.plate) + '</p></div><span class="status-tag ' + (offset > 0 ? 'capacity-warning' : 'published') + '">' + status + '</span></div>'
      + '<dl class="ride-details"><div><dt>Chofer</dt><dd>' + escape(unit.driver) + '</dd></div><div><dt>Aforo</dt><dd>' + unit.occupied + ' / ' + unit.capacity + '</dd></div>'
      + '<div><dt>Salida programada / real</dt><dd>' + escape(unit.departure ?? '—') + ' / ' + exactTime(unit.departedAt) + '</dd></div>'
      + '<div><dt>Próxima parada</dt><dd>' + escape(unit.nextStop ?? '—') + '</dd></div></dl>'
      + '<h2 class="manifest-title">Pasajeros a bordo</h2>' + (unit.manifest.length ? '<div class="table-wrap"><table><thead><tr><th>Nombre</th><th>Matrícula</th><th>Rol</th></tr></thead><tbody>'
        + unit.manifest.map((p) => '<tr><td>' + escape(p.passenger) + '</td><td>' + escape(p.matricula ?? 'Sin registrar') + '</td><td>' + escape(roleNames[p.role]) + '</td></tr>').join('')
        + '</tbody></table></div>' : empty('users', 'Sin pasajeros a bordo.'));
  }

  function historyPage() {
    main.innerHTML = heading('Mi historial', 'Registro de tus abordajes y bajadas')
      + '<section class="card ops-card" id="trip-history" aria-live="polite"></section>';
    if (state.offline) main.querySelector('#trip-history').innerHTML = empty('clock', 'Conéctate para consultar tu historial.');
    else void loadHistory();
  }

  function adminHistory() {
    return '<section class="card ops-card"><h2>Trazabilidad de pasajeros</h2><form data-form="history-search" class="history-search">'
      + '<label class="field"><span>Nombre, matrícula o placas</span><input name="query" maxlength="120" value="' + escape(state.historyQuery ?? '') + '"></label>'
      + '<p class="form-error" role="alert" hidden></p><button class="button secondary" type="submit">' + icon('search', 17) + 'Buscar</button></form>'
      + '<div id="trip-history" aria-live="polite"></div></section>';
  }

  let historyRequest = 0;
  async function loadHistory(before) {
    const target = main.querySelector('#trip-history');
    if (!target) return;
    const request = ++historyRequest;
    const admin = state.user?.role === 'admin';
    const params = new URLSearchParams();
    if (admin && state.historyQuery) params.set('q', state.historyQuery);
    if (before) params.set('before', before);
    if (!before) target.innerHTML = '<p class="loading">Cargando viajes…</p>';
    try {
      const { history, next } = await api((admin ? 'admin' : 'my') + '/history?' + params);
      if (request !== historyRequest || !target.isConnected) return;
      const rows = history.map((p) => '<article class="history-trip"><div class="ops-card-head"><div><h3>'
        + escape(admin ? p.passenger : p.routeCode + ' · ' + p.route) + '</h3><p>' + escape(dateLabel(p.date))
        + (admin ? ' · ' + escape([p.matricula ?? 'Sin matrícula', roleNames[p.role], p.routeCode].join(' · ')) : '') + '</p></div>'
        + '<span class="status-tag ' + (p.alightedAt ? '' : 'published') + '">' + (p.alightedAt ? 'Viaje completado' : 'A bordo') + '</span></div>'
        + '<dl class="ride-details"><div><dt>Abordaje</dt><dd>' + exactTime(p.boardedAt) + '</dd><dt>' + escape(p.stop) + '</dt></div>'
        + '<div><dt>Bajada</dt><dd>' + exactTime(p.alightedAt) + '</dd>' + (p.alightStop ? '<dt>' + escape(p.alightStop) + '</dt>' : '') + '</div>'
        + '<div><dt>Unidad · placas</dt><dd>' + escape([p.vehicle, p.plate].join(' · ')) + '</dd></div><div><dt>Chofer</dt><dd>' + escape(p.driver) + '</dd></div></dl></article>').join('');
      const more = next ? '<button type="button" class="button secondary history-more" data-action="history-more" data-id="' + next + '">Ver más viajes</button>' : '';
      if (before) {
        target.querySelector('.history-more')?.remove();
        target.insertAdjacentHTML('beforeend', rows + more);
      } else target.innerHTML = rows ? rows + more : empty('clock', 'No hay abordajes registrados para esta consulta.');
    } catch (error) {
      if (request !== historyRequest || !target.isConnected) return;
      if (before) showFlash(error.message, true);
      else target.innerHTML = empty('alert', error.message);
    }
  }

  function ridershipPage() {
    return '<section class="card ops-card"><h2>Afluencia por hora y parada</h2><form data-form="ridership" class="history-search">'
      + input('Fecha del servicio', 'date', state.ridershipDate ?? '', { type: 'date' })
      + '<p class="form-error" role="alert" hidden></p><button type="submit" class="button secondary">Consultar</button></form>'
      + '<div id="ridership" aria-live="polite"></div></section>';
  }

  async function loadRidership() {
    const target = main.querySelector('#ridership');
    if (!target) return;
    target.innerHTML = '<p class="loading">Cargando abordajes…</p>';
    try {
      const { date, total, groups } = await api('admin/ridership?' + new URLSearchParams({ date: state.ridershipDate ?? '' }));
      if (!target.isConnected) return;
      target.previousElementSibling.elements.date.value = date;
      target.innerHTML = total ? '<p class="ridership-total">' + total + (total === 1 ? ' abordaje' : ' abordajes') + '</p>'
        + '<div class="table-wrap"><table><thead><tr><th>Hora</th><th>Ruta</th><th>Parada</th><th>Abordajes</th></tr></thead><tbody>'
        + groups.map((g) => '<tr><td>' + escape(g.hour) + '</td><td>' + escape(g.routeCode) + '</td><td>' + escape(g.stop) + '</td><td>' + g.boarded + '</td></tr>').join('')
        + '</tbody></table></div>' : empty('users', 'No hay abordajes en esta fecha.');
    } catch (error) {
      if (target.isConnected) target.innerHTML = empty('alert', error.message);
    }
  }

  return { passengerPage, passStatus, trackingPage, updateTracking, togglePush, driverPage, updateDriver, setScanMode,
    radarPage, updateRadar, chooseUnit, historyPage, adminHistory, loadHistory, ridershipPage, loadRidership };
}
