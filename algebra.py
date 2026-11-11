"""Recorrido, evaluación e historial privado de álgebra. No depende de una API de IA."""
from __future__ import annotations

import json
import random
import secrets
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from algebra_initial import INITIAL_TOPICS, questions as initial_questions
from algebra_content import LEVELS, TOPICS, TOPIC_MAP, check_answer, make_question, parse_number


class LearningError(ValueError):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


@contextmanager
def database(path):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path, timeout=10)
    connection.row_factory = sqlite3.Row
    try:
        connection.execute("""CREATE TABLE IF NOT EXISTS algebra_attempts (
            id TEXT PRIMARY KEY, student TEXT NOT NULL, topic TEXT NOT NULL,
            mode TEXT NOT NULL, level TEXT NOT NULL, kind TEXT NOT NULL,
            created TEXT NOT NULL, completed TEXT, payload TEXT NOT NULL, result TEXT)""")
        connection.execute("CREATE INDEX IF NOT EXISTS idx_algebra_student ON algebra_attempts(student, topic, created)")
        connection.commit()
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def _now():
    return datetime.now(timezone.utc).isoformat()


def _rows(connection, student):
    return connection.execute(
        "SELECT * FROM algebra_attempts WHERE student = ? AND completed IS NOT NULL ORDER BY created, id",
        (student,)).fetchall()


def _progress(connection, student):
    rows = _rows(connection, student)
    initial = next((json.loads(row["result"]) for row in rows if row["mode"] == "inicial"), None)
    credited = initial.get("temas_acreditados", []) if initial else []
    records = []
    previous_passed = True
    for topic in TOPICS:
        attempts = [row for row in rows if row["topic"] == topic["id"]]
        finals = [json.loads(row["result"]) for row in attempts if row["mode"] == "final"]
        diagnostics = [json.loads(row["result"]) for row in attempts if row["mode"] == "diagnostico"]
        accredited = topic["id"] in credited
        best = max((item["porcentaje"] for item in finals), default=100 if accredited else None)
        passed = best is not None and best >= 75
        # La recomendación usa varios reactivos registrados, sin etiquetar dificultades permanentes.
        recent = attempts[-5:]
        answered = sum(json.loads(row["result"])["total"] for row in recent)
        correct = sum(json.loads(row["result"])["aciertos"] for row in recent)
        recommendation = "basico"
        if answered >= 5:
            ratio = correct / answered
            last_level = recent[-1]["level"]
            position = list(LEVELS).index(last_level)
            if ratio >= .8:
                position = min(2, position+1)
            elif ratio <= .4 and answered-correct >= 2:
                position = max(0, position-1)
            recommendation = list(LEVELS)[position]
        if initial and topic["id"] in INITIAL_TOPICS and not diagnostics:
            revision = [q for q in initial["revision"] if q.get("tema") == topic["id"]]
            diagnostics = [{"porcentaje": sum(q["acierto"] for q in revision) * 100 / len(revision)}]
        if accredited:
            recommendation = "avanzado"
        records.append({**topic, "acreditado_inicial": accredited, "habilitado": previous_passed, "aprobado": passed,
                        "mejor_final": best, "diagnostico": diagnostics[-1] if diagnostics else None,
                        "intentos_finales": len(finals), "nivel_recomendado": recommendation,
                        "reactivos_registrados": answered,
                        "recomendacion": "Ya dominas las bases. Prueba un reto avanzado o repasa cuando quieras." if accredited else "Practica de nuevo y revisa los ejemplos." if answered >= 5 and answered-correct >= 2 else "Sigue reuniendo evidencia con la práctica."})
        previous_passed = previous_passed and passed
    return records


def progress(path, student):
    with database(path) as connection:
        return _progress(connection, student)


def _public_attempt(row):
    payload = json.loads(row["payload"])
    questions = []
    for index, question in enumerate(payload["preguntas"]):
        questions.append({"id": index, **{key: value for key, value in question.items()
                                         if key not in {"correcta", "pasos", "pista"}}})
    response = {"id": row["id"], "tema": row["topic"], "modo": row["mode"],
                "nivel": row["level"], "tipo": row["kind"], "preguntas": questions,
                "completado": row["completed"] is not None}
    if row["result"]:
        response["resultado"] = json.loads(row["result"])
    elif row["mode"] == "practica" and payload["respuestas"]:
        response["pista"] = payload["preguntas"][0]["pista"]
        response["primer_intento"] = payload["respuestas"][0]
    return response


