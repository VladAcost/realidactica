# Realidáctica

Plataforma educativa Flask con paneles para estudiantes y docentes, tutoría con OpenAI y temas claro/oscuro.

## Configuración local

1. Crea un entorno virtual e instala `requirements.txt`.
2. Copia `.env.example` a `.env` y asigna secretos nuevos.
3. Crea la base de datos con `schema.sql`. Para una base existente, revisa y aplica `migrations/001_security_hardening.sql` después de generar un respaldo.
4. En Windows, inicia con `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start_local.ps1`; el script carga `.env` solo para ese proceso y usa el entorno virtual del proyecto si existe. En otros entornos, exporta las variables de `.env` antes de iniciar Flask.
5. Para producción, usa un servidor WSGI.

La aplicación usa `gpt-5.6-terra` mediante OpenAI Responses API por defecto. Solo la conversación de inglés usa `gpt-5.6-luna`, configurable con `ENGLISH_OPENAI_MODEL`, para respuestas orales breves. La clave se lee únicamente desde `OPENAI_API_KEY`. La clase de inglés comienza con un cuestionario de seis preguntas que estima un nivel orientativo A1–B2. Después de activar el micrófono una vez, el estudiante dice «Hola Kady» y puede hablar en español o inglés. La conversación permanece abierta después de cada respuesta; tras 45 segundos de silencio vuelve a esperar «Hola Kady». El navegador detecta frases, conserva archivos de audio completos y espera 1,8 segundos de pausa antes de enviarlos al servidor. ElevenLabs Scribe v2 detecta el idioma automáticamente; solo durante la activación se refuerzan los términos «Hola Kady» y «Kady» con keyterm prompting, que tiene un recargo del proveedor. La pantalla muestra la última transcripción incluso si la activación o la respuesta fallan. Kady dice una respuesta corta en inglés, un consejo breve en español y un ejemplo práctico en inglés con una voz femenina de ElevenLabs; la traducción del ejemplo queda visible en pantalla. Se requiere `ELEVENLABS_API_KEY` en el servidor para transcripción y voz, además de `OPENAI_API_KEY` para la respuesta de Kady. `ELEVENLABS_VOICE_ID` permite fijar una voz femenina concreta; si está vacío, la app elige una voz femenina disponible. No pongas las claves en JavaScript ni en el repositorio.

La interfaz de inglés muestra una esfera de luz generada localmente con Canvas. Indica reposo, escucha, procesamiento y respuesta. Sus filamentos reaccionan al micrófono y al volumen del audio de Kady mediante Web Audio; también funciona con los temas claro/oscuro y respeta la preferencia de reducir movimiento.

## Despliegue en Railway

Cada materia tiene un diagnóstico inicial de seis preguntas, agrupadas en tres temas. Cálculo, JavaScript y liderazgo se basan en los PDF disponibles; inglés evalúa gramática escrita. La calificación se calcula en el servidor sin llamadas a la IA. Los resultados orientativos incluyen explicación de errores, temas de repaso y páginas del material, y ayudan a Kady a adaptar la tutoría. El panel muestra el último diagnóstico de cada materia; repetirlo reemplaza ese resultado.

Los diagnósticos se guardan por cuenta en SQLite (`instance/diagnostics.sqlite3`, ignorado por Git), independientemente de MySQL. En producción, asigna `DIAGNOSTICS_DB_PATH` a una ruta de un volumen persistente y respalda ese archivo. Para varias réplicas, usa un almacén compartido antes de escalar; un archivo local es adecuado para el servidor local y una sola instancia con volumen.

El `Dockerfile` ejecuta `scripts/init_db.py` antes de iniciar Gunicorn. Configura `APP_ENV=production`, una `SECRET_KEY` aleatoria y las variables `MYSQL_*` mediante referencias privadas al servicio MySQL de Railway. `OPENAI_API_KEY` y las variables de Gmail son opcionales para el arranque, pero necesarias para la tutoría y el correo de confirmación.

Para crear un usuario inicial puede definirse temporalmente `BOOTSTRAP_DEMO_PASSWORD` junto con `BOOTSTRAP_DEMO_USERNAME`, `BOOTSTRAP_DEMO_EMAIL` y `BOOTSTRAP_DEMO_ROLE` (`alumno` o `maestro`). Elimina esas variables después del primer despliegue; la cuenta queda guardada con bcrypt en MySQL.

## Seguridad

Consulta `SECURITY_AUDIT.md`. Antes de desplegar, rota las credenciales que aparecieron en versiones anteriores del repositorio.

## Pruebas locales

Ejecuta `.venv\Scripts\python.exe -m unittest discover -s tests -v` para las rutas del servidor y `node --test tests/test_english_voice.js` para activación, conversación continua, pausas, reintentos y cancelación de la escucha. Estas pruebas usan respuestas simuladas y no consumen créditos de las API.
