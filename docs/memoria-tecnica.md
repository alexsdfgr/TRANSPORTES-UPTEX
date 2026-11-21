# Memoria técnica · Transporte UPTex

## Problema y alcance

Los folletos de transporte contienen itinerarios, horarios y tarifas que los usuarios necesitan consultar en un solo lugar. Coordinación requiere editar ese catálogo, asignar choferes, comunicar cambios y registrar qué viajes salieron o llegaron. La app ofrece consulta pública y delimita el acceso de escritura por rol.

La libreta indica cuatro rutas y presenta el seguimiento en tiempo real, la identificación por QR y las rutas alternas como trabajo a futuro. La entrega implementa registros de salida y llegada, estimaciones de viaje con tráfico de Google Maps y avisos en la aplicación.

| Código | Folleto | Salida | Llegada | Paradas | Tarifa publicada |
| --- | --- | --- | --- | ---: | --- |
| R01 | Tepetlaoxtoc · UPTex | 06:10 | 07:00 | 9 | $14 o $20 MXN según parada |
| R02 | Tepetitlán (Chiautla) · UPTex | 06:10 | 07:00 | 10 | $14 o $20 MXN según parada |
| R03 | Geo–Ara–Beta · UPTex | 06:25 | Por confirmar | 17 | $14 MXN |
| R04 | Borrador pendiente de folleto | Por confirmar | Por confirmar | 0 | Por confirmar |

Se conservó la diferencia entre la salida de R01 a las 06:10 y la hora de 06:15 en la lista de paradas. En R02, la nota explica la espera de 06:15 a 06:20 en Gasolinera Chiautla. R03 mantiene las horas intermedias y de llegada vacías porque el folleto solo indica la salida. Tres intersecciones de R03 aparecen abreviadas en el material. Las coordenadas capturadas son aproximadas y se editan desde coordinación.

## Arquitectura

~~~mermaid
flowchart LR
    A[Panel web] --> C[API REST de UPTex]
    B[App móvil instalable] --> C
    C --> D[(SQLite)]
    A --> E[Google Maps JavaScript API y Routes API]
    B --> E
~~~

Node.js gestiona HTTP y SQLite con módulos incluidos en el runtime. El cliente usa módulos JavaScript, HTML y CSS. Escritorio y móvil comparten API, sesión y pantallas responsivas. La instalación móvil usa manifiesto y un service worker que conserva únicamente recursos de interfaz y el catálogo público. Google calcula el trayecto de la ruta seleccionada en el navegador usando sus paradas en orden. El tiempo de Google corresponde a un trayecto estimado con tráfico y el horario programado proviene del catálogo.

| Entidad | Datos y relación |
| --- | --- |
| Usuarios y sesiones | Identidad, rol, estado y hash de contraseña. Las sesiones ligan un token hasheado a un usuario y caducan a las 12 horas. |
| Rutas y paradas | Código, publicación, horario, chofer y paradas ordenadas con coordenadas, hora y tarifa. |
| Avisos y lecturas | Mensaje, tipo, audiencia general o por ruta, publicación y confirmación de lectura por usuario. |
| Viajes | Fecha en Ciudad de México, ruta, chofer y horas previstas y registradas. Se registra un viaje por ruta al día. |

## API y control de acceso

| Método | Ruta | Acceso |
| --- | --- | --- |
| GET | /api/health, /api/config, /api/catalog | Público |
| GET | /api/notices | Público, con lecturas por cuenta si hay sesión |
| GET | /api/session | Devuelve la sesión de la cookie si existe |
| POST | /api/login, /api/logout | Entrada y salida |
| GET | /api/dashboard | Cualquier cuenta activa |
| POST | /api/notices/:id/read | Cualquier cuenta activa |
| POST | /api/routes/:id/trip | Coordinación o chofer a cargo |
| GET | /api/admin/state | Coordinación |
| POST / PUT | /api/admin/routes y /api/admin/users | Coordinación |
| POST / PUT | /api/admin/notices | Coordinación |

Las escrituras requieren la cabecera **X-UPTEX-Request: 1** y aceptan cuerpos JSON. Cada operación restringida valida el rol en servidor. Las contraseñas se protegen con scrypt y sal aleatoria, y las sesiones viajan en cookies **HttpOnly**, **SameSite=Lax** y **Secure** para HTTPS. La edición de rutas y el registro de viajes usan transacciones. La API aplica validación al publicar y bloquea intentos repetidos de inicio de sesión. Los usuarios desactivados pierden acceso y sus sesiones se revocan. La base tiene claves foráneas y la API usa consultas parametrizadas.

## Evidencia para la rúbrica

| Criterio | Entrega y verificación |
| --- | --- |
| Análisis y diseño | Alcance, casos de uso, arquitectura y modelo de datos en esta memoria. |
| Desarrollo web | Panel general, catálogo, horarios, avisos y administración. |
| Desarrollo móvil | PWA instalable con navegación móvil y consulta del catálogo sin conexión. |
| Base de datos y arquitectura | Esquema en **store.mjs**, catálogo inicial en **seed.mjs** y API en **server.mjs**. |
| Seguridad | Contraseñas hasheadas, sesiones, permisos por rol y pruebas de acceso. |
| API e integración web-móvil | Interfaz y PWA consumen la misma API, con Google Maps para los recorridos. |
| Docker y despliegue | **Dockerfile**, **compose.yaml** y configuración de arranque en el README. |
| GitHub | Flujo de pruebas en push y pull request. El equipo puede enlazar estas actividades a issues en el repositorio de la entrega. |
| Memoria técnica | Documento de alcance, operación, datos y pruebas. |
| Demostración | Guion reproducible incluido a continuación. |

## Gestión en GitHub

Al llevar el código al repositorio del equipo, crea las incidencias **Validar coordenadas y cuarto recorrido**, **Configurar proyecto Google Maps**, **Publicar entorno HTTPS** y **Probar instalación física en Android y iPhone**. Relaciona los cambios con las incidencias mediante pull requests y usa el flujo de CI incluido para revisar las pruebas antes de integrar cambios. Guarda las claves de despliegue en variables de entorno del host y conserva **.env** fuera del repositorio.

## Guion de demostración

1. Abre el panel general y alterna entre los tres recorridos. Selecciona una parada y muestra su hora, tarifa y ubicación.
2. En **Horarios**, filtra R03. Comprueba que la salida indicada es 06:25 y que la llegada aparece por confirmar.
3. Con una clave válida, selecciona R01. Muestra el trazado de Google, los kilómetros, el tiempo estimado y la capa **Tráfico**.
4. Entra como coordinación. Abre el borrador R04 y muestra qué campos, coordenadas y orden definen el itinerario. En **Avisos**, publica un comunicado de tráfico y consulta el resultado como alumno.
5. Entra como chofer. En R01, registra salida y llegada. Entra como coordinación para ver el historial en **Administración → Viajes**.
6. Abre la app móvil desde el dominio HTTPS. Instálala y verifica que los horarios ya consultados se conservan al desconectar el teléfono.

Las pruebas automatizadas ejercitan los datos iniciales, la publicación de R04, la gestión y desactivación de usuarios, los permisos de escritura, los registros de viaje y los avisos. Ejecuta **npm test** desde la raíz.

