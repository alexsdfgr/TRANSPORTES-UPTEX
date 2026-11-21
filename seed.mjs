const campus = ['Campus UPTex', 19.45081, -98.89931];

const definitions = [
  {
    code: 'R01', name: 'Tepetlaoxtoc', zone: 'Zona noreste', color: 'blue',
    departure: '06:10', arrival: '07:00',
    notes: 'El folleto indica salida del centro a las 06:10 y lista la parada Tepetlaoxtoc a las 06:15.',
    stops: [
      ['Tepetlaoxtoc', 19.57249, -98.81854, '06:15', 20],
      ['Puente San Juan Tezontla', 19.54990, -98.83080, '06:23', 20],
      ['Purificación · Fábricas', 19.53262, -98.83494, '06:28', 20],
      ['Glorieta Xocotlán', 19.52270, -98.85710, '06:32', 20],
      ['Cruce Nativitas · San Sebastián', 19.51152, -98.86148, '06:34', 20],
      ['Cruce Tequexquináhuac · ISSSTE', 19.49889, -98.85685, '06:38', 14],
      ['Comex · San Nicolás Huexotla', 19.48293, -98.87050, '06:42', 14],
      ['Chapingo', 19.48841, -98.89261, '06:44', 14],
      [...campus, '07:00'],
    ],
  },
  {
    code: 'R02', name: 'Tepetitlán', zone: 'Zona norte', color: 'teal',
    departure: '06:10', arrival: '07:00',
    notes: 'El folleto indica espera de cinco minutos en Gasolinera Chiautla, con salida de esa parada a las 06:20.',
    stops: [
      ['Tepetitlán · Chiautla', 19.57900, -98.87920, '06:10', 20],
      ['Gasolinera Chiautla', 19.55260, -98.87958, '06:15', 20],
      ['Tulantongo', 19.53295, -98.89210, '06:25', 20],
      ['Estatua Nezahualcóyotl', 19.51824, -98.88676, '06:29', 14],
      ['Asegurada · Calle Josefa Ortiz', 19.50948, -98.88422, '06:33', 14],
      ['Instituto Hidalgo · Calle Silverio', 19.50532, -98.88254, '06:37', 14],
      ['Farmacias · Calle Noche Buena', 19.49841, -98.88712, '06:40', 14],
      ['EPT', 19.49502, -98.89028, '06:42', 14],
      ['Chapingo', 19.48841, -98.89261, '06:45', 14],
      [...campus, '07:00', 14],
    ],
  },
  {
    code: 'R03', name: 'Geo–Ara–Beta', zone: 'Zona sur', color: 'orange',
    departure: '06:25', arrival: null,
    notes: 'El folleto indica salida desde Geo y tarifa general de $14. La referencia de algunas intersecciones aparece abreviada.',
    stops: [
      ['Calle Arpa · Maya Geo', 19.40800, -98.91020, '06:25', 14],
      ['Laguna de Chautengo', 19.41022, -98.91440, null, 14],
      ['Módulo Geo', 19.41290, -98.91650, null, 14],
      ['Torre Reloj Solar', 19.41650, -98.91542, null, 14],
      ['Av. San José · Blvd. Real M.', 19.41850, -98.91714, null, 14],
      ['Av. San José · Av. Real del…', 19.42105, -98.91805, null, 14],
      ['Av. San José · Av. San Carl…', 19.42362, -98.91918, null, 14],
      ['Av. San José · Av. San Martín', 19.42588, -98.92045, null, 14],
      ['Av. San José · Av. Real San Vicente', 19.42733, -98.92208, null, 14],
      ['Av. San José · Camino a la Hacienda', 19.42920, -98.92300, null, 14],
      ['Av. San José · Av. Real de Guadalupe', 19.43085, -98.92440, null, 14],
      ['Av. Monterrey', 19.43460, -98.93040, null, 14],
      ['Av. Monterrey · Blvd. Super Nova', 19.43790, -98.93320, null, 14],
      ['Super Nova Urano', 19.44060, -98.93410, null, 14],
      ['Av. Río Manzano', 19.44380, -98.93000, null, 14],
      ['Carretera Federal México–Texcoco', 19.44307, -98.91795, null, 14],
      [...campus, null, 14],
    ],
  },
];

export const initialRoutes = definitions.map((route) => ({
  ...route, status: 'active', driverId: null,
  stops: route.stops.map(([name, lat, lng, time = null, fare = null]) => ({ name, lat, lng, time, fare })),
}));

initialRoutes.push({
  code: 'R04', name: 'Cuarta ruta', zone: '', color: 'purple', status: 'draft',
  departure: null, arrival: null, notes: 'Pendiente de confirmar con la coordinación de transporte.',
  driverId: null, stops: [],
});
