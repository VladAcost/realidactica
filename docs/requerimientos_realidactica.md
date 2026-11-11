# Análisis y desarrollo de los requerimientos de Realidáctica

Fecha de revisión: 1 de noviembre de 2026. Fuente: `Requerimientos_Realidactica - copia.docx`, versión 2.0, actualizado el 28 de octubre de 2026 y marcado como borrador para revisión. El documento original se conserva sin modificaciones.

El proyecto necesita dos recorridos conectados: aprendizaje de álgebra para estudiantes y gestión de actividades para docentes. La aplicación existente aporta autenticación, roles, materiales y tutoría, pero no implementaba el curso de álgebra ni el ciclo de tareas. Esta entrega incorpora una primera versión funcional del recorrido de álgebra y de las gráficas. RF-001 sigue siendo parcial y RF-003 a RF-007 quedan pendientes de implementación.

## Comparación con el código inicial

La revisión partió del commit `6fdb8a4`. Las 22 pruebas de Python existentes pasaron antes de los cambios.

| Requisito | Situación inicial comprobada | Resultado de esta entrega |
| --- | --- | --- |
| RF-001 Ayuda de Kady para aprender álgebra | Tutoría y diagnósticos de 6 preguntas para otras cuatro materias; sin los diez temas, evaluación final, umbral de avance ni historial completo de álgebra | Base funcional de los diez temas, diagnóstico de 5, final de 10, seis formatos según aplicabilidad, pistas, resultados e historial; falta la tutoría conversacional de álgebra y otras capacidades descritas abajo |
| RF-002 Mostrar gráficamente una ecuación | Sin graficador de ecuaciones | Implementado para constantes, rectas y parábolas en x, con explicación y tabla de puntos; sintaxis y dominio explícitos |
| RF-003 Crear actividades con ayuda de IA | `/generar_test` crea cinco preguntas de otras materias; no guarda borradores ni tiene revisión docente | Diseño definido; pendiente el generador docente y su flujo de revisión y publicación |
| RF-004 Agregar explicaciones a tareas | No hay modelo de tarea ni explicación adicional revisable | Diseño definido; pendiente |
| RF-005 Crear y publicar tareas | Portal para subir PDF y asignarlo a un grupo; no equivale a una tarea con título, instrucciones, fecha y destinatarios | Diseño definido; pendiente |
| RF-006 Entregar tareas | La subida existente es para materiales del docente; no registra entregas de alumnos | Diseño definido; pendiente |
| RF-007 Reportar avance por alumno | Panel docente con conteos generales; no hay reporte individual basado en evidencias | Historial individual de álgebra disponible solo para el propio alumno; reportes docentes pendientes |

El esquema contiene `usuarios`, `grupos` y `grupo_alumno`, pero carece de una relación explícita entre docentes y grupos. Las consultas de grupos y conteos docentes existentes tienen alcance general. Antes de conectar tareas o reportes privados hay que introducir esa relación y filtrar cada consulta y descarga por ella. Tener rol `maestro` por sí solo no acredita pertenencia a cualquier grupo.

## RF-001 Aprendizaje de álgebra

El recorrido incluye exactamente los diez temas del Word, en el orden indicado: lenguaje y expresiones, signos, suma y resta, multiplicación y división, productos notables, factorización, ecuaciones lineales, cuadráticas, sistemas y representación gráfica.

Flujo implementado:

1. El alumno entra desde su panel a **Álgebra con Kady**, en `/algebra`.
2. Puede leer las explicaciones y ejemplos de cualquiera de los diez temas.
3. Inicia el diagnóstico de cinco preguntas del primer tema disponible. El diagnóstico orienta la práctica; no aprueba el tema.
4. Elige una dificultad y un tipo de práctica aplicable. Si falla, recibe una pista y un segundo intento antes de ver la solución.
5. Realiza una evaluación final de diez preguntas distintas. El servidor comprueba las respuestas y guarda el resultado.
6. Con una calificación de al menos 75% se habilitan las actividades del siguiente tema. Con menos, se recomienda refuerzo y se puede repetir sin cronómetro.
7. Consulta o retoma actividades desde su historial; las evaluaciones anteriores se conservan.

Con diez preguntas de igual valor, 7/10 es 70% y 8/10 es 80%. El umbral sigue siendo `porcentaje >= 75`; no se redondea 70 para aprobar. Una vez aprobado un tema, un intento posterior menor no revoca lo aprendido ni bloquea de nuevo el recorrido.

