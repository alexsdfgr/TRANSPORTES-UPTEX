import { icon } from './icons.js';
import { RouteMap, mapControls, mapsLink, routeColors } from './maps.js';

const sidebar = document.querySelector('#sidebar');
const topbar = document.querySelector('#topbar');
const mobileNav = document.querySelector('#mobile-nav');
const main = document.querySelector('#main');
const dialog = document.querySelector('#dialog');
const flash = document.querySelector('#flash');

const navigation = [
  ['inicio', 'Panel general', 'grid'],
  ['rutas', 'Rutas y paradas', 'route'],
  ['horarios', 'Horarios', 'clock'],
  ['avisos', 'Avisos', 'bell'],
];
const roleNames = { admin: 'Coordinación', driver: 'Chofer', student: 'Alumno', teacher: 'Profesor' };
const noticeTypes = { general: ['General', 'info'], schedule: ['Horarios', 'clock'], traffic: ['Tráfico', 'traffic'] };
const routeColorNames = { blue: 'Azul', teal: 'Verde', orange: 'Naranja', purple: 'Morado' };
const currency = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 2, minimumFractionDigits: 0 });
const calendar = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Mexico_City' });
const clock = new Intl.DateTimeFormat('es-MX', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/Mexico_City' });

const state = {
  user: null, config: {}, routes: [], notices: [], admin: null, ride: null, driverData: null, hasData: false, offline: false,
  selectedId: null, stop: 0, page: 'inicio', adminTab: 'rutas',
  map: null, estimate: null, showTraffic: false, noticeFilter: 'all', scheduleFilter: 'all',
  registerMode: false, scanAction: 'board', locationWatchId: null,
};
let flashTimeout;
let installPrompt;

function escape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (part) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[part]);
}

function option(value, name, selected) {
  return '<option value="' + escape(value) + '"' + (String(value) === String(selected) ? ' selected' : '') + '>' + escape(name) + '</option>';
}

function formatTime(value) {
  return value || 'Por confirmar';
}

function asNumber(value) {
  return value === '' ? null : Number(value);
}

function showFlash(message, error = false) {
  flash.className = 'toast' + (error ? ' toast-error' : '');
  flash.innerHTML = icon(error ? 'alert' : 'check', 18) + '<span>' + escape(message) + '</span>';
  clearTimeout(flashTimeout);
  flashTimeout = setTimeout(() => { flash.className = ''; flash.textContent = ''; }, 4200);
}

async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch('/api/' + path, {
    method,
    headers: method === 'GET' ? undefined : { 'Content-Type': 'application/json', 'X-UPTEX-Request': '1' },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'No se pudo completar la solicitud.');
  if (response.headers.get('X-UPTEX-Offline') === '1') data.offline = true;
  return data;
}

async function refresh() {
  const data = await api(state.user ? 'dashboard' : 'catalog');
  Object.assign(state, data, { hasData: true, offline: Boolean(data.offline) });
  if (state.user?.role === 'admin') state.admin = await api('admin/state');
  else state.admin = null;
  state.ride = ['student','teacher'].includes(state.user?.role) ? await api('my/ride') : null;
  state.driverData = state.user?.role === 'driver' ? await api('driver/state') : null;
  if (!state.routes.some((route) => route.id === state.selectedId)) {
    state.selectedId = state.routes[0]?.id ?? null;
    state.stop = 0;
  }
}

function activeRoute() {
  return state.routes.find((route) => route.id === state.selectedId);
}

function routeBadge(route) {
  return '<span class="route-badge tone-' + route.color + '">' + escape(route.code) + '</span>';
}

function empty(iconName, message) {
  return '<div class="empty">' + icon(iconName, 28) + '<p>' + escape(message) + '</p></div>';
}

function initials(label) {
  return label.split(/\s+/).slice(0, 2).map((word) => word[0]).join('').toUpperCase();
}

function renderNav() {
  const links = [...navigation];
  if (state.user?.role === 'admin') links.push(['gestion', 'Administración', 'shield']);
  if (['student','teacher'].includes(state.user?.role)) links.push(['mi-viaje','Mi viaje','route']);
  if (state.user?.role === 'driver') links.push(['chofer','Módulo de chofer','bus']);
  const unread = state.notices.filter((notice) => !notice.isRead).length;
  const navLink = ([key, label, glyph], mobile = false) => {
    const name = mobile ? { inicio: 'Inicio', rutas: 'Rutas', horarios: 'Horarios', avisos: 'Avisos', gestion: 'Gestión', 'mi-viaje':'Mi viaje', chofer:'Chofer' }[key] : label;
    return '<a href="#' + key + '" class="nav-link' + (state.page === key ? ' current' : '') + '"' + (state.page === key ? ' aria-current="page"' : '') + '>'
      + icon(glyph, mobile ? 19 : 19) + '<span>' + name + '</span>'
      + (key === 'avisos' && unread && !mobile ? '<span class="nav-count">' + unread + '</span>' : '') + '</a>';
  };
  sidebar.innerHTML = '<a class="brand" href="#inicio" aria-label="Transporte UPTex, inicio"><img class="brand-logo" src="/uptex-logo.jpg" alt="UPTex, transporte universitario"></a>'
    + '<div class="side-content"><span class="side-label">MENÚ PRINCIPAL</span><nav>' + links.map((link) => navLink(link)).join('') + '</nav></div>'
    + '<div class="side-bottom"><button class="side-help" data-action="install">' + icon('phone', 18) + '<span>App móvil</span>' + icon('chevron', 14) + '</button>'
    + '<div class="campus-brand"><img class="campus-full-logo" src="/uptex-logo.jpg" alt="UPTex, transporte universitario"></div></div>';
  mobileNav.innerHTML = links.map((link) => navLink(link, true)).join('');
  const label = links.find(([key]) => key === state.page)?.[1] ?? 'Panel general';
  topbar.innerHTML = '<a class="mobile-brand" href="#inicio"><img class="brand-logo" src="/uptex-logo.jpg" alt="UPTex"></a>'
    + '<div class="breadcrumb"><span>Transporte</span>' + icon('chevron', 14) + '<strong>' + label + '</strong></div>'
    + '<div class="top-actions"><button class="icon-button mobile-install" data-action="install" aria-label="Instalar app móvil" title="App móvil">' + icon('phone', 19) + '</button>'
    + '<a class="icon-button notifications" href="#avisos" aria-label="Ver avisos" title="Avisos">' + icon('bell', 20) + (unread ? '<i></i>' : '') + '</a><span class="top-divider"></span>'
    + '<button type="button" class="profile" data-action="account"><span class="avatar">' + (state.user ? escape(initials(state.user.name)) : icon('user', 17)) + '</span>'
    + '<span>' + (state.user ? escape(roleNames[state.user.role]) : 'Iniciar sesión') + '</span>' + icon('down', 14) + '</button></div>';
}

function heading(title, description, extra = '') {
  return '<div class="page-heading"><div><h1>' + title + '</h1><p>' + description + '</p></div>' + (extra ? '<div class="page-actions">' + extra + '</div>' : '') + '</div>';
}

