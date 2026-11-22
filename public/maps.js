import { icon } from './icons.js';

export const routeColors = { blue: '#2b63f6', teal: '#078b83', orange: '#e68024', purple: '#8355cf' };
const campus = [19.45081, -98.89931];
const places = [
  ['TEPETITLÁN', 19.589, -98.904, 10], ['TEPETLAOXTOC', 19.582, -98.798, 10],
  ['Atenco', 19.558, -98.933, 10], ['Chiautla', 19.551, -98.866, 10],
  ['San Juan Tezontla', 19.551, -98.811, 10], ['La Purificación', 19.525, -98.805, 10],
  ['TEXCOCO DE MORA', 19.516, -98.913, 12], ['Nativitas', 19.510, -98.839, 10],
  ['Chapingo', 19.483, -98.916, 10], ['San Bernardino', 19.469, -98.927, 10],
  ['San Miguel Coatlinchán', 19.460, -98.858, 10], ['CHICOLOAPAN', 19.415, -98.952, 11],
  ['Maya Geo', 19.399, -98.910, 10], ['Río Manzano', 19.438, -98.969, 10],
];
const localities = [
  [19.516, -98.892, .038, .030, .12], [19.553, -98.918, .025, .022, -.1],
  [19.563, -98.88, .015, .032, .4], [19.574, -98.819, .024, .018, .18],
  [19.498, -98.852, .025, .030, -.28], [19.450, -98.875, .023, .023, .1],
  [19.43, -98.936, .030, .025, -.13], [19.414, -98.912, .022, .023, -.08],
  [19.467, -98.916, .017, .017, -.2], [19.536, -98.835, .020, .023, .1],
  [19.452, -98.955, .034, .032, -.1], [19.505, -98.969, .034, .026, -.2],
];
const highways = [
  { label: 'MEX 136', at: [19.469, -98.912], path: [[19.381,-98.975],[19.411,-98.949],[19.433,-98.935],[19.446,-98.911],campus,[19.473,-98.903],[19.494,-98.895],[19.515,-98.885],[19.533,-98.859],[19.550,-98.839],[19.574,-98.821],[19.607,-98.786]] },
  { label: 'MEX 5D', at: [19.433, -98.872], path: [[19.475,-99.045],[19.478,-99.002],[19.474,-98.97],[19.455,-98.944],[19.446,-98.914],[19.434,-98.884],[19.431,-98.854],[19.441,-98.824],[19.459,-98.796],[19.482,-98.762]] },
  { label: 'MEX 136D', at: [19.51, -98.965], path: [[19.489,-99.04],[19.496,-99.006],[19.503,-98.98],[19.511,-98.952],[19.52,-98.914],[19.527,-98.894],[19.541,-98.877],[19.575,-98.868],[19.613,-98.861]] },
  { path: [[19.595,-98.98],[19.57,-98.965],[19.552,-98.931],[19.551,-98.908],[19.54,-98.888],[19.521,-98.883],[19.506,-98.865],[19.492,-98.854],[19.478,-98.853],[19.447,-98.853],[19.41,-98.868]] },
  { path: [[19.577,-98.771],[19.553,-98.799],[19.524,-98.827],[19.505,-98.832],[19.481,-98.841],[19.466,-98.875],[19.451,-98.9],[19.444,-98.929],[19.424,-98.95],[19.405,-98.961]] },
  { path: [[19.395,-98.929],[19.420,-98.913],[19.449,-98.917],[19.470,-98.91],[19.488,-98.893],[19.503,-98.887],[19.528,-98.896],[19.55,-98.891],[19.582,-98.882],[19.603,-98.891]] },
];
const greens = [
  [[19.616,-98.806],[19.608,-98.756],[19.56,-98.739],[19.533,-98.756],[19.516,-98.754],[19.499,-98.768],[19.526,-98.804],[19.546,-98.798],[19.565,-98.808],[19.588,-98.798]],
  [[19.516,-98.806],[19.502,-98.776],[19.465,-98.758],[19.445,-98.769],[19.444,-98.81],[19.465,-98.83],[19.483,-98.805],[19.506,-98.824]],
  [[19.566,-99.02],[19.558,-98.985],[19.536,-98.967],[19.517,-98.973],[19.5,-98.986],[19.511,-99.025]],
  [[19.49,-98.911],[19.484,-98.898],[19.477,-98.899],[19.479,-98.922],[19.486,-98.926]],
  [[19.44,-98.859],[19.418,-98.852],[19.39,-98.861],[19.395,-98.826],[19.428,-98.821]],
];