La versión inicial interpreta el avance como un recorrido secuencial de actividades, manteniendo libre la consulta de todas las explicaciones. Esta es una decisión de implementación: el Word permite seleccionar cualquier tema y también exige aprobar para avanzar. Si posteriormente se quiere que el docente habilite temas de forma independiente, habrá que sustituir el prerrequisito secuencial por habilitaciones explícitas por grupo.

### Formatos y comprobación matemática

| Formato | Implementación | Límite actual |
| --- | --- | --- |
| Opción múltiple | Cuatro opciones distintas, sin respuesta correcta enviada antes de contestar | Banco generado con plantillas; no cubre todos los objetivos de cada tema |
| Completar espacios | Respuesta numérica, con enteros, decimales o fracciones equivalentes | No acepta expresiones simbólicas completas |
| Resolver con procedimiento | Guarda el procedimiento escrito y verifica el resultado numérico; muestra pasos de referencia | No comprueba la validez de cada paso libre; CA2 permanece parcial |
| Relacionar | Tres ejercicios y tres resultados; compara cada relación en el servidor | Se registra el conjunto como un ejercicio de práctica |
| Interpretar gráficas | Gráfica de una recta o parábola y pregunta sobre una coordenada | Disponible en lineales, cuadráticas y representación gráfica |
| Problema cotidiano | Contextos de compras, saldos, transporte, cajas y crecimiento | Disponible en expresiones, signos, lineales, sistemas y gráficas |

Los tres niveles varían por ahora el rango numérico de las plantillas. El alumno puede elegirlos y la plataforma sugiere cambios usando varios reactivos registrados. Se requiere ampliar y revisar el banco con un docente para diferenciar profundidad conceptual, tipos de procedimiento y objetivos curriculares por nivel. Aumentar números no basta para dar por terminada la adaptación pedagógica.

Las respuestas de las plantillas se calculan mediante operaciones deterministas. El cliente no decide la calificación. Las fracciones se comparan exactamente y no se utiliza una respuesta de IA como autoridad de calificación. Si un texto libre no puede verificarse en el formato admitido, el servidor lo indica y permite corregirlo, sin registrar automáticamente un error matemático.

La recomendación considera hasta cinco actividades completadas del tema y al menos cinco reactivos. Recomienda subir un nivel con 80% o más; bajar un nivel con 40% o menos y al menos dos reactivos incorrectos. Son reglas iniciales y reversibles para sugerir práctica, no una clasificación permanente del alumno. Debe añadirse evaluación por habilidad y errores repetidos entre varias actividades para completar RF-007.

### Trazabilidad de los criterios de RF-001

| Criterio del Word | Cobertura en esta entrega |
| --- | --- |
| CA1 Seleccionar los diez temas y recibir explicación | Cubierto con contenido de referencia local; falta conversación específica de álgebra |
| CA2 Ejemplos por pasos y seis tipos aplicables | Parcial: ejemplos y formatos; falta evaluar procedimientos libres y ampliar cobertura conceptual |
| CA3 Tres dificultades y recomendaciones | Parcial: selección, rango numérico y recomendación inicial; falta adaptación pedagógica más completa |
| CA4 Diagnóstico de 5 y adaptación | Parcial: diagnóstico, historial y nivel recomendado; las explicaciones de referencia aún son comunes |
| CA5 Final de 10 y calificación | Cubierto para el banco actual |
| CA6 Umbral de 75% y refuerzo | Cubierto: avance en el servidor, reintentos y acceso a práctica con pistas |
| CA7 Pista, segundo intento y explicación | Cubierto en la práctica; las evaluaciones muestran revisión al terminar |
| CA8 Texto, fotografía, visuales y voz | Parcial: respuestas escritas y gráficas; faltan conversación abierta, fotografía y voz de álgebra |
| CA9 Temas, respuestas, calificaciones y dificultades | Parcial: conserva actividades, respuestas, procedimientos y resultados; falta seguimiento por habilidad y conversación |
| CA10 Configuración y aprobación docente | Pendiente, depende de RF-003 y RF-005 |
| CA11 Reportes individuales y grupales | Pendiente para docentes, depende de RF-007 y permisos de grupo |
| CA12 Privacidad entre alumnos | Cubierto en las nuevas rutas de álgebra; se deriva la identidad de la sesión y se valida pertenencia de cada intento |
| CA13 Avisar cuando no pueda verificar | Cubierto para formatos numéricos y ecuaciones no admitidas; falta extenderlo a la conversación y a fotografías |

Para completar la tutoría de álgebra, Kady deberá recibir el tema permitido, contenido de referencia revisado, diagnóstico y resumen de evidencias del alumno. Las explicaciones generadas necesitarán reconocer incertidumbre, ofrecer pistas y distinguir resultados comprobados de interpretación. La recepción de fotografías requiere validación de imagen y confirmación de la transcripción de la ecuación antes de calificarla. La voz de inglés existente puede servir de referencia técnica, pero aún no está integrada a álgebra.

