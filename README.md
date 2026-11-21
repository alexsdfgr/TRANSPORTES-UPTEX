# Transporte UPTex

Aplicación para consultar y administrar las rutas universitarias hacia la Universidad Politécnica de Texcoco. Incluye un panel web y una app móvil instalable (PWA). Las dos usan la misma API REST y base de datos SQLite.

## Arranque local

Requiere Node.js 24 o posterior. El proyecto no requiere instalar paquetes de npm.

~~~powershell
npm start
~~~

Abre [Transporte UPTex](http://127.0.0.1:3000/). En **Iniciar sesión**, elige una de las cuentas de demostración y pulsa **Entrar**. Si ejecutas Node.js con una ruta absoluta, usa los mismos argumentos del script de inicio.

~~~powershell
node --env-file-if-exists=.env server.mjs
~~~

| Cuenta | Flujo de demostración |
| --- | --- |
| Coordinación | Editar y publicar rutas, ordenar paradas, asignar choferes, administrar usuarios y administrar avisos. |
| Chofer | Registrar salida y llegada de su ruta asignada. La cuenta de ejemplo tiene asignada R01. |
| Alumno o profesor | Consultar itinerarios, horarios y tarifas, y marcar avisos como leídos. |
| Visitante | Consultar recorridos y avisos públicos. |

## Configurar Google Maps

1. En tu proyecto de Google Cloud, habilita la facturación, **Maps JavaScript API** y **Routes API**. Crea una clave para sitios web, limítala a esas API y autoriza los orígenes desde los cuales abrirás UPTex, por ejemplo **http://127.0.0.1:3000/\*** para la demo y el dominio HTTPS de operación.
2. Copia **.env.example** a **.env**. Coloca la clave en **GOOGLE_MAPS_BROWSER_KEY**. Para operación, configura también **GOOGLE_MAPS_MAP_ID** con un ID de mapa JavaScript propio. La demo usa **DEMO_MAP_ID** si dejas ese valor vacío.
3. Reinicia el servidor. Selecciona una ruta y activa **Tráfico** para mostrar la capa vial. El itinerario muestra la distancia y el tiempo estimado con tráfico cuando Google devuelve esos valores. **Actualizar** pide un nuevo cálculo.

La clave configurada es de navegador y se envía al cliente. Mantenla restringida por origen y por API. Sin clave o si falla el servicio, la pantalla usa el mapa esquemático y conserva los horarios publicados. [Configuración de claves](https://developers.google.com/maps/api-security-best-practices) · [Biblioteca Routes](https://developers.google.com/maps/documentation/javascript/routes/overview) · [Marcadores y Map ID](https://developers.google.com/maps/documentation/javascript/advanced-markers/start)

## Instalar la app móvil

Sirve el proyecto con HTTPS y abre la dirección en el teléfono. En Android, usa **Instalar aplicación** desde Chrome. En iPhone, en Safari, usa **Compartir → Añadir a pantalla de inicio**. Después de la primera consulta en línea, la app conserva el catálogo público para consultarlo sin conexión. El inicio de sesión, los cambios y el trazado de Google requieren conexión.

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

Desde el teléfono, abre el mismo dominio HTTPS para instalar la PWA. La primera ejecución crea un catálogo inicial. Confirma las coordenadas de las paradas antes de usarlo para el servicio.

[Servicios y GitHub](https://docs.railway.com/services) · [Volúmenes y permisos](https://docs.railway.com/volumes) · [Dominio HTTPS](https://docs.railway.com/networking/public-networking)

## Pruebas y documentación

~~~powershell
npm test
~~~

- [Memoria técnica, rúbrica y guion de demostración](docs/memoria-tecnica.md)
- [Flujo de integración continua para GitHub](.github/workflows/ci.yml)