def start_attempt(path, student, topic, mode, level, kind):
    if topic not in TOPIC_MAP or mode not in {"diagnostico", "final", "practica"} or level not in LEVELS:
        raise LearningError("Tema, modalidad o dificultad inválidos.")
    if mode != "practica":
        kind = "opcion_multiple"
    if kind not in TOPIC_MAP[topic]["tipos"]:
        raise LearningError("Este tipo de ejercicio no está disponible para el tema.")
    with database(path) as connection:
        connection.execute("BEGIN IMMEDIATE")
        state = next(item for item in _progress(connection, student) if item["id"] == topic)
        if not state["habilitado"]:
            raise LearningError("Aprueba el tema anterior con al menos 75% para comenzar este recorrido.", 409)
        if mode in {"practica", "final"} and not state["diagnostico"]:
            raise LearningError("Completa primero el diagnóstico de cinco preguntas del tema.", 409)
        pending = connection.execute(
            "SELECT * FROM algebra_attempts WHERE student = ? AND topic = ? AND mode = ? AND level = ? AND kind = ? "
            "AND completed IS NULL ORDER BY created DESC LIMIT 1", (student, topic, mode, level, kind)).fetchone()
        if pending:
            return _public_attempt(pending)
        count = {"diagnostico": 5, "final": 10, "practica": 1}[mode]
        rng = random.Random(secrets.randbits(128))
        questions = []
        seen = set()
        for _ in range(1000):
            question = make_question(topic, level, kind, rng)
            if question["enunciado"] not in seen:
                questions.append(question)
                seen.add(question["enunciado"])
            if len(questions) == count:
                break
        if len(questions) != count:
            raise LearningError("No pudimos preparar suficientes preguntas distintas. Intenta de nuevo.", 503)
        attempt_id = uuid.uuid4().hex
        connection.execute("INSERT INTO algebra_attempts (id,student,topic,mode,level,kind,created,payload) VALUES (?,?,?,?,?,?,?,?)",
                           (attempt_id, student, topic, mode, level, kind, _now(),
                            json.dumps({"version": 1, "preguntas": questions, "respuestas": []}, ensure_ascii=False)))
        return _public_attempt(connection.execute("SELECT * FROM algebra_attempts WHERE id = ?", (attempt_id,)).fetchone())


def _owned(connection, student, attempt_id):
    row = connection.execute("SELECT * FROM algebra_attempts WHERE id = ? AND student = ?", (attempt_id, student)).fetchone()
    if row is None:
        raise LearningError("Actividad no encontrada.", 404)
    return row


def _valid_answer(question, answer):
    if question["tipo"] == "relacionar":
        return isinstance(answer, list) and len(answer) == len(question["correcta"]) and all(
            isinstance(value, str) and value in question["opciones"] for value in answer)
    if not isinstance(answer, str) or not answer.strip() or len(answer) > 60:
        return False
    return answer in question["opciones"] if question["tipo"] == "opcion_multiple" else parse_number(answer) is not None