## RF-002 Gráficas de ecuaciones

El alumno escribe expresiones como `y = 2x + 1`, `y = x^2 - 4`, `y = (x - 2)**2`, `y = x/2` o `y = 3`. El servidor genera los puntos en el intervalo de x de -10 a 10 y una explicación basada en los mismos coeficientes que utiliza el dibujo.

La interfaz muestra ejes, escala, curva, pendiente o vértice y una tabla de referencia. La explicación y la tabla permiten consultar la información sin depender solo del dibujo. También se puede usar el graficador al explorar un tema que todavía no tiene actividades habilitadas.

El analizador admite únicamente constantes, x, operaciones aritméticas permitidas, división entre una constante distinta de cero y potencias que mantengan el grado máximo en dos. Tiene límites de tamaño y coeficientes. No ejecuta el texto del usuario. Rechaza código, funciones, división entre x, potencias superiores y formatos desconocidos, e informa cómo corregirlos.

Se consideran cubiertos CA1 y CA2 dentro de este formato reconocible, que el Word deja por definir. La primera versión no representa ecuaciones implícitas, rectas verticales `x = c`, funciones racionales o trigonométricas, sistemas simultáneos ni permite desplazar y ampliar el intervalo. Agregar estas funciones exige definir su sintaxis y sus discontinuidades antes de ampliar el graficador.

## RF-003 Actividades propuestas por Kady

Pendiente de implementación. Se necesita un editor docente que reciba tema de los diez autorizados, grado escolar, dificultad, cantidad de 1 a 30 ejercicios y tipos aplicables. El límite de 30 es una propuesta operativa, no una cifra del Word. Las categorías baja, media y alta se mapearán a básico, intermedio y avanzado para usar un solo vocabulario interno.

El servicio de IA devolverá una estructura validada con título, instrucciones, ejercicios, claves, procedimientos y referencias al contenido autorizado. La cantidad, el tema, la dificultad y el tipo se comprobarán en el servidor. Los cálculos verificables se revisarán con el motor matemático; un resultado no comprobable se marcará para revisión.

La actividad tendrá estados `borrador`, `revisada` y `publicada`. El docente podrá editar instrucciones, modificar ejercicios, eliminarlos y volver a comprobarlos. La generación nunca publica automáticamente. Cambiar una actividad revisada invalida su aprobación. La publicación requiere una revisión explícita, pertenencia al grupo y una versión concreta de la actividad.

Pruebas de aceptación necesarias: rechazar temas desconocidos y cantidades fuera de rango; guardar un borrador ante una propuesta válida; permitir quitar o cambiar ejercicios; impedir publicación sin revisión; impedir consultar o publicar el borrador de otro docente; mostrar un fallo recuperable si la IA no está disponible.

## RF-004 Explicaciones adicionales a tareas

Pendiente de implementación. Las instrucciones originales y la explicación de Kady deben ser campos separados y versionados. Kady recibirá las instrucciones suficientes y el contexto del tema para proponer propósito, pasos y un ejemplo. Si falta información, solicitará al docente que la complete.

La explicación podrá editarse, regenerarse o quitarse. Su generación no modificará las instrucciones ni publicará la tarea. La pantalla del alumno presentará primero las instrucciones del profesor y después el apoyo adicional aprobado. No se puede garantizar que un modelo jamás contradiga un texto; por eso son necesarios la comparación visible y la revisión docente.

Pruebas de aceptación necesarias: conservar literalmente las instrucciones al generar apoyo; poder editar o eliminar la explicación; invalidar la revisión cuando cambian las instrucciones; publicar solo la versión aprobada; manejar información insuficiente y fallos del servicio sin perder el borrador.

## RF-005 Creación y publicación de tareas

Pendiente de implementación. El formulario debe tener título, instrucciones, tema opcional, fecha opcional, grupo o alumnos específicos, adjunto opcional y configuración de intentos de entrega. Una tarea manual podrá usar el mismo flujo de revisión sin exigir que se genere con IA.

El servidor obtendrá los destinatarios a partir de los grupos autorizados del docente. Guardar un ID de grupo enviado por el navegador no es prueba de autorización. La publicación guardará una versión y destinatarios explícitos; los alumnos solo podrán listar, abrir y descargar tareas que les correspondan. Un alumno añadido a un grupo después de publicar no debería recibir tareas anteriores de manera implícita sin una decisión de reasignación.

