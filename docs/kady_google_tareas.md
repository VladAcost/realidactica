# Kady, Google y tareas

Cambios locales: Inicio sin el panel fijo, Kady flotante en todas las pantallas con sesión, navegación por órdenes escritas o grabadas, bienvenida por rol, diagnóstico inicial de 12 preguntas y tareas por grupo con entregas de texto.

## Activar la voz

En `.env`, coloca `ELEVENLABS_API_KEY`. Selecciona en ElevenLabs una voz femenina de español de México con tono cálido y tranquilo, y coloca su identificador en `KADY_SPANISH_VOICE_ID`. La selección automática prioriza voces femeninas disponibles en español con referencias a México y tono calmado; conviene escuchar la elegida antes de usarla con alumnos. La clave se usa solo en el servidor. El ritmo se configura a 0.94 con Multilingual v2. No se ha podido escuchar ni verificar una voz real porque falta la clave local.

La reproducción comienza cuando el navegador la permite; si la bloquea, Kady muestra un reproductor. Se puede silenciar y detener la voz. El micrófono pide permiso al pulsarlo, graba hasta 30 segundos y envía la grabación a ElevenLabs; al cerrar la ventana se detiene la captura. Inglés conserva su conversación dedicada.

## Activar Google

1. Crea un cliente OAuth de tipo Aplicación web en Google Cloud y configura la pantalla de consentimiento.
2. Registra exactamente la dirección `APP_BASE_URL/auth/google/callback`. Para el entorno local predeterminado: `http://localhost:8080/auth/google/callback`. Usa el mismo dominio al abrir la aplicación; no alternes `localhost` y `127.0.0.1` durante el acceso.
3. Coloca `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` en `.env`. No los compartas por chat ni los incluyas en el repositorio.
4. Configura una base MySQL real y sus variables `MYSQL_*`. Para una base nueva usa `schema.sql`; para una existente aplica `migrations/002_google_identity.sql`. La copia local actual usa demostración y todavía no tiene MySQL configurado. En Railway, el inicializador aplica la tabla nueva a partir de `schema.sql`.
5. Reinicia la aplicación. El botón se habilita solo cuando ambas credenciales están configuradas.

El registro nuevo como alumno queda activo; como docente queda pendiente. Las cuentas existentes conservan su rol. Authlib valida el estado, nonce y token de Google. Solo se vinculan automáticamente cuentas locales activas cuyo correo Google controla (Gmail o Workspace verificado). Otros correos deben vincularse con ayuda del administrador.

`GOOGLE_APPROVER_EMAILS=realidactica@gmail.com` autoriza a ese correo verificado mediante Google a entrar a **Aprobar docentes**, disponible en Kady y en Tareas. Puede registrar su cuenta como alumno o docente; si el correo administrador se registra como docente, se activa para poder administrar las aprobaciones. Las demás cuentas docentes requieren aprobación.

## Tareas y grupos

Desde **Tareas y entregas**, un docente elige un grupo, título, instrucciones y fecha. Puede inscribir una cuenta estudiantil activa por su correo en un grupo existente. Los grupos se crean desde **Grupos**. Como en la gestión académica existente, los docentes comparten el catálogo de grupos; las tareas y sus entregas sí se consultan por docente creador.

Las cuentas locales de demostración comparten un grupo ficticio para probar la creación y entrega de tareas sin MySQL. No se mezclan con los grupos reales.

El alumno ve las tareas de sus grupos y puede entregar o actualizar una respuesta de texto. Esta entrega elimina el pendiente de su agenda y de lo que informa Kady. La fecha se muestra como fecha límite; se permiten entregas posteriores. Esta versión no incluye calificación, adjuntos ni Google Classroom.

Kady solo dice que no hay pendientes después de consultar correctamente las tareas asignadas en Realidáctica. No considera los materiales PDF como tareas ni afirma conocer pendientes de plataformas externas.

## Diagnóstico y progreso

El diagnóstico inicial cubre lenguaje algebraico, signos, suma y resta, y multiplicación y división de expresiones. Con 12/12 acredita esas cuatro clases; las seis restantes conservan sus evaluaciones. Se sugieren retos avanzados y también se permite repasar. Con errores no concede acreditaciones, habilita la práctica guiada correspondiente y ofrece aliento. El diagnóstico se conserva por cuenta y no se vuelve a crear en visitas posteriores.

## Persistencia y verificación

`EXPERIENCE_DB_PATH` guarda bienvenida, tareas y entregas (por defecto `instance/experience.sqlite3`). `ALGEBRA_DB_PATH` guarda evaluaciones. Configura ambos en un volumen persistente y respáldalos; para varias instancias migra a almacenamiento compartido. Las identidades Google, usuarios y membresías de grupo están en MySQL.