function stats() {
  const first = state.routes.map((route) => route.departure).filter(Boolean).sort()[0];
  const items = [
    ['route', 'blue', 'Rutas activas', state.routes.length, 'Recorridos publicados'],
    ['pin', 'teal', 'Paradas', state.routes.reduce((total, route) => total + route.stops.length, 0), 'En los itinerarios'],
    ['clock', 'orange', 'Primera salida', first ?? '—', 'Hora programada'],
    ['bell', 'purple', 'Avisos', state.notices.length, 'Publicados para la comunidad'],
  ];
  return '<div class="stats">' + items.map(([glyph, color, label, value, detail]) => '<article class="stat card"><span class="stat-icon tone-' + color + '">' + icon(glyph, 21)
    + '</span><div><p>' + label + '</p><strong>' + value + '</strong><small>' + detail + '</small></div></article>').join('') + '</div>';
}

function mapSection() {
  const hasKey = !state.offline && Boolean(state.config.browserKey);
  return '<div class="map-grid"><section class="card map-card" aria-labelledby="map-title">'
    + '<div class="panel-head"><div class="panel-title"><span class="panel-glyph">' + icon('map', 21) + '</span><div><h2 id="map-title">Mapa de rutas</h2><p>Recorridos hacia el campus UPTex</p></div></div>'
    + '<label class="traffic-toggle' + (hasKey ? '' : ' unavailable') + '"><input type="checkbox" data-traffic ' + (state.showTraffic ? 'checked ' : '') + (hasKey ? '' : 'disabled ') + '><span class="switch"></span><span>Tráfico</span></label></div>'
    + '<div id="route-pills" class="route-pills"></div><div id="map-area" class="map-area"><canvas aria-label="Mapa esquemático de los recorridos"></canvas>'
    + '<div class="google-map" aria-label="Mapa interactivo de Google" hidden></div>' + mapControls()
    + '<span id="map-credit" class="map-credit">Ubicaciones aproximadas</span></div>'
    + '<div class="map-footer"><span id="map-status" aria-live="polite"></span><button class="text-button" data-action="map-refresh" hidden>' + icon('refresh', 14) + 'Actualizar</button></div></section>'
    + '<section class="card itinerary" id="itinerary" aria-label="Itinerario de la ruta"></section></div>';
}

function routeCards() {
  if (!state.routes.length) return empty('route', 'Aún no hay rutas publicadas.');
  return '<div class="route-cards">' + state.routes.map((route) => {
    const fares = route.stops.map((stop) => stop.fare).filter((fare) => fare !== null);
    const minimum = fares.length ? Math.min(...fares) : null;
    const maximum = fares.length ? Math.max(...fares) : null;
    const fareLabel = minimum === null ? 'Sin tarifa' : currency.format(minimum) + (minimum !== maximum ? '–' + currency.format(maximum) : '');
    return '<article class="route-card card tone-' + route.color + '"><div class="route-card-top"><span class="route-glyph">' + icon('bus', 22) + '</span>'
      + routeBadge(route) + '</div><h3>' + escape(route.name) + '</h3><p>' + escape(route.zone || 'Servicio universitario') + '</p>'
      + '<div class="route-card-info"><span>' + icon('clock', 16) + escape(formatTime(route.departure)) + '</span><span>' + icon('pin', 16) + route.stops.length + ' paradas</span><span>' + escape(fareLabel) + '</span></div>'
      + '<button class="route-card-link" data-action="view-route" data-id="' + route.id + '">Ver itinerario ' + icon('chevron', 16) + '</button></article>';
  }).join('') + '</div>';
}

