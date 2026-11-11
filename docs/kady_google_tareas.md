# Kady, Google y tareas

Kady flotante acompaña las pantallas con sesión. Cada pestaña selecciona su propia tutora, con historial independiente por cuenta, tareas de su materia y navegación controlada. Se conservan el diagnóstico inicial de álgebra de 12 preguntas y las tareas por grupo con entregas de texto.

## Tutoras por pestaña

- **Kady Inicio:** orientación general, motivación, pendientes de todas las materias, perfil, cuestionario de aprendizaje y navegación entre pestañas.
- **Kady Álgebra:** explicaciones, ejercicios y tareas de álgebra.
- **Kady Cálculo:** integrales y sus bases, actividades y tareas de cálculo.
- **Kady JavaScript:** programación, frameworks y material de desarrollo web.
- **Kady Liderazgo:** liderazgo, comunicación y trabajo en equipo.
- **Kady Inglés:** aprendizaje y práctica de inglés. La conversación oral dedicada de inglés conserva su activación y también permite interrumpir la respuesta al hablar.

`kady_agents.py` define los ámbitos. El servidor valida el identificador de tutora; no acepta instrucciones del navegador para ampliar su alcance. Las otras materias se remiten a Inicio. Cada conversación conserva hasta 40 mensajes por cuenta y tutora, muestra los 16 últimos y usa los 12 últimos como contexto para el modelo. Las peticiones a OpenAI usan `store=False`.

Los avisos de presentación se registran en el servidor y se reclaman una sola vez, incluso entre pestañas. Restaurar un historial no vuelve a leerlo en voz alta. Las celebraciones automáticas se deduplican en el navegador por cuenta y tutora; el alumno puede pedir que se repitan.

En la primera visita de un alumno, Kady da una bienvenida breve y explica Realidáctica con palabras sencillas. Lo lleva a **Mi estilo de aprendizaje** al terminar la voz, o tras una pausa si no hay reproducción. Un enlace permite abrirlo de inmediato; cerrar o interactuar cancela el traslado automático. Los docentes reciben una bienvenida de su rol sin este traslado.

## Activar la voz

En `.env`, coloca `ELEVENLABS_API_KEY`. Selecciona en ElevenLabs una voz femenina de español de México con tono cálido y tranquilo, y coloca su identificador en `KADY_SPANISH_VOICE_ID`. La selección automática prioriza voces femeninas disponibles en español con referencias a México y tono calmado. La clave se usa solo en el servidor. El ritmo se configura a 0.94 con Multilingual v2. En Railway la voz y la conversación con OpenAI ya están configuradas; el usuario confirmó que puede escuchar y conversar por escrito y por voz.

La reproducción comienza cuando el navegador la permite; si la bloquea, Kady muestra un reproductor. Se puede silenciar y detener la voz.

### Conversación continua

Pulsa **Conversar** una sola vez y autoriza el micrófono. Habla con naturalidad: después de 1,5 segundos de pausa se envía la frase y Kady responde; al terminar vuelve a escuchar sin otro toque. Si hablas mientras responde, una señal de voz sostenida detiene el audio y conserva el comienzo de tu nueva frase. El indicador muestra si está escuchando, entendiendo o hablando. No se escucha mientras está transcribiendo o preparando la respuesta.

**Finalizar**, «termina la conversación», minimizar Kady, ocultar la pestaña o salir apagan el micrófono y cancelan la transcripción pendiente. Tras 90 segundos sin conversación también se pausa. La escucha no se reactiva automáticamente al regresar a la página. El control de Inglés y la burbuja detienen mutuamente su captura para no mantener dos micrófonos activos.

El audio se procesa con `AudioWorklet`, se convierte a PCM mono de 16 kHz y se envía como WAV completo por frase a ElevenLabs Scribe v2. Un pequeño búfer local conserva el principio de las palabras. Los silencios y las pruebas de volumen permanecen en el navegador; cada frase tiene un máximo de 58 segundos y cabe en el límite de 2 MB del servidor. El navegador solicita cancelación de eco, reducción de ruido y ajuste de ganancia; cuando ofrece el modo de cancelación de todo el audio local, se prefiere ese modo. Una detección más conservadora durante la reproducción reduce interrupciones por ruido. La precisión de la interrupción depende del micrófono, la acústica y la cancelación de eco disponible; usar auriculares puede ayudar.

Requiere un navegador con AudioWorklet y acceso seguro al micrófono (HTTPS o localhost). Si no está disponible, se conserva el chat escrito. Referencias: [procesamiento de audio del navegador](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletProcessor/process) y [cancelación de eco](https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints/echoCancellation).

## Activar Google

1. Crea un cliente OAuth de tipo Aplicación web en Google Cloud y configura la pantalla de consentimiento.
2. Registra exactamente la dirección `APP_BASE_URL/auth/google/callback`. Para el entorno local predeterminado: `http://localhost:8080/auth/google/callback`. Usa el mismo dominio al abrir la aplicación; no alternes `localhost` y `127.0.0.1` durante el acceso.
3. Coloca `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` en `.env`. No los compartas por chat ni los incluyas en el repositorio.
4. Configura una base MySQL real y sus variables `MYSQL_*`. Para una base nueva usa `schema.sql`; para una existente aplica `migrations/002_google_identity.sql`. La copia local actual usa demostración y todavía no tiene MySQL configurado. En Railway, el inicializador aplica la tabla nueva a partir de `schema.sql`.
5. Reinicia la aplicación. El botón se habilita solo cuando ambas credenciales están configuradas.

