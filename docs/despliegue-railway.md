# Publicar Transporte UPTex en Railway

## Archivos y configuración

Este proyecto incluye `Dockerfile` en la raíz. Railway puede construirlo directamente desde el repositorio; el contenedor escucha en `0.0.0.0:3000`.

## 1. Subir la nueva identidad a GitHub

En PowerShell, desde la carpeta del proyecto:

```powershell
Set-Location 'C:\Users\aleja\OneDrive\Documents\TRANSPORTES UPTEX'
git add public/app.js public/index.html public/manifest.webmanifest public/styles.css public/sw.js public/uptex-logo.jpg
git commit -m "Actualizar marca UPTex con identidad verde"
git push origin main
```

El entorno de edición puede bloquear escrituras a `.git`; si Git vuelve a informar de acceso denegado, abre una terminal normal de Windows en esta carpeta y corre allí los mismos comandos.

## 2. Crear el servicio

1. Entra a Railway y crea un proyecto con **Deploy from GitHub repo**.
2. Selecciona `alexsdfgr/TRANSPORTES-UPTEX`, rama `main`. Railway detecta el `Dockerfile` y despliega en cada push.
3. En el servicio, crea un volumen montado en `/app/data`. La base SQLite está en ese directorio y se perdería en un nuevo despliegue si no se conserva.
4. Configura las variables de entorno del siguiente bloque. Escribe una contraseña nueva y fuerte; no reutilices la clave de tu máquina ni subas `.env` a GitHub.
5. En **Settings → Networking**, genera un dominio público.

## 3. Variables del servicio

```text
HOST=0.0.0.0
PORT=3000
DEMO_MODE=0
SECURE_COOKIES=1
RAILWAY_RUN_UID=0
ADMIN_EMAIL=tu-correo-de-coordinacion
ADMIN_PASSWORD=una-contraseña-nueva-de-al-menos-12-caracteres
GOOGLE_MAPS_BROWSER_KEY=tu-clave-de-google-maps
GOOGLE_MAPS_MAP_ID=tu-map-id
```

`RAILWAY_RUN_UID=0` permite escribir en el volumen `/app/data`, que Railway monta con permisos de root. La cuenta de coordinación solo se crea la primera vez que se inicializa el volumen. No cambies después `DEMO_MODE` con la misma base de datos.

## 4. Google Maps

En Google Cloud, habilita facturación y los servicios de Maps JavaScript API y Routes API en el proyecto de Google Maps. Crea una clave de navegador y restríngela al dominio HTTPS de Railway; habilita únicamente las APIs que use el proyecto. Crea también un map ID y guárdalo en `GOOGLE_MAPS_MAP_ID`. Añade ambos valores al servicio en Railway y vuelve a desplegar.

La clave del navegador es visible para el navegador, así que restríngela por dominio y API. Nunca guardes credenciales de administrador ni secretos en el repositorio.

## 5. Verificar

Abre `https://TU-DOMINIO.up.railway.app/api/health`. Debe responder `{"status":"ok"}`. Después abre la raíz del dominio, inicia sesión con el administrador y verifica rutas y mapas.

**Nota sobre el despliegue:** el servicio Railway no puede publicarse hasta que estén conectadas la cuenta Railway y GitHub y se haya cargado la configuración requerida (sobre todo credenciales y almacenamiento persistente).