Pruebas: `.venv/Scripts/python.exe -m unittest discover -s tests -v` y `node --test tests/test_english_voice.js tests/test_math_widget.js tests/test_kady.js`.

Referencias oficiales: [ElevenLabs: voz](https://elevenlabs.io/docs/overview/capabilities/text-to-speech), [ajustes de velocidad](https://elevenlabs.io/docs/help-center/product/core-capabilities/text-to-speech/can-i-change-the-pace-of-the-voice), [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect).


## Configuración concreta del proyecto Railway existente

Revisión del 11 de noviembre de 2026: existe el proyecto `realidactica`, con los servicios `realidactica-web` y `MySQL` en `production`. MySQL ya tiene su volumen. Se prepara un volumen nuevo para el web en `/app/instance`, destinado a progreso, diagnósticos y tareas. La preparación permanece pendiente de publicación. Las dos variables de Google ya están presentes en Railway; sus valores no fueron leídos.

- Proyecto: https://railway.com/project/f233a6f6-ba76-4331-bc6b-ea5c7b6e9498
- Dirección pública: https://realidactica-web-production.up.railway.app
- Callback Google de producción: https://realidactica-web-production.up.railway.app/auth/google/callback
- Callback local opcional: http://localhost:8080/auth/google/callback

### Crear el cliente Google

1. Entra a https://console.cloud.google.com/ con la cuenta que administrará Realidáctica. Crea o selecciona un proyecto llamado Realidáctica.
2. Abre **Google Auth Platform**. En **Branding / Información de la aplicación**, usa el nombre `Realidáctica` y el correo de soporte y contacto `realidactica@gmail.com` si la cuenta lo permite; Google puede exigir un correo que administre el proyecto.
3. Elige audiencia **External / Externo**, ya que se admitirán cuentas de alumnos y docentes ajenas a una sola organización.
4. En **Data Access / Acceso a datos**, limita los permisos a `openid`, `email` y `profile` (pueden mostrarse como `userinfo.email` y `userinfo.profile`). Son los que pide el acceso actual.
5. En **Clients / Clientes**, crea un cliente de tipo **Web application / Aplicación web**, con nombre `Realidactica Railway`.
6. Agrega como URI de redirección autorizada exactamente el callback de producción mostrado arriba. Puedes agregar el local como otra entrada si quieres probar también en esta computadora. No agregues una barra al final.
7. Guarda el identificador de cliente y el secreto de forma privada. No los incluyas en archivos versionados ni en el chat. Mientras se valida el acceso, configura la audiencia de prueba que indique Google. Antes de abrir el registro a todo el público, revisa el estado de publicación y los requisitos que muestre Google para tu aplicación.

### Activación posterior en Railway

En el servicio `realidactica-web`, las variables `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` ya existen; se añade `GOOGLE_APPROVER_EMAILS=realidactica@gmail.com`. `APP_BASE_URL` debe coincidir con `https://realidactica-web-production.up.railway.app`. Las claves `OPENAI_API_KEY` y `ELEVENLABS_API_KEY` tampoco figuran entre las variables actuales del servicio; habrá que configurarlas de forma privada para activar conversación y voz. `KADY_SPANISH_VOICE_ID` fijará la voz femenina mexicana elegida.

Antes de publicar la nueva versión, se debe revisar la compatibilidad de las tablas existentes y respaldar MySQL. El inicializador verifica primero las columnas de las tablas existentes. Si faltan columnas requeridas o el identificador de usuario es incompatible con el vínculo Google, detiene el arranque antes de crear tablas y pide una migración revisada. Crea tablas que no existan; no transforma por sí solo una tabla antigua.

Para el estado SQLite de la versión actual se prepara un volumen de 1 GB del web en `/app/instance`, con una sola réplica y estas rutas: `DIAGNOSTICS_DB_PATH=/app/instance/diagnostics.sqlite3`, `ALGEBRA_DB_PATH=/app/instance/algebra.sqlite3` y `EXPERIENCE_DB_PATH=/app/instance/experience.sqlite3`. `PERSISTENT_DATA_DIR=/app/instance` y `RAILWAY_RUN_UID=0` permiten al arranque ajustar únicamente los permisos de sus rutas conocidas; luego el proceso baja a UID 10001 antes de conectar MySQL o iniciar Gunicorn. El volumen del web es independiente del que ya usa MySQL.

`UPLOAD_FOLDER` conserva su configuración actual. Antes de trasladar los PDF docentes a almacenamiento permanente se deben copiar los archivos del servicio activo y revisar sus rutas; esa migración de archivos no forma parte del volumen de tareas.

El directorio local `instance/` se excluye de la imagen: las bases locales, capturas y utilidades de pruebas no deben formar parte del despliegue.
