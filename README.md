# ONKA — Control horario, imputación de horas y calendario

Aplicación web para fichaje, imputación de horas por proyecto y calendario de empresa,
con un panel de administración para extraer los datos de todos los trabajadores.

## Qué es y qué NO es

- **Es una app web real con backend**: todos los trabajadores fichan e imputan horas
  contra el **mismo servidor**, así que tú, como administrador, ves los datos de
  los 27 (o los que sean) en un solo sitio.
- **No necesita instalar nada en los móviles**: cada trabajador simplemente abre un
  enlace en el navegador de su móvil (Chrome, Safari...) y usa la app ahí. Si quieres,
  puede "Añadir a pantalla de inicio" desde el navegador para que le quede como un icono más.
- No tiene apps nativas de iOS/Android — es una web app responsive, que es la forma
  más rápida y barata de teneros a todos operativos.

## 1. Probarla en tu propio ordenador (antes de publicarla)

Necesitas tener [Node.js](https://nodejs.org) instalado (versión 18 o superior).

```bash
cd onka-app
node server.js
```

Abre `http://localhost:3000` en tu navegador. Verás el login. Usuario de
ejemplo ya creado:

- **Administrador** — PIN `0000`

Desde el panel de Administración → Usuarios das de alta a tu equipo real,
eligiendo para cada persona el rol **Oficina** o **Fábrica**.

## 2. Publicarla en internet (para que la use todo el mundo desde el móvil)

La forma más simple y gratuita para un equipo de este tamaño es usar un hosting
que "arranque" tu `server.js` automáticamente. Dos opciones sencillas, sin tarjeta
de crédito para empezar:

### ⚠️ Antes de nada: por qué necesitas una "base de datos" gratuita aparte

Esta app guarda los fichajes, imputaciones y usuarios en un archivo. **El plan
gratuito de Render (o cualquier hosting gratis) NO guarda ese archivo de forma
permanente**: cuando el servicio "duerme" por inactividad y vuelve a arrancar
(o cada vez que subes un cambio), ese archivo se resetea y **se pierden todos
los fichajes, imputaciones y usuarios que hayáis creado**, quedando solo el
Administrador de fábrica. Esto no es un fallo de la app — es cómo funciona el
almacenamiento gratuito de estos hostings.

**La solución 100% gratis** (sin tarjeta, sin letra pequeña de por vida) es
usar **Upstash**: una base de datos en internet con un plan gratuito
permanente (256 MB, 500.000 operaciones al mes — de sobra para 27 personas).
Solo tarda 5 minutos en configurarse y no cuesta nada.

#### Paso 0 — Crear la base de datos gratuita en Upstash

1. Ve a [upstash.com](https://upstash.com) → "Sign Up" (puedes registrarte con
   tu cuenta de GitHub o Google, no pide tarjeta).
2. Una vez dentro, pulsa **"Create Database"**.
3. Ponle un nombre, por ejemplo `onka-datos`. Tipo: **Redis**. Elige la región
   más cercana a España (por ejemplo, alguna de Europa). Plan: **Free**.
4. Pulsa "Create". Entra en la base de datos recién creada.
5. Baja hasta la sección **"REST API"**. Ahí verás dos valores que necesitas
   copiar:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
   Guárdalos a mano (los pegarás en Render en el siguiente paso).

### Opción A — Render.com (gratis)

1. Sube esta carpeta a un repositorio de GitHub (recuerda que `index.html`
   debe quedar dentro de la carpeta `public/`, no suelto).
2. Entra en [render.com](https://render.com) → "New" → "Web Service" → conecta
   tu repositorio.
3. Configuración:
   - **Build command**: `npm install` (no instalará nada real, pero Render exige algo aquí)
   - **Start command**: `node server.js`
   - **Instance Type**: **Free** — ya no hace falta pagar nada.
4. **Antes de desplegar** (o después, en la pestaña "Environment" del
   servicio), añade estas dos variables de entorno con los valores que
   copiaste de Upstash en el Paso 0:
   - `UPSTASH_REDIS_REST_URL` → pega la URL
   - `UPSTASH_REDIS_REST_TOKEN` → pega el token
5. Guarda y despliega (o si ya estaba desplegado, Render lo reiniciará solo
   al guardar las variables). Render te da una URL tipo
   `https://onka-tuempresa.onrender.com`.
6. Comparte esa URL con tu equipo — eso es todo, ya pueden entrar desde el móvil.

Con esto, aunque Render "duerma" o reinicie el servicio, **los datos viven en
Upstash y no se pierden nunca**. Lo único que notaréis es que, si nadie usa la
app durante un rato, la primera vez que alguien la abre puede tardar unos
30-60 segundos en cargar (Render "despertando") — pero los datos estarán
intactos.

> Si en algún momento quitas o pierdes esas dos variables de entorno, la app
> sigue funcionando pero vuelve a guardar en el archivo local (que si es
> Render gratis, se resetea). Compruébalas si algún día ves que faltan datos.

### Opción B — Railway.app (gratis, con matices)

Mismo proceso: conectas el repositorio, Railway detecta que es Node.js y usa
`node server.js` automáticamente. Añade ahí también las dos variables de
entorno de Upstash igual que en Render. Railway da $5 de crédito gratis al
mes — para una app tan ligera como esta suele ser suficiente, pero a
diferencia de Render no es un "free" permanente garantizado, así que Render
es la opción más segura para no pagar nada.

### Opción C — Un ordenador o servidor propio en la oficina

Si prefieres no depender de terceros, puedes dejar este mismo `server.js`
corriendo en un ordenador de la oficina (o una Raspberry Pi) conectado a
vuestro router, y que los móviles se conecten mientras estén en la red WiFi de
la empresa (o configurar acceso remoto en el router). Aquí no necesitas
Upstash, porque el archivo vive en un disco real todo el tiempo sin
reiniciarse solo. Recomendable solo si ya tenéis a alguien cómodo con estas
configuraciones de red.



## 3. Cómo funciona por dentro (por si lo lleváis a un desarrollador)

- `server.js` — backend en Node.js **sin dependencias externas** (nada que
  instalar con `npm install`). Guarda los datos en Upstash si configuras las
  variables de entorno (recomendado en producción), o si no, en
  `data/data.json` en el propio disco (solo para pruebas en local).
- `public/index.html` — todo el frontend en un único archivo, cargando React
  desde internet (por eso hace falta conexión).
- Autenticación por **usuario + PIN**, con sesiones que caducan a los 30 días.
- Un trabajador normal **solo puede ver y guardar sus propios fichajes e
  imputaciones** — nunca los de sus compañeros. Solo el administrador puede
  leer los datos de todos, dar de alta usuarios, gestionar el calendario y
  exportar informes.
- **Roles**: Oficina y Fábrica (además del Administrador). Hay dos "familias"
  de conceptos para imputar horas: **Proyectos** (comunes a oficina y fábrica)
  y **Trabajos auxiliares** (solo fábrica). El administrador puede autorizar
  a cualquier trabajador como "responsable" de una familia para que pueda
  crear y gestionar sus conceptos sin ser administrador — y decidir si cada
  uno es "fijo" (no se puede borrar sin desmarcarlo antes).
- **Límite de horas por día**: la jornada principal admite hasta 8,5h de
  lunes a jueves y 5h el viernes; lo que se trabaje de más se registra aparte,
  claramente marcado, en el bloque "Horas excedentes".
- **Calendario**: el administrador puede crear festivos (con ámbito nacional,
  autonómico o local — indicando la comunidad o localidad), periodos de
  vacaciones, y eventos/reuniones con hora, ubicación, comentario y
  convocados concretos. Solo los festivos nacionales o autonómicos silencian
  la alerta de "olvido de fichaje"; los locales son solo informativos, porque
  hay trabajadores de distintas localidades. Un evento puede llevar un aviso
  configurable (15 min, 1 hora, 1 día antes...) que se muestra como
  recordatorio a los convocados dentro de la app.
- Los informes se exportan a Excel (`.xlsx`) directamente desde el navegador
  del administrador, con dos hojas: Fichajes e Imputaciones (esta última
  indica también qué horas son excedentes).

## 4. Limitaciones a tener en cuenta

- **Los avisos de eventos/reuniones son recordatorios dentro de la app**, no
  notificaciones push del móvil — el trabajador los ve como un aviso en
  pantalla cuando abre la aplicación dentro de la ventana de tiempo
  configurada (por ejemplo, "1 hora antes"). Si no abre la app en ese rato,
  no le llegará una notificación al estilo WhatsApp. Añadir notificaciones
  push reales es posible más adelante, pero requiere una capa técnica
  adicional (Service Workers + claves push) que no se ha incluido en esta
  primera versión para mantener el despliegue simple.

- El envío de informes "por correo" abre tu propio cliente de correo con un
  resumen — el Excel hay que adjuntarlo a mano, ya que enviarlo automáticamente
  con el archivo adjunto requeriría configurar un servidor de correo (SMTP)
  aparte. Podemos añadirlo más adelante si lo necesitas.
- Los datos se guardan en Upstash (recomendado) o en un archivo local si no
  configuras Upstash. Con Upstash, el límite gratuito es de 500.000
  operaciones al mes y 256 MB — para 27 personas fichando e imputando a
  diario está muy lejos de alcanzarse.
- Aun así, haz de vez en cuando una copia del contenido (puedes verlo y
  copiarlo desde el propio panel de Upstash, en la pestaña "Data Browser",
  clave `onka-data`) para tener un respaldo extra.
