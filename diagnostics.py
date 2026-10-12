"""Brief diagnostics grounded in the course material, with server-side grading."""
from __future__ import annotations

import json
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def question(number, topic, prompt, options, answer, explanation, page=None):
    return {"id": number, "tema": topic, "pregunta": prompt,
            "opciones": dict(zip("ABCD", options)), "correcta": answer,
            "explicacion": explanation, "pagina": page}


DIAGNOSTICS = {
    "calculo": {
        "titulo": "Cálculo integral", "version": 1,
        "pdf": "clases/calculo/integrales.pdf",
        "temas": {
            "primitivas": ("Primitivas y significado", "Repasa la diferencia entre una primitiva y el valor de una integral definida. Comprueba una primitiva derivándola."),
            "limites": ("Evaluación y límites", "Practica F(b) − F(a). Escribe por separado la evaluación del límite superior y del inferior antes de restar."),
            "dobles": ("Integrales dobles", "Resuelve primero la integral interna manteniendo la otra variable constante. Usa ese resultado en la integral externa."),
        },
        "preguntas": [
            question(1, "primitivas", "¿Qué obtienes al resolver una integral definida entre dos límites?",
                     ["Un valor numérico", "Siempre una nueva función con + C", "La derivada de la función", "Siempre un valor negativo"], "A",
                     "La integral definida da un valor numérico. Una integral indefinida expresa una familia de primitivas.", 2),
            question(2, "primitivas", "¿Cuál de estas funciones es una primitiva de 2x?",
                     ["2", "2x", "x²", "x³ / 3"], "C",
                     "La derivada de x² es 2x; por eso x² es una primitiva de 2x.", 2),
            question(3, "limites", "Si F es una primitiva de f, ¿cómo se calcula la integral de f entre a y b?",
                     ["F(a) + F(b)", "F(a) − F(b)", "F(a) × F(b)", "F(b) − F(a)"], "D",
                     "La regla de Barrow evalúa la primitiva en el límite superior y resta su valor en el inferior.", 2),
            question(4, "limites", "¿Cuánto vale la integral de 2x desde x = 0 hasta x = 2?",
                     ["2", "4", "0", "8"], "B",
                     "Una primitiva es x². Al evaluar: 2² − 0² = 4, como en el ejemplo del documento.", 3),
            question(5, "dobles", "Al integrar x + y respecto de y en una integral doble, ¿cómo se trata x?",
                     ["Como una constante durante esa integración", "Se elimina de la expresión", "Se deriva respecto de y", "Se sustituye siempre por cero"], "A",
                     "En la integral interna respecto de y, x se mantiene constante: la primitiva es xy + y² / 2.", 3),
            question(6, "dobles", "La integral interna de x + y, con y entre 0 y 2, da 2x + 2. ¿Cuánto vale la integral externa entre x = 0 y x = 1?",
                     ["2", "4", "5", "3"], "D",
                     "La primitiva de 2x + 2 es x² + 2x. Al evaluar entre 0 y 1 se obtiene 1 + 2 = 3.", 4),
        ],
    },
    "frameworks": {
        "titulo": "Frameworks y JavaScript", "version": 1,
        "pdf": "clases/franworks/javascrip.pdf",
        "temas": {
            "fundamentos": ("JavaScript y bibliotecas", "Relaciona HTML con estructura, CSS con estilo y JavaScript con interacción. Revisa cómo una CDN entrega bibliotecas desde servidores distribuidos."),
            "formularios": ("Eventos y formularios", "Practica submit, preventDefault(), getElementById(), .value y .trim() en un formulario sencillo."),
            "impresion": ("Preparación de la impresión", "Prepara los datos en una tabla y revisa window.print() y @media print para ocultar los controles en el documento impreso."),
        },
        "preguntas": [
            question(1, "fundamentos", "¿Qué función cumple JavaScript frente a HTML y CSS en una página web?",
                     ["Sustituir todos los estilos de CSS", "Responder a acciones del usuario y dar interacción", "Servir únicamente para imprimir imágenes", "Definir solo la estructura del documento"], "B",
                     "HTML estructura, CSS da estilo y JavaScript añade comportamiento e interacción con el usuario.", 3),
            question(2, "fundamentos", "¿Qué describe mejor una CDN de JavaScript?",
                     ["Una base de datos del formulario", "Un método para guardar contraseñas", "Un editor instalado en el navegador", "Una red de servidores que entrega archivos desde ubicaciones cercanas al usuario"], "D",
                     "Una CDN distribuye bibliotecas o archivos estáticos para reducir latencia y mejorar la entrega.", 6),
            question(3, "formularios", "En el evento submit de un formulario, ¿qué hace event.preventDefault()?",
                     ["Evita el envío o la navegación predeterminada para ejecutar la lógica propia", "Borra todas las variables", "Valida automáticamente todas las credenciales", "Imprime el formulario"], "A",
                     "preventDefault() cancela la acción predeterminada. Las validaciones deben implementarse en la lógica del formulario.", 17),
            question(4, "formularios", "Para leer el campo con id='nombre' y quitar espacios al principio y al final, ¿qué expresión usarías?",
                     ["window.print('nombre')", "document.getElementById('nombre').reset()", "document.getElementById('nombre').value.trim()", "document.getElementById('nombre').placeholder"], "C",
                     "getElementById busca el elemento, .value lee lo escrito y .trim() elimina los espacios de los extremos.", 28),
            question(5, "impresion", "¿Qué hace window.print() en el proceso explicado en el material?",
                     ["Guarda los datos en un servidor", "Abre el diálogo de impresión del navegador", "Crea automáticamente una cuenta", "Modifica las columnas de una tabla"], "B",
                     "window.print() solicita el diálogo de impresión. Desde allí se puede imprimir o guardar como PDF si esa opción está disponible.", 22),
            question(6, "impresion", "¿Cómo ocultarías un botón solo al imprimir, manteniéndolo visible en pantalla?",
                     ["Borrando el botón del HTML", "Usando placeholder en el botón", "Cambiando el id del formulario", "Con @media print { .no-imprimir { display: none; } }"], "D",
                     "Las reglas de @media print se aplican al imprimir. display: none oculta el botón en ese contexto.", 29),
        ],
    },
    "liderazgo": {
        "titulo": "Liderazgo y comunicación", "version": 1,
        "pdf": "clases/liderazgo/1.4 Comunicación organizacional.pdf",
        "temas": {
            "proposito": ("Propósito y alcance", "Relaciona la comunicación con la coordinación y los objetivos comunes. Distingue mensajes internos de mensajes dirigidos a clientes o proveedores."),
            "flujos": ("Canales y flujos", "Clasifica ejemplos de comunicación formal e informal y de flujos ascendentes, descendentes y horizontales."),
            "liderazgo": ("Escucha y motivación", "Practica objetivos claros, escucha activa y retroalimentación constructiva. Reconoce cómo la comunicación influye en la motivación y la confianza."),
        },
        "preguntas": [
            question(1, "proposito", "¿Cuál es un propósito central de la comunicación organizacional?",
                     ["Coordinar actividades y alcanzar objetivos comunes", "Evitar toda retroalimentación", "Enviar mensajes sin comprobar su interpretación", "Sustituir la colaboración por órdenes aisladas"], "A",
                     "La comunicación permite transmitir, recibir e interpretar información para coordinarse y tomar decisiones.", 3),
            question(2, "proposito", "Un analista conversa con un cliente para aclarar requerimientos. ¿Qué alcance tiene esa comunicación?",
                     ["Solo interno", "Siempre informal", "Externo", "Exclusivamente horizontal"], "C",
                     "La comunicación externa se dirige a clientes, proveedores o usuarios finales; incluye el levantamiento de requerimientos.", 8),
            question(3, "flujos", "El equipo informa al líder de un bloqueo técnico. ¿Qué flujo de comunicación es?",
                     ["Descendente", "Ascendente", "Horizontal", "Externo"], "B",
                     "El flujo ascendente va de colaboradores hacia líderes. Informar de un bloqueo es el ejemplo del material.", 7),
            question(4, "flujos", "Un reporte técnico enviado por un canal institucional es un ejemplo de comunicación…",
                     ["Informal de pasillo", "Sin propósito", "Externa en todos los casos", "Formal"], "D",
                     "La comunicación formal usa canales oficiales y estructurados, como reportes técnicos y correos institucionales.", 6),
            question(5, "liderazgo", "Dos personas interpretan un requisito de forma distinta. ¿Qué acción del líder ayuda más?",
                     ["Escuchar ambas interpretaciones y aclarar el objetivo con lenguaje comprensible", "Ignorar la duda para ahorrar tiempo", "Usar más jerga sin confirmar comprensión", "Culpar a una persona sin escucharla"], "A",
                     "Un liderazgo efectivo comunica objetivos claros, traduce el lenguaje técnico y escucha activamente al equipo.", 9),
            question(6, "liderazgo", "Después de resolver una incidencia crítica, el líder reconoce públicamente el esfuerzo del equipo. ¿Qué favorece?",
                     ["La eliminación de la documentación", "La ausencia de nuevos objetivos", "La motivación y el sentido de pertenencia", "La sustitución de los canales formales"], "C",
                     "El reconocimiento del esfuerzo fortalece la motivación y la pertenencia, como muestra el ejemplo final.", 11),
        ],
    },
    "ingles": {
        "titulo": "Inglés con Kady", "version": 1, "pdf": None,
        "temas": {
            "presente": ("Presente y hábitos", "Practica el presente simple. Recuerda la -s con he/she/it y la diferencia entre have y has."),
            "pasado": ("Pasado y experiencias", "Repasa went como pasado de go. Usa had + participio para una acción anterior a otra acción pasada."),
            "estructuras": ("Condicionales y contraste", "Practica If I had…, I would… y despite + verbo en -ing con ejemplos de tu vida diaria."),
        },
        "preguntas": [
            question(1, "presente", "Choose the correct sentence.", ["She go to school.", "She goes to school.", "She going to school."], "B", "Con she, el presente simple lleva -s: She goes to school."),
            question(2, "presente", "I ___ breakfast at 7 every day.", ["have", "has", "having"], "A", "Con I usamos have. Has corresponde a he, she o it."),
            question(3, "pasado", "Yesterday, we ___ to the park.", ["go", "goes", "went"], "C", "Yesterday indica pasado. El pasado irregular de go es went."),
            question(4, "estructuras", "If I had more time, I ___ learn French.", ["will", "would", "am"], "B", "Una situación hipotética usa If + pasado y would + verbo."),
            question(5, "estructuras", "Despite ___ tired, she finished her work.", ["be", "was", "being"], "C", "Después de despite usamos un sustantivo o la forma -ing: despite being tired."),
            question(6, "pasado", "By the time we arrived, the film ___.", ["starts", "had started", "will start"], "B", "Had started indica que la película había empezado antes de que llegáramos."),
        ],
    },
}