function renderMapSelection(scroll = false) {
  const route = activeRoute();
  document.querySelector('#route-pills').innerHTML = state.routes.map((item) => '<button class="route-pill tone-' + item.color + (item.id === state.selectedId ? ' selected' : '')
    + '" data-action="select-route" data-id="' + item.id + '" aria-pressed="' + (item.id === state.selectedId) + '"><span></span><b>' + escape(item.code) + '</b>'
    + ' ' + escape(item.name) + '</button>').join('');
  state.estimate = null;
  renderItinerary();
  state.map.show(state.routes, route, state.stop);
  if (scroll) document.querySelector('.map-grid').scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function tripMarkup(route) {
  const trip = route.trip;
  if (!trip && !route.canRecord) return '';
  return '<div class="trip-status"><strong>Operación de hoy</strong>'
    + (trip ? '<span>Salida ' + clock.format(new Date(trip.departedAt)) + (trip.arrivedAt ? ' · Llegada ' + clock.format(new Date(trip.arrivedAt)) : ' · En recorrido') + '</span>' : '<span>Salida pendiente de registro</span>')
    + (route.canRecord && !trip?.arrivedAt ? '<button class="button small secondary" data-action="trip" data-trip="' + (trip ? 'arrival' : 'departure') + '">' + (trip ? 'Registrar llegada' : 'Registrar salida') + '</button>' : '')
    + '</div>';
}

function estimateMarkup(route) {
  const minutes = (value) => Number.isFinite(value) ? Math.round(value / 60000) : null;
  const estimate = state.estimate;
  if (!estimate || minutes(estimate.duration) === null) return '<span>' + icon('clock', 15) + (route.arrival ? 'Llegada programada <b>' + route.arrival + '</b>' : 'Llegada por confirmar') + '</span>';
  const duration = minutes(estimate.duration);
  const base = minutes(estimate.staticDuration);
  const extra = base === null ? 0 : duration - base;
  return '<span>' + icon('traffic', 15) + '<b>' + duration + ' min</b> estimados por Google'
    + (Number.isFinite(estimate.distance) ? ' · ' + (estimate.distance / 1000).toLocaleString('es-MX', { maximumFractionDigits: 1 }) + ' km' : '')
    + (extra > 0 ? ' · +' + extra + ' min de tráfico' : '') + '</span>';
}

function renderItinerary() {
  const container = document.querySelector('#itinerary');
  const route = activeRoute();
  if (!route) {
    container.innerHTML = '<div class="panel-head"><h2>Itinerario</h2></div>' + empty('route', 'Aún no hay itinerarios disponibles.');
    return;
  }
  const color = routeColors[route.color];
  container.style.setProperty('--route-color', color);
  const list = route.stops.map((stop, index) => '<li><button class="stop-row' + (index === state.stop ? ' is-selected' : '') + '" data-action="stop" data-index="' + index
    + '" aria-pressed="' + (index === state.stop) + '"><span class="stop-node' + (index === route.stops.length - 1 ? ' last' : '') + '">'
    + (index === route.stops.length - 1 ? icon('flag', 12) : (index + 1)) + '</span><span class="stop-name">' + escape(stop.name)
    + '</span><span class="stop-time">' + (stop.time || '<span aria-label="Hora por confirmar">—</span>') + '</span></button></li>').join('');
  container.innerHTML = '<div class="panel-head itinerary-head"><div class="panel-title"><span class="panel-glyph">' + icon('route', 21)
    + '</span><div><h2>Itinerario</h2><p>Paradas y horarios</p></div></div>' + routeBadge(route) + '</div>'
    + '<div class="itinerary-summary"><div><strong>' + escape(route.name) + '</strong><span>' + route.stops.length + ' paradas · Salida ' + escape(formatTime(route.departure)) + '</span></div></div>'
    + '<ol class="stop-list">' + list + '</ol><div id="stop-detail" class="stop-detail"></div><div class="estimate" id="estimate">' + estimateMarkup(route) + '</div>'
    + tripMarkup(route) + (route.notes ? '<details class="route-notes"><summary>Notas del servicio</summary><p>' + escape(route.notes) + '</p></details>' : '');
  updateStop(state.stop, false);
}

function updateStop(index, focusMap = true) {
  const route = activeRoute();
  const stop = route?.stops[index];
  if (!stop) return;
  state.stop = index;
  document.querySelectorAll('.stop-row').forEach((node) => {
    const active = Number(node.dataset.index) === index;
    node.classList.toggle('is-selected', active);
    node.setAttribute('aria-pressed', String(active));
  });
  const detail = document.querySelector('#stop-detail');
  detail.innerHTML = '<span>' + icon('pin', 16) + '<span><b>Tarifa</b> ' + (stop.fare === null ? 'Sin dato' : currency.format(stop.fare) + ' MXN')
    + '</span></span><a href="' + mapsLink(stop) + '" target="_blank" rel="noopener" aria-label="Abrir ' + escape(stop.name) + ' en Google Maps" title="Abrir parada en Google Maps">' + icon('external', 16) + '</a>';
  if (focusMap) state.map?.focus(index);
}

function setMapStatus(status) {
  const messages = {
    demo: ['Mapa de referencia', state.offline ? 'Catálogo disponible sin conexión.' : 'Activa Google Maps para calcular rutas y tráfico.'],
    reference: ['Mapa de referencia', 'Selecciona una ruta publicada.'],
    loading: ['Conectando con Google Maps', 'Calculando el recorrido por las paradas…'],
    google: ['Google Maps', 'Recorrido calculado con tráfico entre las ubicaciones registradas.'],
    error: ['Mapa de referencia', 'Google Maps no está disponible. Revisa la configuración o vuelve a intentar.'],
  };
  const [label, message] = messages[status];
  document.querySelector('#map-mode span').textContent = label;
  document.querySelector('#map-mode').hidden = status === 'google';
  document.querySelector('#map-credit').hidden = status === 'google';
  document.querySelector('#map-status').innerHTML = icon(status === 'google' ? 'check' : 'info', 15) + '<span>' + message + '</span>';
  document.querySelector('[data-action="map-refresh"]').hidden = status !== 'error' && status !== 'google';
}

function mountMap() {
  state.map = new RouteMap(document.querySelector('#map-area'), state.offline ? {} : state.config, {
    onStop: (index) => updateStop(index),
    onEstimate: (estimate) => {
      state.estimate = estimate;
      const node = document.querySelector('#estimate');
      if (node && activeRoute()) node.innerHTML = estimateMarkup(activeRoute());
    },
    onStatus: setMapStatus,
  });
  state.map.setTraffic(state.showTraffic);
  renderMapSelection();
}

function dashboard() {
  const badges = (state.offline ? '<span class="demo-pill"><i></i>Sin conexión</span>'
    : state.config.demo ? '<span class="demo-pill"><i></i>Modo demostración</span>' : '')
    + '<span class="date-pill">' + icon('calendar', 16) + escape(calendar.format(new Date())) + '</span>';
  main.innerHTML = heading('Panel general', 'Rutas, horarios y avisos del transporte universitario.', badges)
    + stats() + mapSection() + '<section class="routes-section"><div class="section-head"><div><h2>Rutas del servicio</h2><p>Consulta el recorrido y la tarifa de cada ruta.</p></div>'
    + '<a class="text-button" href="#horarios">Ver horarios ' + icon('chevron', 16) + '</a></div>' + routeCards() + '</section>';
  mountMap();
}

function routesPage() {
  main.innerHTML = heading('Rutas y paradas', 'Selecciona una ruta para consultar su recorrido hacia UPTex.')
    + mapSection() + '<section class="routes-section"><div class="section-head"><h2>Rutas publicadas</h2></div>' + routeCards() + '</section>';
  mountMap();
}

function schedulePage() {
  const filter = '<label class="filter"><span>Ruta</span><select data-filter="schedule">' + option('all', 'Todas las rutas', state.scheduleFilter)
    + state.routes.map((route) => option(route.id, route.code + ' · ' + route.name, state.scheduleFilter)).join('') + '</select></label>';
  const routes = state.routes.filter((route) => state.scheduleFilter === 'all' || String(route.id) === state.scheduleFilter);
  main.innerHTML = heading('Horarios', 'Salidas y llegadas programadas en hora del centro de México.', filter)
    + '<div class="schedule-grid">' + (routes.map((route) => '<article class="card schedule-card"><div class="panel-head"><div class="panel-title">' + routeBadge(route) + '<h2>'
      + escape(route.name) + '</h2></div></div><dl class="schedule-times"><div><dt>' + icon('clock', 15) + 'Salida</dt><dd>' + escape(formatTime(route.departure))
      + '</dd></div><div><dt>' + icon('flag', 15) + 'Llegada</dt><dd>' + escape(formatTime(route.arrival)) + '</dd></div></dl>'
      + '<div class="table-wrap"><table><thead><tr><th scope="col">Parada</th><th scope="col">Hora</th><th scope="col">Tarifa</th></tr></thead><tbody>'
      + route.stops.map((stop) => '<tr><td>' + escape(stop.name) + '</td><td>' + (stop.time || '—') + '</td><td>'
        + (stop.fare === null ? '—' : currency.format(stop.fare)) + '</td></tr>').join('') + '</tbody></table></div>'
      + (route.notes ? '<p class="schedule-note">' + icon('info', 16) + escape(route.notes) + '</p>' : '') + '</article>').join('') || empty('clock', 'No hay horarios publicados.')) + '</div>';
}

function noticeCard(notice, admin = false) {
  const [label, glyph] = noticeTypes[notice.kind] ?? noticeTypes.general;
  return '<article class="notice card"><span class="notice-icon tone-' + ({ schedule: 'blue', traffic: 'orange', general: 'teal' })[notice.kind] + '">'
    + icon(glyph, 22) + '</span><div class="notice-content"><div class="notice-meta"><span>' + label + '</span>'
    + (notice.routeName ? '<span>' + escape(notice.routeName) + '</span>' : '') + '<time datetime="' + escape(notice.createdAt) + '">' + escape(calendar.format(new Date(notice.createdAt))) + '</time></div>'
    + '<h2>' + escape(notice.title) + '</h2><p>' + escape(notice.body) + '</p></div>'
    + (admin ? '<button class="button secondary small" data-action="toggle-notice" data-id="' + notice.id + '" data-publish="' + !notice.published + '">' + (notice.published ? 'Archivar' : 'Republicar') + '</button>'
      : state.user ? (notice.isRead ? '<span class="read-label">' + icon('check', 16) + 'Leído</span>'
        : '<button class="button secondary small" data-action="read-notice" data-id="' + notice.id + '">Marcar leído</button>') : '') + '</article>';
}

function noticesPage() {
  const filter = '<label class="filter"><span>Tipo de aviso</span><select data-filter="notice">' + option('all', 'Todos los avisos', state.noticeFilter)
    + Object.entries(noticeTypes).map(([kind, [label]]) => option(kind, label, state.noticeFilter)).join('') + '</select></label>';
  const notices = state.notices.filter((notice) => state.noticeFilter === 'all' || notice.kind === state.noticeFilter);
  main.innerHTML = heading('Avisos', 'Comunicados sobre horarios, tráfico y cambios del servicio.', filter)
    + '<div class="notice-list">' + (notices.map((notice) => noticeCard(notice)).join('') || empty('bell', 'No hay avisos de este tipo.')) + '</div>';
}

function passengerPage() {
  const routes=state.ride?.routes??state.routes;const reservation=state.ride?.reservation;
  const qr='<canvas id="passenger-qr" width="220" height="220" aria-label="QR personal de abordaje"></canvas>';
  const routeId=reservation?.routeId??state.selectedId??routes[0]?.id;
  const form='<form data-form="reservation"><label class="field">Ruta<select name="routeId" data-passenger-route required>'+routes.map(r=>option(r.id,r.code+' · '+r.name,routeId)).join('')+'</select></label><label class="field">Parada para abordar<select name="stopId" required>'+((routes.find(r=>String(r.id)===String(routeId))??routes[0])?.stops??[]).map(s=>option(s.id,s.name,reservation?.stopId)).join('')+'</select></label>'+submitButtons(reservation?'Actualizar viaje':'Reservar viaje')+'</form>';
  const details=reservation?'<dl class="ride-details"><div><dt>Ruta</dt><dd>'+escape(reservation.code+' · '+reservation.route)+'</dd></div><div><dt>Parada</dt><dd>'+escape(reservation.stop)+'</dd></div><div><dt>Unidad</dt><dd>'+escape(reservation.vehicle?(reservation.vehicle+' · '+reservation.plate):'Se confirma al abordar')+'</dd></div><div><dt>Chofer</dt><dd>'+escape(reservation.driver??'Pendiente de asignar')+'</dd></div><div><dt>Ingreso</dt><dd>'+escape(reservation.boardedAt?clock.format(new Date(reservation.boardedAt)):'Pendiente')+'</dd></div><div><dt>Salida</dt><dd>'+escape(reservation.alightedAt?clock.format(new Date(reservation.alightedAt)):'Pendiente')+'</dd></div></dl>':'<p>Aún no tienes una reservación para hoy.</p>';
  main.innerHTML=heading('Mi viaje','Selecciona tu ruta y la parada donde esperarás la unidad.')+'<section class="card passenger-card"><h2>Mi QR personal</h2><p>El QR usa un identificador privado. El chofer lo escanea al subir y al bajar.</p>'+qr+'<code class="qr-token">'+escape(state.ride?.qrToken??'')+'</code>'+details+'</section><section class="card passenger-card"><h2>Reservar ruta y parada</h2>'+form+'</section>';
  if(state.ride?.qrToken&&window.QRCode)QRCode.toCanvas(document.querySelector('#passenger-qr'),state.ride.qrToken,{width:220,margin:2}).catch(()=>{});
}

function driverPage() {
  const d=state.driverData??{assignments:[],vehicle:null};const assignments=d.assignments??[];
  const passengers=d.passengers??[];
  const manifest='<section class="card driver-manifest"><h2>Pasajeros de hoy</h2>'+(passengers.length?'<div class="table-wrap"><table><thead><tr><th>Pasajero</th><th>Parada</th><th>Abordaje</th><th>Bajada</th></tr></thead><tbody>'+passengers.map(p=>'<tr><td>'+escape(p.name)+'</td><td>'+escape(p.stop)+'</td><td>'+escape(p.boardedAt?clock.format(new Date(p.boardedAt)):'Pendiente')+'</td><td>'+escape(p.alightedAt?clock.format(new Date(p.alightedAt)):'Pendiente')+'</td></tr>').join('')+'</tbody></table></div>':'<p>Aún no hay personas registradas en tu ruta de hoy.</p>')+'</section>';
  main.innerHTML=heading('Módulo de chofer','Registra tu unidad; coordinación te asigna la ruta y aquí verás los abordajes.')+'<section class="card passenger-card"><h2>Unidad</h2><form data-form="vehicle">'+input('Nombre o número económico','name',d.vehicle?.name??'',{required:true,max:80})+input('Placas','plate',d.vehicle?.plate??'',{required:true,max:16})+input('Modelo','model',d.vehicle?.model??'',{max:80})+input('Capacidad','capacity',d.vehicle?.capacity??20,{type:'number',min:1,max:100})+submitButtons('Guardar unidad')+'</form></section><section class="card passenger-card"><h2>Ruta asignada</h2>'+ (assignments.map(r=>'<p><b>'+escape(r.code)+' · '+escape(r.name)+'</b> · '+escape(r.departure??'Horario por confirmar')+'</p>').join('')||'<p>Coordinación aún no te asigna ruta.</p>') +'<button class="button secondary" data-action="location">Compartir ubicación en vivo</button><p class="location-status" id="location-status" aria-live="polite">'+(d.locationUpdatedAt?'Ubicación actualizada: '+escape(clock.format(new Date(d.locationUpdatedAt))):'La ubicación solo se comparte mientras el chofer activa esta opción.')+'</p></section><section class="card passenger-card"><h2>Escanear QR</h2><p>Escanea para registrar subida o bajada. Si tu navegador no permite cámara, puedes pegar el identificador manualmente.</p><video id="qr-camera" playsinline hidden></video><canvas id="qr-frame" hidden></canvas><button class="button secondary" data-action="scan-camera">Abrir cámara</button><button class="button secondary" data-action="scan-mode">'+(state.scanAction==='board'?'Modo actual: abordar · cambiar a bajar':'Modo actual: bajar · cambiar a abordar')+'</button><form data-form="scan" data-scan-action="'+state.scanAction+'"><label class="field">Código QR<input name="qrToken" autocomplete="off" required></label><p class="form-error" role="alert" hidden></p><button class="button primary" type="submit">Registrar '+(state.scanAction==='board'?'abordaje':'bajada')+'</button></form><div id="scan-result" aria-live="polite"></div></section>'+manifest;
}

function render() {
  state.map?.destroy();
  state.map = null;
  const hash = location.hash.slice(1);
  const permitted = [...navigation.map(([key]) => key), ...(state.user?.role === 'admin' ? ['gestion'] : []), ...(['student','teacher'].includes(state.user?.role)?['mi-viaje']:[]), ...(state.user?.role==='driver'?['chofer']:[])];
  state.page = permitted.includes(hash) ? hash : 'inicio';
  renderNav();
  main.setAttribute('aria-busy', 'false');
  if (!state.hasData) {
    main.innerHTML = heading('Transporte UPTex', 'Consulta el servicio de transporte universitario.')
      + '<div class="card offline-card">' + empty('alert', 'No se pudo cargar la información del transporte.')
      + '<button class="button primary" data-action="reload">Volver a intentar</button></div>';
    return;
  }
  const pages = { inicio: dashboard, rutas: routesPage, horarios: schedulePage, avisos: noticesPage, gestion: adminPage, 'mi-viaje': passengerPage, chofer: driverPage };
  pages[state.page]();
}

function adminPage() {
  const sections = [['rutas', 'Rutas', 'route'], ['usuarios', 'Usuarios', 'users'], ['avisos', 'Avisos', 'bell'], ['viajes', 'Viajes', 'clock'], ['unidades','Unidades','bus'], ['pasajeros','Abordajes','users']];
  const buttons = {
    rutas: ['new-route', 'Nueva ruta'], usuarios: ['new-user', 'Nuevo usuario'], avisos: ['new-notice', 'Publicar aviso'],
  };
  const action = buttons[state.adminTab];
  const headerAction = action ? '<button class="button primary" data-action="' + action[0] + '">' + icon('plus', 17) + action[1] + '</button>' : '';
  const sectionsHtml = '<div class="admin-tabs" aria-label="Secciones de administración">' + sections.map(([key, title, glyph]) =>
    '<button class="button ' + (state.adminTab === key ? 'active' : '') + '" data-action="admin-tab" data-tab="' + key + '" aria-pressed="' + (state.adminTab === key) + '">' + icon(glyph, 17) + title + '</button>').join('') + '</div>';
  const tables = {
    rutas: () => '<div class="table-wrap card"><table><thead><tr><th scope="col">Ruta</th><th scope="col">Estado</th><th scope="col">Salida</th><th scope="col">Llegada</th><th scope="col">Chofer</th><th scope="col">Acción</th></tr></thead><tbody>'
      + state.admin.routes.map((route) => '<tr><td>' + routeBadge(route) + ' <b>' + escape(route.name) + '</b></td><td><span class="status-tag '
        + (route.status === 'active' ? 'published' : '') + '">' + (route.status === 'active' ? 'Publicada' : 'Borrador') + '</span></td><td>' + escape(formatTime(route.departure))
        + '</td><td>' + escape(formatTime(route.arrival)) + '</td><td>' + escape(state.admin.users.find(({ id }) => id === route.driverId)?.name ?? 'Sin asignar')
        + '</td><td><button class="text-button" data-action="edit-route" data-id="' + route.id + '">' + icon('edit', 16) + 'Editar</button></td></tr>').join('') + '</tbody></table></div>',
    usuarios: () => '<div class="table-wrap card"><table><thead><tr><th scope="col">Nombre</th><th scope="col">Correo</th><th scope="col">Rol</th><th scope="col">Estado</th><th scope="col">Acción</th></tr></thead><tbody>'
      + state.admin.users.map((user) => '<tr><td><b>' + escape(user.name) + '</b></td><td>' + escape(user.email) + '</td><td>' + roleNames[user.role]
        + '</td><td><span class="status-tag ' + (user.active ? 'published' : '') + '">' + (user.active ? 'Activo' : 'Inactivo')
        + '</span></td><td><button class="text-button" data-action="edit-user" data-id="' + user.id + '">' + icon('edit', 16) + 'Editar</button></td></tr>').join('') + '</tbody></table></div>',
    avisos: () => '<div class="notice-list">' + (state.admin.notices.map((notice) => noticeCard(notice, true)).join('') || empty('bell', 'Todavía no hay avisos.')) + '</div>',
    unidades: () => state.admin.vehicles?.length ? '<div class="table-wrap card"><table><thead><tr><th>Unidad</th><th>Placas</th><th>Modelo</th><th>Chofer</th><th>Ruta</th><th>Capacidad</th></tr></thead><tbody>'
      + state.admin.vehicles.map(v=>'<tr><td><b>'+escape(v.name)+'</b></td><td>'+escape(v.plate)+'</td><td>'+escape(v.model||'—')+'</td><td>'+escape(v.driver)+'</td><td>'+escape(v.routeCode?(v.routeCode+' · '+v.route):'Sin asignar')+'</td><td>'+v.capacity+'</td></tr>').join('')+'</tbody></table></div>'
      : empty('bus','Aún no hay unidades registradas.'),
    pasajeros: () => state.admin.passengers?.length ? '<div class="table-wrap card"><table><thead><tr><th>Fecha</th><th>Pasajero</th><th>Tipo</th><th>Ruta</th><th>Unidad / chofer</th><th>Parada</th><th>Ingreso</th><th>Salida</th></tr></thead><tbody>'
      + state.admin.passengers.map(p=>'<tr><td>'+escape(p.date)+'</td><td><b>'+escape(p.passenger)+'</b></td><td>'+escape(roleNames[p.role])+'</td><td>'+escape(p.routeCode+' · '+p.route)+'</td><td>'+escape([p.vehicle,p.plate,p.driver].filter(Boolean).join(' · ')||'Pendiente')+'</td><td>'+escape(p.stop)+'</td><td>'+escape(p.boardedAt?clock.format(new Date(p.boardedAt)):'Sin abordar')+'</td><td>'+escape(p.alightedAt?clock.format(new Date(p.alightedAt)):'A bordo')+'</td></tr>').join('')+'</tbody></table></div>'
      : empty('users','No hay reservaciones para la fecha de hoy.'),
    viajes: () => state.admin.trips.length ? '<div class="table-wrap card"><table><thead><tr><th scope="col">Fecha</th><th scope="col">Ruta</th><th scope="col">Salida prevista / real</th><th scope="col">Llegada prevista / real</th></tr></thead><tbody>'
      + state.admin.trips.map((trip) => '<tr><td>' + escape(trip.date) + '</td><td><b>' + escape(trip.code + ' · ' + trip.name) + '</b></td><td>' + trip.plannedDeparture + ' / ' + clock.format(new Date(trip.departedAt))
        + '</td><td>' + (trip.plannedArrival || '—') + ' / ' + (trip.arrivedAt ? clock.format(new Date(trip.arrivedAt)) : '—') + '</td></tr>').join('') + '</tbody></table></div>'
        : empty('clock', 'Todavía no se han registrado viajes.'),
  };
  const liveLocations=state.admin?.locations?.length?'<section class="card live-locations"><h2>Choferes en vivo</h2><div class="table-wrap"><table><thead><tr><th>Chofer</th><th>Ruta</th><th>Ubicación</th><th>Actualización</th></tr></thead><tbody>'+state.admin.locations.map(l=>'<tr><td>'+escape(l.driver)+'</td><td>'+escape(l.routeCode+' · '+l.route)+'</td><td><a href="https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(l.lat+','+l.lng)+'" target="_blank" rel="noopener">Ver en Google Maps</a></td><td>'+escape(clock.format(new Date(l.updatedAt)))+'</td></tr>').join('')+'</tbody></table></div></section>':'';
  main.innerHTML = heading('Administración', 'Gestiona rutas, personas, unidades, abordajes y operación en vivo.', headerAction)
    + (state.admin ? sectionsHtml + (state.adminTab==='pasajeros'?liveLocations:'') + tables[state.adminTab]() : empty('alert', 'No se pudo cargar la administración.'));
}

function openDialog(title, subtitle, content, { wide = false } = {}) {
  dialog.className = wide ? 'wide' : '';
  dialog.innerHTML = '<div class="dialog-heading"><div><h2 id="dialog-title">' + title + '</h2><p>' + subtitle + '</p></div>'
    + '<button class="icon-button" type="button" data-action="close" aria-label="Cerrar">' + icon('close', 21) + '</button></div>' + content;
  if (!dialog.open) dialog.showModal();
}

function field(label, name, input) {
  return '<label class="field"><span>' + label + '</span>' + input.replace('data-field', 'name="' + name + '"') + '</label>';
}

function input(label, name, value = '', { type = 'text', required = false, max, autocomplete, min, step } = {}) {
  return field(label, name, '<input data-field type="' + type + '" value="' + escape(value) + '"'
    + (required ? ' required' : '') + (max ? ' maxlength="' + max + '"' : '')
    + (min !== undefined ? ' min="' + min + '"' : '') + (step ? ' step="' + step + '"' : '')
    + (autocomplete ? ' autocomplete="' + autocomplete + '"' : '') + '>');
}

function submitButtons(verb) {
  return '<p class="form-error" role="alert" hidden></p><div class="form-actions"><button type="button" class="button secondary" data-action="close">Cancelar</button>'
    + '<button class="button primary" type="submit">' + verb + '</button></div>';
}

function accountDialog() {
  if (state.user) {
    openDialog('Mi cuenta', roleNames[state.user.role],
      '<div class="account-content"><div class="avatar">' + escape(initials(state.user.name)) + '</div><div><strong>' + escape(state.user.name)
      + '</strong><p>' + escape(state.user.email) + '</p></div></div><div class="form-actions"><button class="button secondary" data-action="logout">'
      + icon('logout', 17) + 'Cerrar sesión</button></div>');
    return;
  }
  const accounts = state.config.demoAccounts ?? [];
  if(state.registerMode){
    openDialog('Crear cuenta','Regístrate como alumno o maestro.', '<form data-form="register">'+input('Nombre completo','name','',{required:true,max:120})+input('Correo electrónico','email','',{type:'email',required:true,max:180,autocomplete:'email'})+field('Tipo de cuenta','role','<select data-field required>'+option('student','Alumno')+option('teacher','Maestro')+'</select>')+input('Contraseña (mínimo 12 caracteres)','password','',{type:'password',required:true,max:160,autocomplete:'new-password'})+submitButtons('Crear cuenta')+'</form><button class="text-button" data-action="show-login">Ya tengo cuenta · Iniciar sesión</button>');
    return;
  }
  openDialog('Iniciar sesión', 'Accede con tu cuenta de Transporte UPTex.',
    '<form data-form="login">' + (accounts.length ? '<div class="demo-login"><strong>Cuentas de demostración</strong><div>'
      + accounts.map((account) => '<button type="button" class="button small secondary" data-action="demo-fill" data-email="' + escape(account.email)
        + '">' + roleNames[account.role] + '</button>').join('') + '</div></div>' : '')
    + input('Correo electrónico', 'email', '', { type: 'email', required: true, max: 180, autocomplete: 'username' })
    + input('Contraseña', 'password', '', { type: 'password', required: true, max: 160, autocomplete: 'current-password' })
    + submitButtons('Entrar') + '</form><p class="login-help"><strong>¿Eres chofer?</strong> Inicia sesión aquí con el correo y contraseña que te asignó coordinación. Si aún no tienes cuenta, coordinación puede crearla en Administración → Usuarios.</p><button class="text-button" data-action="show-register">Crear cuenta de alumno o maestro</button>');
}

function stopEditor(stop = {}) {
  return '<div class="edit-stop"><div class="edit-stop-top"><strong>Parada</strong><div class="edit-stop-actions">'
    + '<button type="button" class="icon-button" data-action="move-up" aria-label="Subir parada" title="Subir">' + icon('up', 16) + '</button>'
    + '<button type="button" class="icon-button" data-action="move-down" aria-label="Bajar parada" title="Bajar">' + icon('down', 16) + '</button>'
    + '<button type="button" class="icon-button" data-action="remove-stop" aria-label="Quitar parada" title="Quitar">' + icon('trash', 16) + '</button></div></div>'
    + input('Nombre', 'stopName', stop.name, { required: true, max: 140 })
    + '<div class="field-row stop-fields">' + input('Latitud', 'lat', stop.lat, { type: 'number', required: true, min: -90, step: 'any' })
    + input('Longitud', 'lng', stop.lng, { type: 'number', required: true, min: -180, step: 'any' })
    + input('Hora', 'stopTime', stop.time, { type: 'time' }) + input('Tarifa MXN', 'fare', stop.fare, { type: 'number', min: 0, step: '.01' })
    + '</div></div>';
}

function routeDialog(route = { code: '', name: '', zone: '', color: 'blue', status: 'draft', driverId: null, notes: '', stops: [] }) {
  const drivers = state.admin.users.filter((user) => user.role === 'driver' && user.active);
  openDialog(route.id ? 'Editar ruta' : 'Nueva ruta', 'Configura el horario y ordena las paradas del recorrido.',
    '<form data-form="route" data-id="' + (route.id ?? '') + '"><div class="field-row">'
    + input('Código', 'code', route.code, { required: true, max: 12 }) + input('Nombre', 'name', route.name, { required: true, max: 100 }) + '</div>'
    + '<div class="field-row">' + input('Zona', 'zone', route.zone, { max: 60 })
    + field('Color', 'color', '<select data-field>' + Object.entries(routeColorNames).map(([color, label]) => option(color, label, route.color)).join('') + '</select>')
    + field('Estado', 'status', '<select data-field>' + option('draft', 'Borrador', route.status) + option('active', 'Publicada', route.status) + '</select>') + '</div>'
    + '<div class="field-row">' + input('Salida', 'departure', route.departure, { type: 'time' }) + input('Llegada', 'arrival', route.arrival, { type: 'time' })
    + field('Chofer', 'driverId', '<select data-field>' + option('', 'Sin asignar', route.driverId ?? '') + drivers.map((driver) => option(driver.id, driver.name, route.driverId)).join('') + '</select>') + '</div>'
    + field('Notas del servicio', 'notes', '<textarea data-field rows="2" maxlength="600">' + escape(route.notes) + '</textarea>')
    + '<div class="stop-editor-actions"><h3>Paradas del itinerario</h3><button type="button" class="button small secondary" data-action="add-stop">' + icon('plus', 16) + 'Agregar parada</button></div>'
    + '<div id="edit-stops">' + route.stops.map(stopEditor).join('') + '</div>' + submitButtons('Guardar ruta') + '</form>', { wide: true });
  syncStopEditors();
}

function syncStopEditors() {
  const stops = [...dialog.querySelectorAll('.edit-stop')];
  stops.forEach((stop, index) => {
    stop.querySelector('strong').textContent = (index + 1) + '. Parada';
    stop.querySelector('[data-action="move-up"]').disabled = index === 0;
    stop.querySelector('[data-action="move-down"]').disabled = index === stops.length - 1;
  });
  dialog.querySelector('[data-action="add-stop"]').disabled = stops.length >= 27;
}

function userDialog(user = { name: '', email: '', role: 'student', active: true }) {
  openDialog(user.id ? 'Editar usuario' : 'Nuevo usuario', 'Asigna un rol de acuerdo con el acceso que necesita.',
    '<form data-form="user" data-id="' + (user.id ?? '') + '">'
    + input('Nombre', 'name', user.name, { required: true, max: 120 })
    + input('Correo electrónico', 'email', user.email, { type: 'email', required: true, max: 180 })
    + '<div class="field-row">' + field('Rol', 'role', '<select data-field>' + Object.entries(roleNames).map(([key, label]) => option(key, label, user.role)).join('') + '</select>')
    + field('Estado', 'active', '<select data-field>' + option('true', 'Activo', Boolean(user.active)) + option('false', 'Inactivo', Boolean(user.active)) + '</select>') + '</div>'
    + input(user.id ? 'Nueva contraseña (opcional)' : 'Contraseña (mínimo 12 caracteres)', 'password', '', { type: 'password', required: !user.id, max: 160, autocomplete: 'new-password' })
    + submitButtons('Guardar usuario') + '</form>');
}

function noticeDialog() {
  openDialog('Publicar aviso', 'El mensaje aparecerá en la web y en la app móvil.',
    '<form data-form="notice">' + input('Título', 'title', '', { required: true, max: 100 })
    + '<div class="field-row">' + field('Tipo', 'kind', '<select data-field>' + Object.entries(noticeTypes).map(([kind, [label]]) => option(kind, label, 'general')).join('') + '</select>')
    + field('Ruta', 'routeId', '<select data-field>' + option('', 'Todas las rutas', '')
      + state.routes.map((route) => option(route.id, route.code + ' · ' + route.name, '')).join('') + '</select>') + '</div>'
    + field('Mensaje', 'body', '<textarea data-field required rows="4" maxlength="600"></textarea>') + submitButtons('Publicar') + '</form>');
}

async function installDialog() {
  if (installPrompt) {
    await installPrompt.prompt();
    installPrompt = undefined;
    return;
  }
  openDialog('App móvil', 'Agrega Transporte UPTex a la pantalla de inicio.',
    '<div class="install-guide"><p><strong>Android</strong> · En Chrome, abre el menú y elige «Instalar aplicación» o «Añadir a pantalla principal».</p>'
    + '<p><strong>iPhone</strong> · En Safari, pulsa Compartir y elige «Añadir a pantalla de inicio».</p>'
    + '<p>Abre la dirección HTTPS donde se aloje el proyecto desde tu teléfono.</p></div>');
}

async function confirmTrip(action) {
  const arrival = action === 'arrival';
  openDialog(arrival ? 'Registrar llegada' : 'Registrar salida', escape(activeRoute().name),
    '<form data-form="trip" data-id="' + activeRoute().id + '" data-trip="' + action + '"><p>Se guardará la hora actual de Ciudad de México para este recorrido.</p>'
    + submitButtons(arrival ? 'Guardar llegada' : 'Guardar salida') + '</form>');
}

async function startQrCamera() {
  const video=document.querySelector('#qr-camera');
  if(!video)return;
  if(!('BarcodeDetector' in window)&&!window.jsQR){showFlash('No se cargó el lector QR. Usa el campo manual o revisa tu conexión.',true);return;}
  if(!navigator.mediaDevices?.getUserMedia){showFlash('Este navegador no permite cámara. Usa el campo manual.',true);return;}
  try{
    const detector='BarcodeDetector' in window?new BarcodeDetector({formats:['qr_code']}):null;
    const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
    state.cameraStream=stream;video.srcObject=stream;video.hidden=false;await video.play();
    const scan=async()=>{if(!video.isConnected||video.hidden){stopQrCamera();return;}try{let value;if(detector){const codes=await detector.detect(video);value=codes[0]?.rawValue;}else if(video.videoWidth){const canvas=document.querySelector('#qr-frame'),context=canvas.getContext('2d',{willReadFrequently:true});canvas.width=video.videoWidth;canvas.height=video.videoHeight;context.drawImage(video,0,0,canvas.width,canvas.height);value=window.jsQR(context.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height,{inversionAttempts:'dontInvert'})?.data;}if(value){stopQrCamera();await submitScan(value);return;}}catch{}setTimeout(scan,450);};
    void scan();
  }catch{showFlash('No se pudo abrir la cámara. Revisa el permiso del navegador.',true);}
}

function stopQrCamera(){
  state.cameraStream?.getTracks().forEach(track=>track.stop());state.cameraStream=null;
  const video=document.querySelector('#qr-camera');if(video){video.srcObject=null;video.hidden=true;}
}

async function submitScan(qrToken, action=state.scanAction) {
  const result=await api('driver/scan',{method:'POST',body:{qrToken,action}});
  await refresh();render();
  showFlash(action==='board'?'Abordaje registrado a las '+clock.format(new Date(result.at))+'.':'Bajada registrada a las '+clock.format(new Date(result.at))+'.');
}

function toggleDriverLocation(button) {
  if(state.locationWatchId!==null){navigator.geolocation.clearWatch(state.locationWatchId);state.locationWatchId=null;button.textContent='Compartir ubicación en vivo';showFlash('Se detuvo el envío de ubicación.');return;}
  if(!navigator.geolocation){showFlash('Este dispositivo no ofrece ubicación.',true);return;}
  if(!state.driverData?.assignments?.length){showFlash('Coordinación debe asignarte una ruta activa primero.',true);return;}
  button.disabled=true;
  state.locationWatchId=navigator.geolocation.watchPosition(async position=>{try{await api('driver/location',{method:'POST',body:{lat:position.coords.latitude,lng:position.coords.longitude}});const status=document.querySelector('#location-status');if(status)status.textContent='Ubicación compartida: '+clock.format(new Date())+' · transmisión activa.';}catch(error){showFlash(error.message,true);}},error=>{state.locationWatchId=null;button.disabled=false;showFlash('No se pudo obtener la ubicación. Revisa el permiso del navegador.',true);},{enableHighAccuracy:true,maximumAge:10000,timeout:15000});
  button.disabled=false;button.textContent='Detener ubicación en vivo';showFlash('Ubicación en vivo activada mientras esta pantalla permanezca abierta.');
}

document.addEventListener('submit', async (event) => {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  const errorNode = form.querySelector('.form-error');
  const submit = form.querySelector('[type="submit"]');
  errorNode.hidden = true;
  submit.disabled = true;
  const id = form.dataset.id;
  const method = id ? 'PUT' : 'POST';
  let message;
  const showLoginAfterRegister=form.dataset.form==='register';
  try {
    switch (form.dataset.form) {
      case 'login': {
        const result = await api('login', { method: 'POST', body: data });
        state.user = result.user;
        message = 'Sesión iniciada.';
        break;
      }
      case 'register':
        await api('register',{method:'POST',body:data});message='Cuenta creada. Inicia sesión.';state.registerMode=false;break;
      case 'reservation':
        await api('my/ride',{method:'POST',body:{routeId:Number(data.routeId),stopId:Number(data.stopId)}});message='Ruta y parada reservadas.';break;
      case 'vehicle':
        await api('driver/vehicle',{method:'POST',body:data});message='Unidad registrada.';break;
      case 'scan':
        await submitScan(data.qrToken,form.dataset.scanAction);return;
      case 'route': {
        const stops = [...form.querySelectorAll('.edit-stop')].map((node) => {
          const get = (name) => node.querySelector('[name="' + name + '"]').value;
          return { name: get('stopName'), lat: asNumber(get('lat')), lng: asNumber(get('lng')), time: get('stopTime'), fare: asNumber(get('fare')) };
        });
        await api('admin/routes' + (id ? '/' + id : ''), { method, body: { ...data, driverId: asNumber(data.driverId), stops } });
        message = 'Ruta guardada.';
        break;
      }
      case 'user':
        await api('admin/users' + (id ? '/' + id : ''), { method, body: { ...data, active: data.active === 'true' } });
        if (Number(id) === state.user?.id) state.user = (await api('session')).user;
        message = 'Usuario guardado.';
        break;
      case 'notice':
        await api('admin/notices', { method, body: { ...data, routeId: asNumber(data.routeId) } });
        message = 'Aviso publicado.';
        break;
      case 'trip':
        await api('routes/' + id + '/trip', { method: 'POST', body: { action: form.dataset.trip } });
        message = form.dataset.trip === 'arrival' ? 'Llegada registrada.' : 'Salida registrada.';
        break;
    }
    dialog.close();
    if(showLoginAfterRegister)accountDialog();
    await refresh();
    render();
    showFlash(message);
  } catch (error) {
    if (dialog.open) {
      errorNode.textContent = error.message;
      errorNode.hidden = false;
    } else showFlash(error.message, true);
  } finally {
    submit.disabled = false;
  }
});

document.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action],button[data-map]');
  if (!button || button.disabled) return;
  if (button.dataset.map) {
    state.map?.adjust(button.dataset.map);
    return;
  }
  const { action, tab, email, publish } = button.dataset;
  const id = Number(button.dataset.id);
  const editStop = button.closest('.edit-stop');
  try {
    switch (action) {
      case 'account': accountDialog(); break;
      case 'show-register': state.registerMode=true;accountDialog();break;
      case 'show-login': state.registerMode=false;accountDialog();break;
      case 'close': dialog.close(); break;
      case 'install': await installDialog(); break;
      case 'demo-fill': {
        const form = button.closest('form');
        form.elements.email.value = email;
        form.elements.password.value = 'UPTex-demo-2026';
        form.querySelector('[type="submit"]').focus();
        break;
      }
      case 'logout':
        if(state.locationWatchId!==null){navigator.geolocation.clearWatch(state.locationWatchId);state.locationWatchId=null;}
        await api('logout', { method: 'POST' });
        dialog.close();
        state.user = null;
        await refresh();
        if (state.page === 'gestion') location.hash = '#inicio';
        render();
        showFlash('Sesión cerrada.');
        break;
      case 'select-route':
      case 'view-route':
        if (state.selectedId !== id) {
          state.selectedId = id;
          state.stop = 0;
          renderMapSelection(action === 'view-route');
          if (action === 'select-route') document.querySelector('.route-pill.selected')?.focus({ preventScroll: true });
        } else if (action === 'view-route') {
          document.querySelector('.map-grid').scrollIntoView({ block: 'start', behavior: 'smooth' });
        }
        break;
      case 'stop': updateStop(Number(button.dataset.index)); break;
      case 'map-refresh': await state.map?.refresh(); break;
      case 'trip': await confirmTrip(button.dataset.trip); break;
      case 'scan-mode': state.scanAction=state.scanAction==='board'?'alight':'board';driverPage();break;
      case 'scan-camera': await startQrCamera();break;
      case 'location': toggleDriverLocation(button);break;
      case 'admin-tab':
        state.adminTab = tab;
        adminPage();
        document.querySelector('.admin-tabs [aria-pressed="true"]')?.focus({ preventScroll: true });
        break;
      case 'new-route': routeDialog(); break;
      case 'edit-route': routeDialog(state.admin.routes.find((route) => route.id === id)); break;
      case 'new-user': userDialog(); break;
      case 'edit-user': userDialog(state.admin.users.find((user) => user.id === id)); break;
      case 'new-notice': noticeDialog(); break;
      case 'add-stop':
        dialog.querySelector('#edit-stops').insertAdjacentHTML('beforeend', stopEditor());
        syncStopEditors();
        dialog.querySelector('.edit-stop:last-child input').focus();
        break;
      case 'remove-stop':
        editStop.remove();
        syncStopEditors();
        dialog.querySelector('[data-action="add-stop"]').focus();
        break;
      case 'move-up':
        editStop.previousElementSibling.before(editStop);
        syncStopEditors();
        editStop.querySelector('input').focus({ preventScroll: true });
        break;
      case 'move-down':
        editStop.nextElementSibling.after(editStop);
        syncStopEditors();
        editStop.querySelector('input').focus({ preventScroll: true });
        break;
      case 'toggle-notice':
        button.disabled = true;
        await api('admin/notices/' + id, { method: 'PUT', body: { published: publish === 'true' } });
        await refresh();
        render();
        showFlash(publish === 'true' ? 'Aviso publicado.' : 'Aviso archivado.');
        break;
      case 'read-notice':
        button.disabled = true;
        await api('notices/' + id + '/read', { method: 'POST' });
        await refresh();
        render();
        break;
      case 'reload': await boot(); break;
    }
  } catch (error) {
    button.disabled = false;
    showFlash(error.message, true);
  }
});