Se propone guardar las fechas en UTC y mostrarlas en la zona del grupo, inicialmente `America/Mexico_City`. Editar una tarea publicada debe crear una versión y un aviso visible de actualización, sin cambiar las instrucciones asociadas a una entrega previa. Se propone que la fecha marque una entrega como tardía y que el cierre de recepción sea una opción explícita del profesor. Son decisiones por validar con el equipo.

Pruebas de aceptación necesarias: crear, guardar, revisar y publicar; asignar solo a alumnos del grupo; comprobar una fecha válida; impedir que otro docente modifique la tarea; ocultar borradores al alumno; mostrar título, instrucciones, apoyo aprobado y fecha; avisar en pantalla de tareas nuevas o actualizadas.

## RF-006 Entregas del alumno

Pendiente de implementación. Una entrega debe contener texto o un archivo aceptado, o ambos. No se aceptará una entrega vacía. El ID del alumno debe derivarse de la sesión; el servidor comprobará la asignación, la versión de tarea, el plazo y los intentos permitidos antes de almacenar el trabajo.

Se propone admitir PDF, JPEG, PNG y DOCX, con un límite de 15 MB coherente con el máximo general actual. Deben verificarse tamaño, extensión y contenido real; el atributo MIME del navegador no basta. Los archivos se guardarán con nombres aleatorios en almacenamiento privado. Todas las descargas deberán volver a comprobar que el usuario es el alumno propietario o un docente autorizado para la tarea. La foto adjunta a una entrega y la foto para consultar a Kady son funciones distintas.

Cada intento conservará texto, metadatos de archivo, fecha, condición de tardío y versión de tarea. El alumno recibirá un folio y fecha de recepción después de confirmar el guardado. Se necesita una clave de idempotencia para que un reintento de red no consuma otro intento. Un fallo al guardar archivo o registro no debe devolver una confirmación de éxito.

Pruebas de aceptación necesarias: entregar texto; entregar un archivo válido; rechazar vacíos, tamaño excesivo y formatos no permitidos; impedir entregar una tarea ajena; respetar el máximo de intentos; evitar duplicados de red; permitir al docente abrir solo entregas autorizadas; conservar la versión anterior al reenviar.

## RF-007 Reportes de avance

Pendiente de implementación. El primer reporte debe calcular sus datos directamente de intentos, respuestas y entregas: temas aprobados, fechas, resultados diagnósticos, mejor y último resultado final, número de intentos y tareas entregadas o pendientes. La vista grupal agregará exclusivamente datos de sus miembros autorizados. Un periodo opcional deberá aplicarse también a las evidencias y al resumen.

Los errores deben vincularse a habilidades de los reactivos. Se propone mostrar una señal de repaso solo con al menos cinco reactivos de una habilidad y errores en dos actividades distintas. Esta propuesta es más exigente que la recomendación inicial por tema del módulo actual y requiere etiquetas de habilidad en el banco. Con pocas evidencias se mostrará «información insuficiente»; sin actividades se mostrará un estado vacío, no una calificación de cero.

La IA podrá resumir los agregados comprobados y sugerir práctica, pero no calculará las cifras oficiales ni inventará causas o diagnósticos. Cada sugerencia debería poder vincularse a las actividades que la sustentan.

Pruebas de aceptación necesarias: alumno y periodo correctos; coincidencia entre sumas y evidencias; exclusión de alumnos ajenos; tratamiento de ausencia de datos; ausencia de etiquetas permanentes a partir de un error aislado; ausencia de respuestas y calificaciones de otros grupos en API, pantalla y exportación.

## Modelo de datos para continuar

| Entidad propuesta | Datos principales y relación |
| --- | --- |
| `docente_grupo` | Docente y grupo, ambos con claves foráneas; asignación gestionada por personal autorizado |
| `actividades` y `actividad_versiones` | Autor, tema, grado, dificultad, estado, ejercicios, instrucciones, apoyo y revisión de cada versión |
| `tareas` | Versión publicada, fecha de entrega, política de cierre y máximo de intentos |
| `tarea_destinatarios` | Tarea y alumno autorizado; destinatarios comprobados al publicar |
| `entregas` | Tarea, versión, alumno, número de intento, texto, fecha y folio; clave de idempotencia única |
| `archivos_privados` | Propietario, uso, nombre original, identificador de almacenamiento, tamaño, formato y huella |
| `reactivos` y `respuestas` | Tema, habilidad, versión, dificultad, clave validada, respuesta, intentos y resultado |
| `eventos_academicos` | Publicaciones, revisiones y cambios de destinatarios para reconstruir el estado que vio el alumno |