ENGLISH_LEVELS = ("A1", "A1", "A2", "A2", "B1", "B1", "B2")


def public_quiz(subject: str) -> dict[str, Any]:
    bank = DIAGNOSTICS[subject]
    return {"materia": subject, "titulo": bank["titulo"], "version": bank["version"],
            "preguntas": [{key: item[key] for key in ("id", "pregunta", "opciones")}
                          for item in bank["preguntas"]]}


def evaluate(subject: str, answers: Any, version: Any = 1) -> dict[str, Any]:
    bank = DIAGNOSTICS[subject]
    if type(version) is not int or version != bank["version"]:
        raise ValueError("El cuestionario cambió. Actualiza la página y vuelve a intentarlo.")
    questions = bank["preguntas"]
    if not isinstance(answers, list) or len(answers) != len(questions):
        raise ValueError(f"Responde las {len(questions)} preguntas; puedes elegir «Aún no lo sé».")
    if any(not isinstance(answer, str) or answer.upper() not in {*item["opciones"], "?"}
           for answer, item in zip(answers, questions)):
        raise ValueError("Hay una respuesta inválida. Revisa las opciones del cuestionario.")
    selected = [answer.upper() for answer in answers]
    review = []
    topics = []
    for item, answer in zip(questions, selected):
        review.append({"id": item["id"], "pregunta": item["pregunta"], "tema": item["tema"],
                       "seleccionada": answer, "tu_respuesta": item["opciones"].get(answer, "Aún no lo sé"),
                       "correcta": item["correcta"], "respuesta_correcta": item["opciones"][item["correcta"]],
                       "acierto": answer == item["correcta"], "explicacion": item["explicacion"],
                       "pagina": item["pagina"]})
    for key, (name, recommendation) in bank["temas"].items():
        items = [item for item in review if item["tema"] == key]
        correct = sum(item["acierto"] for item in items)
        total = len(items)
        topics.append({"clave": key, "nombre": name, "aciertos": correct, "total": total,
                       "estado": "Buen manejo" if correct == total else "En práctica" if correct else "Por reforzar",
                       "prioridad": 2 if correct == total else 1 if correct else 0,
                       "recomendacion": recommendation,
                       "paginas": sorted({item["pagina"] for item in items if item["pagina"] is not None})})
    correct = sum(item["acierto"] for item in review)
    level = ENGLISH_LEVELS[correct] if subject == "ingles" else "Buen dominio" if correct >= 5 else "En desarrollo" if correct >= 3 else "Inicial"
    return {"materia": subject, "titulo": bank["titulo"], "version": bank["version"],
            "nivel": level, "aciertos": correct, "total": len(questions),
            "porcentaje": round(correct / len(questions) * 100), "temas": topics,
            "reforzar": [topic["nombre"] for topic in sorted(topics, key=lambda item: item["prioridad"]) if topic["prioridad"] < 2],
            "revision": review, "pdf": bank["pdf"],
            "actualizado": datetime.now(timezone.utc).isoformat(timespec="seconds")}