def submit_attempt(path, student, attempt_id, answers, procedure=""):
    if not isinstance(procedure, str) or len(procedure) > 4000:
        raise LearningError("El procedimiento debe tener como máximo 4000 caracteres.")
    with database(path) as connection:
        connection.execute("BEGIN IMMEDIATE")
        row = _owned(connection, student, attempt_id)
        if row["completed"]:
            return {"completado": True, "resultado": json.loads(row["result"])}
        payload = json.loads(row["payload"])
        questions = payload["preguntas"]
        if not isinstance(answers, list) or len(answers) != len(questions) or not all(
                _valid_answer(question, answer) for question, answer in zip(questions, answers)):
            raise LearningError("Contesta todos los ejercicios. Usa las opciones o un resultado numérico como 3, -2 o 1/2; no podemos verificar una respuesta en otro formato.")
        correct = [(answer == question["correcta"] if row["mode"] == "inicial" else check_answer(question, answer)) for question, answer in zip(questions, answers)]
        payload["respuestas"].append({"fecha": _now(), "valores": answers,
                                      "procedimiento": procedure, "aciertos": correct})
        if row["mode"] == "practica" and not all(correct) and len(payload["respuestas"]) == 1:
            connection.execute("UPDATE algebra_attempts SET payload = ? WHERE id = ?",
                               (json.dumps(payload, ensure_ascii=False), attempt_id))
            return {"completado": False, "pista": questions[0]["pista"],
                    "mensaje": "Revisa esta pista e intenta de nuevo antes de ver la solución."}
        score = sum(correct)
        percent = score * 100 / len(questions)
        passed = row["mode"] == "final" and percent >= 75
        result = {"aciertos": score, "total": len(questions), "porcentaje": percent,
                  "aprobado": passed, "intentos_respuesta": len(payload["respuestas"]),
                  "mensaje": ("Tema aprobado. Puedes avanzar al siguiente." if passed else
                              "Practica con las pistas y los ejemplos antes de repetir la evaluación." if row["mode"] == "final" else
                              "Usa este resultado para elegir tu siguiente práctica; no define tu capacidad."),
                  "revision": [{"enunciado": q["enunciado"], "respuesta": a, "correcta": q["correcta"],
                                "acierto": ok, "pasos": q["pasos"], "tema": q.get("tema", row["topic"]), "ecuacion": q.get("ecuacion", "")} for q, a, ok in zip(questions, answers, correct)]}
        if row["mode"] == "inicial":
            result["temas_acreditados"] = INITIAL_TOPICS if all(correct) else []
            result["aprobado"] = all(correct)
            result["mensaje"] = ("¡Excelente! Acertaste las 12 preguntas. Quedan acreditados los cuatro temas hasta multiplicación y división de expresiones. Puedes seguir con productos notables; también te propongo retos avanzados para consolidar lo que sabes. ¡Vas muy bien!" if all(correct) else
                "¡Gracias por intentarlo! Este resultado es nuestro punto de partida, no un límite. Repasaremos juntos lo que todavía cuesta, paso a paso y sin prisa. Cada intento te acerca a comprenderlo mejor.")
        connection.execute("UPDATE algebra_attempts SET payload = ?, completed = ?, result = ? WHERE id = ?",
                           (json.dumps(payload, ensure_ascii=False), _now(), json.dumps(result, ensure_ascii=False), attempt_id))
        return {"completado": True, "resultado": result}


def history(path, student):
    with database(path) as connection:
        rows = connection.execute("SELECT * FROM algebra_attempts WHERE student = ? ORDER BY created DESC, id DESC LIMIT 100",
                                  (student,)).fetchall()
        return [{"id": row["id"], "tema": row["topic"], "titulo": "Mi punto de partida" if row["mode"] == "inicial" else TOPIC_MAP[row["topic"]]["titulo"],
                 "modo": row["mode"], "nivel": row["level"], "fecha": row["created"],
                 "completado": row["completed"] is not None,
                 "resultado": json.loads(row["result"]) if row["result"] else None} for row in rows]


def attempt_detail(path, student, attempt_id):
    with database(path) as connection:
        row = _owned(connection, student, attempt_id)
        detail = _public_attempt(row)
        detail["respuestas"] = json.loads(row["payload"])["respuestas"]
        return detail


def initial_state(path, student, start=False):
    with database(path) as connection:
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute("SELECT * FROM algebra_attempts WHERE student=? AND mode='inicial' ORDER BY created LIMIT 1", (student,)).fetchone()
        if row:
            return _public_attempt(row)
        if not start:
            return None
        attempt_id = uuid.uuid4().hex
        initial_items = initial_questions()
        rng = random.Random(secrets.randbits(128))
        for question in initial_items:
            choices = question["opciones"][:-1]
            rng.shuffle(choices)
            question["opciones"] = [*choices, "No lo sé todavía"]
        connection.execute("INSERT INTO algebra_attempts (id,student,topic,mode,level,kind,created,payload) VALUES (?,?,?,?,?,?,?,?)",
            (attempt_id, student, "expresiones", "inicial", "basico", "opcion_multiple", _now(),
             json.dumps({"version": 1, "preguntas": initial_items, "respuestas": []}, ensure_ascii=False)))
        return _public_attempt(connection.execute("SELECT * FROM algebra_attempts WHERE id=?", (attempt_id,)).fetchone())