El módulo inicial de álgebra usa `algebra_attempts` en SQLite con identidad, tema, modalidad, nivel, preguntas, respuestas, procedimientos, resultado y fechas. Se almacena la versión de cada actividad junto con sus claves en el servidor. Se puede conservar para una sola instancia con volumen y respaldos. Antes de usar varias réplicas o conectar reportes institucionales debe migrarse a un almacenamiento compartido y relacionar identidades con usuarios de MySQL.

Las relaciones anteriores son un diseño de continuación. Esta entrega no crea tablas docentes vacías ni ejecuta migraciones sobre las bases del usuario.

## API disponible y organización del código

| Ruta | Función y acceso |
| --- | --- |
| `GET /algebra` | Aula del alumno |
| `GET /api/algebra/progreso` | Explicaciones y avance de la cuenta actual |
| `POST /api/algebra/intentos` | Crear o retomar diagnóstico, práctica o final |
| `POST /api/algebra/intentos/<id>/respuestas` | Comprobar y guardar respuestas; pista y segundo intento en práctica |
| `GET /api/algebra/intentos/<id>` | Consultar o retomar un intento propio |
| `GET /api/algebra/historial` | Hasta los 100 intentos más recientes de la cuenta |
| `POST /api/algebra/grafica` | Validar una ecuación y obtener puntos y explicación |

Todas las rutas requieren cuenta de alumno. Las operaciones POST reutilizan la protección CSRF existente. Ninguna acepta una identidad de alumno suministrada por el cliente como autorización. Un intento ajeno responde como no encontrado.

`algebra_content.py` contiene la base de conocimiento, plantillas y comprobaciones matemáticas. `algebra.py` contiene evaluación, avance y persistencia. `algebra_routes.py` integra permisos y respuestas HTTP. `templates/algebra.html`, `static/algebra.css` y `static/js/algebra.js` implementan la interfaz. No se añadieron dependencias.

## Orden de las siguientes entregas

1. Permisos de grupos: asignación docente, membresía estudiantil y restricciones en todas las consultas existentes de grupos, materiales y métricas.
2. Tareas manuales de RF-005: borrador, revisión, publicación, destinatarios, versiones y avisos. Es la base que necesitan las actividades generadas.
3. Entregas de RF-006: respuesta, archivos privados, intentos, folio y revisión docente.
4. Asistencia docente de RF-003 y RF-004: generación estructurada, comprobación matemática, editor y aprobación sobre la base de tareas ya operativa.
5. Reportes de RF-007: evidencias de álgebra y entregas, filtros de grupo y periodo, habilidades y recomendaciones comprobables.
6. Completar RF-001: banco curricular revisado, adaptación conceptual, conversación contextual, validación de procedimientos, fotografías y voz.

Todas las prioridades figuran como altas en el Word. Este orden responde a dependencias: los reportes necesitan evidencia y permisos; las entregas necesitan tareas publicadas; las actividades de IA necesitan un editor y un flujo de aprobación. El graficador y la evaluación verificable ya pueden probarse mientras se desarrollan esas dependencias.

## Verificación y uso

Las 38 pruebas de Python pasan, incluidas 16 nuevas sobre álgebra: recorrido completo de diez temas y formatos aplicables, calificación real, frontera 7/10 frente a 8/10, prerrequisitos, reanudación, aislamiento de cuentas, concurrencia, persistencia y fallos de almacenamiento. También se comprobaron los puntos del graficador y el rechazo de código y expresiones fuera de alcance. Las ocho pruebas existentes de voz de JavaScript pasan.

Se probó el recorrido en un navegador local aislado: diagnóstico completo, pista y segundo intento, evaluación con 8/10, habilitación del tema siguiente, gráfica de una parábola y pantalla móvil de 390 px sin desbordamiento horizontal. No hubo errores de JavaScript durante ese recorrido. Estas pruebas validan el funcionamiento técnico; sigue pendiente la revisión pedagógica del contenido y una prueba con estudiantes y docentes.

Para probar con una cuenta de alumno, reinicia la aplicación con el flujo habitual de `scripts/start_local.ps1`, abre el panel y selecciona **Álgebra con Kady**. La base `instance/algebra.sqlite3` se crea al usar el módulo. En producción define `ALGEBRA_DB_PATH` en un volumen persistente y respalda el archivo. No se requiere una clave de IA para este banco inicial ni para las gráficas.

La disponibilidad 24/7 del Word expresa una intención operativa, no una garantía implementada. Para convertirla en un requisito medible hay que fijar un objetivo de disponibilidad, supervisión, respaldos probados, recuperación y comportamiento ante fallos de los proveedores.