El registro nuevo como alumno queda activo; como docente queda pendiente. Las cuentas existentes conservan su rol. Authlib valida el estado, nonce y token de Google. Solo se vinculan automáticamente cuentas locales activas cuyo correo Google controla (Gmail o Workspace verificado). Otros correos deben vincularse con ayuda del administrador.

`GOOGLE_APPROVER_EMAILS=realidactica@gmail.com` autoriza a ese correo verificado mediante Google a entrar a **Aprobar docentes**, disponible en Kady y en Tareas. Puede registrar su cuenta como alumno o docente; si el correo administrador se registra como docente, se activa para poder administrar las aprobaciones. Las demás cuentas docentes requieren aprobación.

## Tareas y grupos

Desde **Tareas y entregas**, un docente elige un grupo, materia, título, instrucciones y fecha. Puede inscribir una cuenta estudiantil activa por su correo en un grupo existente. Los grupos se crean desde **Grupos**. Como en la gestión académica existente, los docentes comparten el catálogo de grupos; las tareas y sus entregas sí se consultan por docente creador.

Las tareas existentes se conservan con materia **General**. Su docente puede cambiar la materia desde la misma tarjeta. Inicio consulta todos los pendientes autorizados; cada tutora recibe exclusivamente los de su materia. El filtro de Tareas permite revisar una materia y abre la tutora correspondiente.

Las cuentas locales de demostración comparten un grupo ficticio para probar la creación y entrega de tareas sin MySQL. No se mezclan con los grupos reales.

El alumno ve las tareas de sus grupos y puede entregar o actualizar una respuesta de texto. Esta entrega elimina el pendiente de su agenda y de lo que informa Kady. La fecha se muestra como fecha límite; se permiten entregas posteriores. Esta versión no incluye calificación, adjuntos ni Google Classroom.

Kady solo dice que no hay pendientes después de consultar correctamente las tareas asignadas en Realidáctica. No considera los materiales PDF como tareas ni afirma conocer pendientes de plataformas externas.

## Diagnóstico y progreso

El diagnóstico inicial cubre lenguaje algebraico, signos, suma y resta, y multiplicación y división de expresiones. Con 12/12 acredita esas cuatro clases; las seis restantes conservan sus evaluaciones. Se sugieren retos avanzados y también se permite repasar. Con errores no concede acreditaciones, habilita la práctica guiada correspondiente y ofrece aliento. El diagnóstico se conserva por cuenta y no se vuelve a crear en visitas posteriores.

## Persistencia y verificación

`EXPERIENCE_DB_PATH` guarda bienvenida, avisos, historiales por tutora, tareas y entregas (por defecto `instance/experience.sqlite3`). La actualización crea las tablas de memoria y avisos y añade la columna de materia sin borrar tareas existentes. `ALGEBRA_DB_PATH` guarda evaluaciones. Configura ambos en un volumen persistente y respáldalos; para varias instancias migra a almacenamiento compartido. Las identidades Google, usuarios y membresías de grupo están en MySQL.

Pruebas: `.venv/Scripts/python.exe -m unittest discover -s tests -v` y `node --test tests/test_english_voice.js tests/test_math_widget.js tests/test_kady.js tests/test_kady_capture.js`.

Referencias oficiales: [ElevenLabs: voz](https://elevenlabs.io/docs/overview/capabilities/text-to-speech), [ajustes de velocidad](https://elevenlabs.io/docs/help-center/product/core-capabilities/text-to-speech/can-i-change-the-pace-of-the-voice), [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect).


## Configuración concreta del proyecto Railway existente

Revisión del 11 de noviembre de 2026: el proyecto `realidactica` tiene los servicios `realidactica-web` y `MySQL` en `production`. Cada servicio tiene su volumen. El del web está montado en `/app/instance` para progreso, diagnósticos, tareas e historiales. Google, OpenAI y ElevenLabs ya están configurados en Railway. Los valores secretos no se incluyen en este documento.

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

En el servicio `realidactica-web` están configuradas `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_APPROVER_EMAILS=realidactica@gmail.com`, `OPENAI_API_KEY`, `ELEVENLABS_API_KEY` y `KADY_SPANISH_VOICE_ID`. `APP_BASE_URL` coincide con `https://realidactica-web-production.up.railway.app`. Las claves se mantienen en las variables privadas del servidor.

Antes de publicar la nueva versión, se debe revisar la compatibilidad de las tablas existentes y respaldar MySQL. El inicializador verifica primero las columnas de las tablas existentes. Si faltan columnas requeridas o el identificador de usuario es incompatible con el vínculo Google, detiene el arranque antes de crear tablas y pide una migración revisada. Crea tablas que no existan; no transforma por sí solo una tabla antigua.

Para el estado SQLite se utiliza un volumen de 1 GB del web en `/app/instance`, con una sola réplica y estas rutas: `DIAGNOSTICS_DB_PATH=/app/instance/diagnostics.sqlite3`, `ALGEBRA_DB_PATH=/app/instance/algebra.sqlite3` y `EXPERIENCE_DB_PATH=/app/instance/experience.sqlite3`. `PERSISTENT_DATA_DIR=/app/instance` y `RAILWAY_RUN_UID=0` permiten al arranque ajustar únicamente los permisos de sus rutas conocidas; luego el proceso baja a UID 10001 antes de conectar MySQL o iniciar Gunicorn. El volumen del web es independiente del que ya usa MySQL.

`UPLOAD_FOLDER` conserva su configuración actual. Antes de trasladar los PDF docentes a almacenamiento permanente se deben copiar los archivos del servicio activo y revisar sus rutas; esa migración de archivos no forma parte del volumen de tareas.

El directorio local `instance/` se excluye de la imagen: las bases locales, capturas y utilidades de pruebas no deben formar parte del despliegue.