let googleLoad;
function googleMaps(key) {
  if (!googleLoad) {
    googleLoad = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const url = new URL('https://maps.googleapis.com/maps/api/js');
      url.search = new URLSearchParams({ key, v: 'weekly', loading: 'async', language: 'es', region: 'MX', callback: 'uptexGoogleMapsReady' });
      const timeout = setTimeout(() => fail(new Error('Tiempo de espera agotado.')), 14000);
      function fail(error) {
        clearTimeout(timeout);
        script.remove();
        window.uptexGoogleMapsReady = () => {};
        reject(error);
      }
      window.uptexGoogleMapsReady = () => {
        clearTimeout(timeout);
        resolve(window.google.maps);
      };
      window.gm_authFailure = () => fail(new Error('Google rechazó la configuración.'));
      script.onerror = () => fail(new Error('No se pudo cargar Google Maps.'));
      script.async = true;
      script.src = url;
      document.head.append(script);
    }).catch((error) => {
      googleLoad = undefined;
      throw error;
    });
  }
  return googleLoad;
}

export function mapsLink(stop) {
  const query = new URLSearchParams({ api: '1', query: stop.lat + ',' + stop.lng });
  return 'https://www.google.com/maps/search/?' + query;
}

export class RouteMap {
  constructor(element, config, { onStop, onEstimate, onStatus, onUnit, live = false }) {
    this.element = element;
    this.config = config;
    this.onStop = onStop;
    this.onEstimate = onEstimate;
    this.onStatus = onStatus;
    this.onUnit = onUnit;
    this.live = live;
    this.canvas = element.querySelector('canvas');
    this.layer = element.querySelector('.google-map');
    this.unitLayer = element.querySelector('.map-units');
    this.units = [];
    this.unitPins = new Map();
    this.focused = 0;
    this.zoom = 1;
    this.offset = [0, 0];
    this.traffic = false;
    this.version = 0;
    this.resize = new ResizeObserver(() => this.draw());
    this.resize.observe(this.canvas);
    this.canvas.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      this.drag = { x: event.clientX, y: event.clientY, offset: [...this.offset], changed: false };
      this.canvas.setPointerCapture(event.pointerId);
    });
    this.canvas.addEventListener('pointermove', (event) => {
      if (!this.drag) return;
      const dx = event.clientX - this.drag.x;
      const dy = event.clientY - this.drag.y;
      this.drag.changed ||= Math.abs(dx) + Math.abs(dy) > 5;
      if (!this.drag.changed) return;
      this.offset = [this.drag.offset[0] + dx, this.drag.offset[1] + dy];
      this.draw();
    });
    this.canvas.addEventListener('pointercancel', () => { this.drag = null; });
    this.canvas.addEventListener('pointerup', (event) => {
      if (this.drag && !this.drag.changed && this.project && this.route) {
        const rect = this.canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        let best = 15;
        let index = -1;
        this.route.stops.forEach((stop, candidate) => {
          const [px, py] = this.project([stop.lat, stop.lng]);
          const distance = Math.hypot(px - x, py - y);
          if (distance < best) [best, index] = [distance, candidate];
        });
        if (index >= 0) this.onStop(index);
      }
      this.drag = null;
    });
  }

  destroy() {
    this.version++;
    this.resize.disconnect();
    this.clearGoogle();
  }

  clearGoogle() {
    this.polylines?.forEach((line) => line.setMap(null));
    this.markers?.forEach((marker) => { marker.map = null; });
    this.trafficLayer?.setMap(null);
    this.polylines = [];
    this.markers = [];
    this.unitPins.forEach((pin) => {
      if (pin.marker) pin.marker.map = null;
      pin.element.remove();
    });
    this.unitPins.clear();
  }

  setUnits(units, selectedId) {
    this.units = units.filter((unit) => unit.location);
    this.selectedUnit = selectedId;
    this.draw();
  }

  placeUnits() {
    if (!this.unitLayer || !this.project) return;
    const onGoogle = !this.layer.hidden && this.liveMarker;
    this.unitLayer.hidden = Boolean(onGoogle);
    for (const [id, pin] of this.unitPins) {
      if (this.units.some((unit) => unit.tripId === id) && Boolean(pin.marker) === Boolean(onGoogle)) continue;
      if (pin.marker) pin.marker.map = null;
      pin.element.remove();
      this.unitPins.delete(id);
    }
    for (const { tripId, color, code, location, vehicle } of this.units) {
      const { lat, lng } = location;
      let pin = this.unitPins.get(tripId);
      if (!pin) {
        const element = document.createElement(this.onUnit && !onGoogle ? 'button' : 'span');
        element.className = 'map-unit';
        element.innerHTML = icon('bus', 18);
        element.title = code + ' · ' + vehicle;
        element.setAttribute('aria-label', element.title);
        element.style.setProperty('--route-color', routeColors[color]);
        if (onGoogle) {
          const marker = new this.liveMarker({ map: this.map, position: { lat, lng }, title: element.title, gmpClickable: Boolean(this.onUnit) });
          marker.append(element);
          if (this.onUnit) marker.addEventListener('gmp-click', () => this.onUnit(tripId));
          pin = { element, marker };
        } else {
          if (this.onUnit) element.addEventListener('click', () => this.onUnit(tripId));
          this.unitLayer.append(element);
          pin = { element };
        }
        this.unitPins.set(tripId, pin);
      }
      const selected = this.selectedUnit === tripId;
      pin.element.classList.toggle('selected', selected);
      if (pin.marker) {
        pin.marker.position = { lat, lng };
        pin.marker.zIndex = selected ? 120 : 80;
      } else {
        const [x, y] = this.project([lat, lng]);
        pin.element.style.left = x + 'px';
        pin.element.style.top = y + 'px';
      }
    }
  }

  show(routes, selected, index = 0) {
    this.routes = routes;
    this.route = selected;
    this.focused = index;
    this.zoom = 1;
    this.offset = [0, 0];
    this.draw();
    this.refresh();
  }

  focus(index) {
    this.focused = index;
    this.draw();
    if (this.google && !this.layer.hidden && this.markers?.[index]) {
      this.map.panTo(this.markers[index].position);
      this.markers.forEach((marker, i) => { marker.zIndex = i === index ? 100 : i; });
    }
  }

  adjust(action) {
    if (this.google && !this.layer.hidden) {
      if (action === 'center' && this.bounds) this.map.fitBounds(this.bounds, 56);
      if (action === 'plus') this.map.setZoom(Math.min(20, (this.map.getZoom() ?? 12) + 1));
      if (action === 'minus') this.map.setZoom(Math.max(3, (this.map.getZoom() ?? 12) - 1));
      return;
    }
    if (action === 'center') {
      this.zoom = 1;
      this.offset = [0, 0];
    } else {
      this.zoom = Math.min(4, Math.max(.65, this.zoom * (action === 'plus' ? 1.25 : .8)));
    }
    this.draw();
  }

  setTraffic(checked) {
    this.traffic = checked;
    if (this.trafficLayer) this.trafficLayer.setMap(checked && !this.layer.hidden ? this.map : null);
  }

  async refresh() {
    const key = this.config.browserKey;
    const route = this.route;
    const version = ++this.version;
    this.clearGoogle();
    this.layer.hidden = true;
    this.onEstimate(null);
    if (this.live) return this.refreshLive(version, key);
    if (!key || !route || route.stops.length < 2) {
      this.onStatus(key ? 'reference' : 'demo');
      return;
    }
    this.onStatus('loading');
    try {
      this.google = await googleMaps(key);
      const [{ Map, TrafficLayer }, { Route }, { AdvancedMarkerElement }, { LatLngBounds }] = await Promise.all([
        this.google.importLibrary('maps'),
        this.google.importLibrary('routes'),
        this.google.importLibrary('marker'),
        this.google.importLibrary('core'),
      ]);
      if (version !== this.version) return;
      const stops = route.stops.map(({ lat, lng }) => ({ lat, lng }));
      const { routes } = await Route.computeRoutes({
        origin: stops[0],
        destination: stops.at(-1),
        intermediates: stops.slice(1, -1).map((location) => ({ location })),
        travelMode: 'DRIVING',
        routingPreference: 'TRAFFIC_AWARE',
        fields: ['path', 'distanceMeters', 'durationMillis', 'staticDurationMillis'],
      });
      if (version !== this.version) return;
      if (!routes?.[0]?.path?.length) throw new Error('No se encontró un recorrido.');
      this.layer.hidden = false;
      this.map ??= new Map(this.layer, {
        center: stops[0], zoom: 12, mapId: this.config.mapId || 'DEMO_MAP_ID',
        disableDefaultUI: true, clickableIcons: false, gestureHandling: 'cooperative',
      });
      const computed = routes[0];
      this.polylines = computed.createPolylines({
        polylineOptions: { strokeColor: routeColors[route.color], strokeWeight: 6, strokeOpacity: .95 },
      });
      this.polylines.forEach((line) => line.setMap(this.map));
      this.markers = stops.map((position, index) => {
        const pin = document.createElement('span');
        pin.className = 'google-stop' + (index === stops.length - 1 ? ' terminal' : '');
        pin.style.setProperty('--route-color', routeColors[route.color]);
        pin.textContent = index === stops.length - 1 ? 'U' : String(index + 1);
        const marker = new AdvancedMarkerElement({ map: this.map, position, title: route.stops[index].name, gmpClickable: true });
        marker.append(pin);
        marker.addEventListener('gmp-click', () => this.onStop(index));
        return marker;
      });
      this.bounds = new LatLngBounds();
      computed.path.forEach((point) => this.bounds.extend({ lat: point.lat, lng: point.lng }));
      stops.forEach((stop) => this.bounds.extend(stop));
      this.map.fitBounds(this.bounds, 56);
      this.trafficLayer ??= new TrafficLayer();
      this.setTraffic(this.traffic);
      this.onStatus('google');
      this.onEstimate({
        distance: computed.distanceMeters,
        duration: computed.durationMillis,
        staticDuration: computed.staticDurationMillis,
      });
    } catch (error) {
      if (version !== this.version) return;
      console.warn('Google Maps UPTex:', error.message);
      this.clearGoogle();
      this.layer.hidden = true;
      this.onStatus('error');
    }
  }

  async refreshLive(version, key) {
    const stops = this.routes.flatMap((route) => route.stops);
    if (!key || !stops.length) {
      this.onStatus('reference');
      this.placeUnits();
      return;
    }
    try {
      this.google = await googleMaps(key);
      const [{ Map, Polyline }, { AdvancedMarkerElement }, { LatLngBounds }] = await Promise.all([
        this.google.importLibrary('maps'), this.google.importLibrary('marker'), this.google.importLibrary('core'),
      ]);
      if (version !== this.version) return;
      this.layer.hidden = false;
      this.map ??= new Map(this.layer, {
        center: stops[0], zoom: 12, mapId: this.config.mapId || 'DEMO_MAP_ID',
        disableDefaultUI: true, clickableIcons: false, gestureHandling: 'cooperative',
      });
      this.bounds = new LatLngBounds();
      stops.forEach((stop) => this.bounds.extend(stop));
      this.units.forEach((unit) => this.bounds.extend(unit.location));
      this.map.fitBounds(this.bounds, 38);
      this.polylines = this.routes.filter((route) => route.stops.length > 1).map((route) => new Polyline({
        path: route.stops, map: this.map, strokeColor: routeColors[route.color], strokeOpacity: .55, strokeWeight: 4,
      }));
      const stop = this.route?.stops[this.focused];
      if (stop) {
        const pin = document.createElement('span');
        pin.className = 'google-stop';
        pin.style.setProperty('--route-color', routeColors[this.route.color]);
        pin.textContent = String(this.focused + 1);
        const marker = new AdvancedMarkerElement({ map: this.map, position: stop, title: stop.name });
        marker.append(pin);
        this.markers = [marker];
      }
      this.liveMarker = AdvancedMarkerElement;
      this.placeUnits();
      this.onStatus('google');
    } catch (error) {
      if (version !== this.version) return;
      this.clearGoogle();
      this.layer.hidden = true;
      this.placeUnits();
      this.onStatus('reference');
      console.warn('Mapa de seguimiento UPTex:', error.message);
    }
  }

  draw() {
    if (!this.routes) return;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (!width || !height) return;
    const ratio = window.devicePixelRatio || 1;
    this.canvas.width = width * ratio;
    this.canvas.height = height * ratio;
    const ctx = this.canvas.getContext('2d');
    ctx.scale(ratio, ratio);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const allStops = this.routes.flatMap((route) => route.stops);
    if (this.live) allStops.push(...this.units.map((unit) => unit.location));
    const minLat = Math.min(19.397, ...allStops.map((stop) => stop.lat));
    const maxLat = Math.max(19.590, ...allStops.map((stop) => stop.lat));
    const minLng = Math.min(-98.955, ...allStops.map((stop) => stop.lng));
    const maxLng = Math.max(-98.795, ...allStops.map((stop) => stop.lng));
    const scaleY = (height - 68) / (maxLat - minLat) * this.zoom;
    const scaleX = Math.min(scaleY * 1.23, (width - 52) / (maxLng - minLng) * this.zoom);
    const center = [(minLat + maxLat) / 2, (minLng + maxLng) / 2];
    const project = ([lat, lng]) => [
      width * .5 + (lng - center[1]) * scaleX + this.offset[0],
      height * .49 + (center[0] - lat) * scaleY + this.offset[1],
    ];
    this.project = project;
    this.placeUnits();
    const path = (points) => {
      ctx.beginPath();
      points.forEach((point, i) => {
        const [x, y] = project(point);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
    };
    const stroke = (points, color, lineWidth) => {
      path(points);
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    };
    const fill = (points, color) => {
      path(points);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    };
    ctx.fillStyle = '#edf0e8';
    ctx.fillRect(0, 0, width, height);
    greens.forEach((points, index) => fill(points, index % 2 ? '#dfe9d9' : '#d9e7d5'));
    fill([[19.54,-99.01],[19.548,-98.995],[19.543,-98.98],[19.528,-98.974],[19.516,-98.979],[19.511,-98.994],[19.522,-99.015]], '#cee3e7');
    for (let i = 0; i < 7; i++) {
      stroke([[19.63 - i*.007,-98.78],[19.56-i*.009,-98.765],[19.505-i*.006,-98.793],[19.453-i*.008,-98.79]], '#d1dfce', .7);
    }
    for (const [lat, lng, sizeX, sizeY, angle] of localities) {
      const at = (x, y) => [lat + y * Math.cos(angle) - x * Math.sin(angle), lng + x * Math.cos(angle) + y * Math.sin(angle)];
      fill([at(-.54*sizeX,-.45*sizeY),at(.45*sizeX,-.52*sizeY),at(.51*sizeX,.21*sizeY),at(.25*sizeX,.50*sizeY),at(-.48*sizeX,.43*sizeY)], '#e8ebe5');
      for (let i = -5; i <= 5; i++) {
        const x = i * sizeX / 12;
        const y = i * sizeY / 12;
        stroke([at(x,-sizeY*(.42+(.03*(i%3)))),at(x+sizeX*.04,0),at(x-sizeX*.018,sizeY*.45)], '#fafbf8', i % 3 ? .75 : 1.4);
        stroke([at(-sizeX*.45,y),at(0,y-sizeY*.02),at(sizeX*.46,y+sizeY*.04)], '#fafbf8', i % 4 ? .8 : 1.4);
      }
    }

    highways.forEach(({ path: points, label }) => {
      stroke(points, label ? '#d9d4bf' : '#dce0d5', label ? 5 : 3);
      stroke(points, label ? '#fff7df' : '#fcfcf8', label ? 3.3 : 2);
    });
    stroke([[19.585,-98.968],[19.566,-98.958],[19.547,-98.941],[19.519,-98.932],[19.497,-98.929],[19.476,-98.92]], '#c1dde6', 1.3);
    stroke([[19.438,-98.98],[19.44,-98.962],[19.445,-98.945],[19.44,-98.924],[19.441,-98.906],[19.449,-98.891]], '#c4e0e7', 1.2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [label, lat, lng, size] of places) {
      const [x, y] = project([lat, lng]);
      ctx.font = (label === label.toUpperCase() ? '720 ' : '550 ') + size + 'px system-ui';
      ctx.strokeStyle = '#f3f5ee';
      ctx.lineWidth = 3;
      ctx.strokeText(label, x, y);
      ctx.fillStyle = '#65766d';
      ctx.fillText(label, x, y);
    }
    for (const road of highways.filter((item) => item.label)) {
      const [x, y] = project(road.at);
      ctx.font = '650 8px system-ui';
      ctx.fillStyle = '#fff9e9';
      ctx.strokeStyle = '#d7cdb1';
      ctx.lineWidth = .8;
      ctx.beginPath();
      ctx.roundRect(x-23, y-8, 46, 15, 3);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#8a7851';
      ctx.fillText(road.label, x, y);
    }
    const routes = [...this.routes.filter((route) => route.id !== this.route?.id), ...(this.route ? [this.route] : [])];
    for (const route of routes) {
      if (!route.stops.length) continue;
      const points = route.stops.map((stop) => [stop.lat, stop.lng]);
      const selected = route.id === this.route?.id;
      const color = routeColors[route.color];
      ctx.globalAlpha = selected ? 1 : .76;
      stroke(points, '#fff', selected ? 8 : 6);
      stroke(points, color, selected ? 4.8 : 3.2);
      for (const [index, point] of points.entries()) {
        if (index === points.length - 1) continue;
        const [x, y] = project(point);
        const emphasized = selected && this.focused === index;
        ctx.beginPath();
        ctx.arc(x, y, emphasized ? 9 : index === 0 ? 6.5 : 3.2, 0, Math.PI * 2);
        ctx.fillStyle = emphasized || index === 0 ? color : '#fff';
        ctx.fill();
        ctx.lineWidth = emphasized || index === 0 ? 2.5 : 1.65;
        ctx.strokeStyle = emphasized || index === 0 ? '#fff' : color;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    const terminal = this.route?.stops.at(-1);
    if (!terminal) return;
    const [x, y] = project([terminal.lat, terminal.lng]);
    ctx.shadowColor = '#142c4250';
    ctx.shadowBlur = 13;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = '#122848';
    ctx.beginPath();
    ctx.roundRect(x - 13, y - 15, 26, 27, 7);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.font = '800 12px system-ui';
    ctx.fillStyle = 'white';
    ctx.fillText('U', x, y - 1);
    ctx.fillStyle = 'white';
    ctx.font = '750 10px system-ui';
    const label = terminal.name;
    const labelWidth = Math.min(165, ctx.measureText(label).width + 14);
    ctx.beginPath();
    ctx.roundRect(x + 18, y - 13, labelWidth, 22, 5);
    ctx.fill();
    ctx.fillStyle = '#142d48';
    ctx.fillText(label, x + 18 + labelWidth/2, y - 2, labelWidth - 10);
  }
}

export function mapControls() {
  return '<div class="map-mode" id="map-mode">' + icon('layers', 15) + '<span>Mapa de referencia</span></div>'
    + '<div class="map-controls"><button type="button" title="Acercar" aria-label="Acercar" data-map="plus">' + icon('plus', 17) + '</button>'
    + '<button type="button" title="Alejar" aria-label="Alejar" data-map="minus">' + icon('minus', 17) + '</button>'
    + '<button type="button" title="Centrar mapa" aria-label="Centrar mapa" data-map="center">' + icon('target', 17) + '</button></div>';
}
