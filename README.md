# Transporte UPTex

Aplicación para consultar y administrar las rutas universitarias hacia la Universidad Politécnica de Texcoco. Incluye un panel web y una app móvil instalable (PWA). Las dos usan la misma API REST y base de datos SQLite. El nuevo logotipo institucional se usa también como ícono de la aplicación.

## Arranque local

Requiere Node.js 24 o posterior. Instala las dependencias antes del primer arranque.

~~~powershell
npm ci
npm start
~~~

Abre [Transporte UPTex](http://127.0.0.1:3000/). En **Iniciar sesión**, elige una de las cuentas de demostración y pulsa **Entrar**. Si ejecutas Node.js con una ruta absoluta, usa los mismos argumentos del script de inicio.

~~~powershell
node --env-file-if-exists=.env server.mjs
~~~

| Cuenta | Flujo de demostración |
| --- | --- |
| Coordinación | Editar y publicar rutas, ordenar paradas, asignar choferes, consultar unidades, ubicar choferes activos y revisar abordajes y bajadas. |
| Chofer | Registrar su unidad, consultar la ruta asignada, compartir ubicación en vivo y escanear el QR al subir y al bajar pasajeros. |
| Alumno o profesor | Crear cuenta e iniciar sesión, reservar ruta y parada, mostrar su QR personal y consultar unidad y horas de abordaje y bajada. |
| Visitante | Consultar recorridos y avisos públicos. |

El QR contiene un token aleatorio. La reservación es diaria y coordinación asigna un chofer a la ruta. Para escanear con cámara y compartir ubicación, abre el sitio con HTTPS y concede los permisos del navegador. Para iniciar un turno, el chofer registra primero sus placas y el aforo de su unidad. El lector usa `BarcodeDetector` o la biblioteca local jsQR y ofrece captura manual.

## Configurar Google Maps

1. En tu proyecto de Google Cloud, habilita la facturación, **Maps JavaScript API** y **Routes API**. Crea una clave para sitios web, limítala a esas API y autoriza los orígenes desde los cuales abrirás UPTex, por ejemplo **http://127.0.0.1:3000/\*** para la demo y el dominio HTTPS de operación.
2. Copia **.env.example** a **.env**. Coloca la clave en **GOOGLE_MAPS_BROWSER_KEY**. Para operación, configura también **GOOGLE_MAPS_MAP_ID** con un ID de mapa JavaScript propio. La demo usa **DEMO_MAP_ID** si dejas ese valor vacío.
3. Reinicia el servidor. Selecciona una ruta y activa **Tráfico** para mostrar la capa vial. El itinerario muestra la distancia y el tiempo estimado con tráfico cuando Google devuelve esos valores. **Actualizar** pide un nuevo cálculo.

La clave configurada es de navegador y se envía al cliente. Mantenla restringida por origen y por API. Sin clave o si falla el servicio, la pantalla usa el mapa esquemático y conserva los horarios publicados. [Configuración de claves](https://developers.google.com/maps/api-security-best-practices) · [Biblioteca Routes](https://developers.google.com/maps/documentation/javascript/routes/overview) · [Marcadores y Map ID](https://developers.google.com/maps/documentation/javascript/advanced-markers/start)

## Instalar la app móvil

Sirve el proyecto con HTTPS y abre la dirección en el teléfono. En Android, usa **Instalar aplicación** desde Chrome. En iPhone, en Safari, usa **Compartir → Añadir a pantalla de inicio**. Después del primer acceso en línea, la PWA conserva el pase del alumno en ese dispositivo y lo borra al cerrar sesión. Abordar, reservar, consultar el historial y refrescar el rastreo requieren conexión.

Activa **Alerta de proximidad** desde **Rastreo**. El aviso se genera al quedar hasta cinco minutos estimados o dos paradas para el abordaje. En iPhone se habilita desde la PWA instalada. Railway provee el dominio público que usa el servidor para Web Push. En otros entornos HTTPS, configura `WEB_PUSH_SUBJECT` con una URL pública propia o un `mailto:` de contacto. Las claves de Web Push se generan una vez y se guardan en SQLite.

## Docker y operación

Para una demo local con Docker, copia **.env.example** a **.env** y ejecuta:

~~~powershell
docker compose up --build -d
docker compose ps
~~~

El servicio escucha en **127.0.0.1:3000** en el equipo anfitrión y guarda SQLite en el volumen **uptex-data**. Para uso desde otros dispositivos, publica el servicio mediante un proxy HTTPS y configura el dominio en Google Cloud. Antes del primer arranque de operación, usa **DEMO_MODE=0**, **SECURE_COOKIES=1**, **ADMIN_EMAIL** y **ADMIN_PASSWORD** con una contraseña propia de al menos 12 caracteres. La configuración usa bases distintas para demo y operación, y el primer arranque de operación crea solamente la cuenta de coordinación. Configura y confirma las ubicaciones iniciales antes de usar las rutas con viajeros.

~~~powershell
docker compose down
~~~

Este comando conserva los datos. Para cambiar el puerto anfitrión, define **UPTEX_PORT** y actualiza el origen permitido para la clave.

## Despliegue desde GitHub en Railway

1. Crea un proyecto en Railway, conecta el repositorio de GitHub y selecciona la rama **main**. Railway detecta el **Dockerfile** de la raíz.
2. Agrega un volumen montado en **/app/data** para conservar SQLite. Configura **RAILWAY_RUN_UID=0** para el volumen montado como root de Railway, ya que el Dockerfile usa por defecto el usuario **node**.
3. En **Variables**, agrega **HOST=0.0.0.0**, **PORT=3000**, **DEMO_MODE=0** y **SECURE_COOKIES=1**. Define **ADMIN_EMAIL** y **ADMIN_PASSWORD** con una contraseña propia de al menos 12 caracteres antes del primer arranque.
4. En **Settings → Networking → Public Networking**, genera un dominio con puerto de destino **3000**. Railway proporciona HTTPS. Abre **/api/health** en ese dominio y comprueba que responde **{"status":"ok"}**.
5. Autoriza el dominio HTTPS en la clave de navegador de Google Maps y agrega **GOOGLE_MAPS_BROWSER_KEY** y **GOOGLE_MAPS_MAP_ID** a las variables de Railway. Después del despliegue, comprueba el trazado y entra a **Iniciar sesión** con la cuenta de coordinación.

Desde el teléfono, abre el mismo dominio HTTPS para instalar la PWA. Confirma las coordenadas de las paradas antes de usar el servicio. El chofer debe mantener visible la app para transmitir su ubicación. El radar conserva el turno y el manifiesto cuando se pierde señal, y quita del mapa las posiciones con más de un minuto de antigüedad. El ETA es aproximado y usa GPS y las paradas publicadas.

Al actualizar una instalación anterior a las vistas por rol, el primer arranque crea y comprueba una copia de SQLite dentro del volumen, en un directorio `.uptex-previo-*`. El servicio empieza a recibir tráfico después de esa comprobación y de aplicar la migración.

[Servicios y GitHub](https://docs.railway.com/services) · [Volúmenes y permisos](https://docs.railway.com/volumes) · [Dominio HTTPS](https://docs.railway.com/networking/public-networking)

## Pruebas y documentación

~~~powershell
npm test
~~~

- [Memoria técnica, rúbrica y guion de demostración](docs/memoria-tecnica.md)
- [Flujo de integración continua para GitHub](.github/workflows/ci.yml)