def _connect(db_path: str | Path):
    path = Path(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(str(path), timeout=5)
    try:
        connection.execute("""CREATE TABLE IF NOT EXISTS diagnosticos (
            alumno TEXT NOT NULL, materia TEXT NOT NULL, resultado TEXT NOT NULL,
            PRIMARY KEY (alumno, materia))""")
        connection.commit()
    except Exception:
        connection.close()
        raise
    return connection


def load_results(db_path: str | Path, student: str) -> dict[str, Any]:
    with closing(_connect(db_path)) as connection:
        rows = connection.execute("SELECT materia, resultado FROM diagnosticos WHERE alumno = ?", (student,)).fetchall()
    results = {subject: json.loads(result) for subject, result in rows}
    return {subject: result for subject, result in results.items()
            if subject in DIAGNOSTICS and result.get("version") == DIAGNOSTICS[subject]["version"]}


def save_result(db_path: str | Path, student: str, result: dict[str, Any]) -> None:
    with closing(_connect(db_path)) as connection:
        with connection:
            connection.execute("""INSERT INTO diagnosticos (alumno, materia, resultado) VALUES (?, ?, ?)
                ON CONFLICT(alumno, materia) DO UPDATE SET resultado = excluded.resultado""",
                (student, result["materia"], json.dumps(result, ensure_ascii=False)))