document.addEventListener('change', (event) => {
  const { target } = event;
  if (target.matches('[data-traffic]')) {
    state.showTraffic = target.checked;
    state.map?.setTraffic(target.checked);
  }
  if (target.dataset.filter === 'schedule') {
    state.scheduleFilter = target.value;
    schedulePage();
    document.querySelector('[data-filter="schedule"]').focus({ preventScroll: true });
  }
  if (target.dataset.filter === 'notice') {
    state.noticeFilter = target.value;
    noticesPage();
    document.querySelector('[data-filter="notice"]').focus({ preventScroll: true });
  }
  if(target.matches('[data-passenger-route]')){
    const route=(state.ride?.routes??state.routes).find(r=>String(r.id)===target.value);
    target.form.elements.stopId.innerHTML=(route?.stops??[]).map(s=>option(s.id,s.name)).join('');
  }
});

window.addEventListener('hashchange', () => {
  stopQrCamera();
  render();
  window.scrollTo(0, 0);
  main.focus({ preventScroll: true });
  if (state.page === 'avisos') void refreshNotices();
});
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
});
window.addEventListener('online', () => { void boot(); });

let noticeRequest = 0;
async function refreshNotices() {
  if (!state.hasData || document.hidden || dialog.open || !navigator.onLine) return;
  const pending = ++noticeRequest;
  const userId = state.user?.id;
  try {
    const { notices } = await api('notices');
    if (pending !== noticeRequest || userId !== state.user?.id || dialog.open) return;
    if (JSON.stringify(notices) === JSON.stringify(state.notices)) return;
    state.notices = notices;
    renderNav();
    if (state.page === 'avisos') noticesPage();
    if (state.page === 'inicio') document.querySelector('.stats').outerHTML = stats();
  } catch {
    // Keep the last loaded notices when the connection drops.
  }
}
document.addEventListener('visibilitychange', () => { void refreshNotices(); });
setInterval(refreshNotices, 60_000);
setInterval(async()=>{
  if(!state.user||document.hidden||dialog.open||!navigator.onLine)return;
  try{await refresh();if(state.page==='gestion'||state.page==='chofer'||state.page==='mi-viaje')render();}catch{}
},20000);

async function boot() {
  main.setAttribute('aria-busy', 'true');
  const [config, session] = await Promise.allSettled([api('config'), api('session')]);
  if (config.status === 'fulfilled') state.config = config.value;
  state.user = session.status === 'fulfilled' ? session.value.user : null;
  try {
    await refresh();
  } catch (error) {
    if (state.hasData) showFlash(error.message, true);
  }
  render();
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        fetch('/api/catalog').catch(() => {});
      }, { once: true });
    }
  }).catch((error) => console.warn('No se pudo iniciar la app sin conexión:', error.message));
}
void boot();


