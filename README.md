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

### Opción A — Render.com (recomendada, capa gratuita)

1. Sube esta carpeta a un repositorio de GitHub (puedes arrastrar los archivos
   directamente en github.com si no usas Git habitualmente).
2. Entra en [render.com](https://render.com) → "New" → "Web Service" → conecta
   tu repositorio.
3. Configuración:
   - **Build command**: (déjalo vacío, no hace falta)
   - **Start command**: `node server.js`
4. Despliega. Render te da una URL tipo `https://onka-tuempresa.onrender.com`.
5. Comparte esa URL con tu equipo — eso es todo, ya pueden entrar desde el móvil.

### Opción B — Railway.app

Mismo proceso: conectas el repositorio, Railway detecta que es Node.js y usa
`node server.js` automáticamente. También tiene capa gratuita/de prueba.

> **Importante sobre el plan gratuito**: los planes gratuitos de estos servicios
> "duermen" el servidor si nadie lo usa un rato, y tarda unos segundos en
> "despertar" con la primera visita del día. Para 27 personas usándolo a diario
> esto apenas se nota, pero si te molesta, el salto a un plan de pago (unos
> pocos euros al mes) lo deja siempre encendido al instante.

### Opción C — Un ordenador o servidor propio en la oficina

Si prefieres no depender de terceros, puedes dejar este mismo `server.js`
corriendo en un ordenador de la oficina (o una Raspberry Pi) conectado a
vuestro router, y que los móviles se conecten mientras estén en la red WiFi de
la empresa (o configurar acceso remoto en el router). Recomendable solo si ya
tenéis a alguien cómodo con estas configuraciones de red.

## 3. Cómo funciona por dentro (por si lo lleváis a un desarrollador)

- `server.js` — backend en Node.js **sin dependencias externas** (nada que
  instalar con `npm install`). Guarda los datos en `data/data.json`.
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
- Los datos se guardan en un archivo (`data/data.json`) en el propio servidor.
  Para 27 personas esto es totalmente adecuado; si en el futuro creciera
  mucho más, se podría migrar a una base de datos, pero no hace falta ahora.
- Haz copias de seguridad de `data/data.json` de vez en cuando (o configura
  copias automáticas si tu hosting lo permite) para no perder el histórico.
