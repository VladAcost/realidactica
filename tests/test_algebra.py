import json
import random
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import patch

import app as app_module
import algebra
from algebra_content import TOPICS, TOPIC_MAP, LEVELS, make_question, graph_equation, numeric_equal


class AlgebraTests(TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = str(Path(self.directory.name) / "algebra.sqlite3")
        self.app = app_module.app
        self.app.config.update(TESTING=True, SECRET_KEY="algebra-test", ALGEBRA_DB_PATH=self.path)
        self.client = self.app.test_client()
        self.login()

    def login(self, student=101, role="alumno", demo=False):
        with self.client.session_transaction() as session:
            session.clear()
            session.update(loggedin=True, user_id=student, user_rol=role, demo_account=demo,
                           user_name="Prueba", _csrf_token="csrf-test")

    def post(self, url, body):
        return self.client.post(url, json=body, headers={"X-CSRF-Token": "csrf-test"})

    def start(self, topic="expresiones", mode="diagnostico", kind="opcion_multiple", level="basico"):
        response = self.post("/api/algebra/intentos", {"tema": topic, "modo": mode, "tipo": kind, "nivel": level})
        self.assertEqual(response.status_code, 200, response.json)
        return response.json

    def private_questions(self, attempt):
        with closing(sqlite3.connect(self.path)) as connection:
            return json.loads(connection.execute("SELECT payload FROM algebra_attempts WHERE id = ?", (attempt["id"],)).fetchone()[0])["preguntas"]

    def answer(self, attempt, count=None):
        private = self.private_questions(attempt)
        answers = []
        for index, question in enumerate(private):
            answer = question["correcta"]
            if count is not None and index >= count:
                answer = next(option for option in question["opciones"] if option != answer)
            answers.append(answer)
        return self.post(f"/api/algebra/intentos/{attempt['id']}/respuestas", {"respuestas": answers})

    def test_student_page_and_all_ten_explanations(self):
        self.assertEqual(self.client.get("/algebra").status_code, 200)
        topics = self.client.get("/api/algebra/progreso").json["temas"]
        self.assertEqual(len(topics), 10)
        self.assertEqual(sum(topic["habilitado"] for topic in topics), 1)
        self.assertTrue(all(topic["explicacion"] and len(topic["pasos"]) >= 3 for topic in topics))

    def test_authentication_role_and_csrf(self):
        self.assertEqual(self.client.post("/api/algebra/intentos", json={}).status_code, 400)
        self.login(role="maestro")
        self.assertEqual(self.client.get("/algebra").status_code, 403)
        self.assertEqual(self.client.get("/api/algebra/historial").status_code, 403)
        with self.client.session_transaction() as session:
            session.clear()
        self.assertEqual(self.client.get("/api/algebra/progreso").status_code, 401)

    def test_5_and_10_questions_no_keys_and_resume(self):
        diagnostic = self.start()
        self.assertEqual(len(diagnostic["preguntas"]), 5)
        self.assertEqual(diagnostic["id"], self.start()["id"])
        for question in diagnostic["preguntas"]:
            self.assertFalse({"correcta", "pasos", "pista"} & question.keys())
        self.assertEqual(self.answer(diagnostic).status_code, 200)
        final = self.start(mode="final")
        self.assertEqual(len(final["preguntas"]), 10)
        self.assertEqual(len({q["enunciado"] for q in final["preguntas"]}), 10)

    def test_diagnostic_and_prerequisite_gates_cannot_be_bypassed(self):
        self.assertEqual(self.post("/api/algebra/intentos", {"tema": "expresiones", "modo": "final"}).status_code, 409)
        self.assertEqual(self.post("/api/algebra/intentos", {"tema": "signos", "modo": "diagnostico"}).status_code, 409)

    def test_seven_fails_eight_passes_and_lower_retake_does_not_relock(self):
        self.answer(self.start())
        failed = self.answer(self.start(mode="final"), count=7)
        self.assertEqual(failed.json["resultado"]["porcentaje"], 70)
        self.assertFalse(failed.json["resultado"]["aprobado"])
        self.assertFalse(self.client.get("/api/algebra/progreso").json["temas"][1]["habilitado"])
        final = self.start(mode="final")
        passed = self.answer(final, count=8)
        self.assertEqual(passed.json["resultado"]["porcentaje"], 80)
        self.assertTrue(passed.json["resultado"]["aprobado"])
        self.assertTrue(self.client.get("/api/algebra/progreso").json["temas"][1]["habilitado"])
        # Reenviar un intento completado no lo recalifica ni duplica registros.
        self.assertEqual(self.answer(final, count=0).json, passed.json)
        self.answer(self.start(mode="final"), count=0)
        self.assertTrue(self.client.get("/api/algebra/progreso").json["temas"][1]["habilitado"])
        self.assertEqual(len(self.client.get("/api/algebra/historial").json["historial"]), 4)

    def test_hint_before_solution_and_attempts_persist(self):
        self.answer(self.start())
        practice = self.start(mode="practica")
        question = self.private_questions(practice)[0]
        wrong = next(option for option in question["opciones"] if option != question["correcta"])
        first = self.post(f"/api/algebra/intentos/{practice['id']}/respuestas", {"respuestas": [wrong]})
        self.assertFalse(first.json["completado"])
        self.assertIn("pista", first.json)
        self.assertNotIn("resultado", first.json)
        resumed = self.start(mode="practica")
        self.assertEqual(resumed["pista"], question["pista"])
        second = self.post(f"/api/algebra/intentos/{practice['id']}/respuestas", {"respuestas": [wrong]})
        self.assertTrue(second.json["completado"])
        self.assertTrue(second.json["resultado"]["revision"][0]["pasos"])
        detail = self.client.get(f"/api/algebra/intentos/{practice['id']}").json
        self.assertEqual(len(detail["respuestas"]), 2)

    def test_account_isolation_and_server_ignores_claimed_score(self):
        attempt = self.start()
        wrong = [next(option for option in q["opciones"] if option != q["correcta"]) for q in self.private_questions(attempt)]
        result = self.post(f"/api/algebra/intentos/{attempt['id']}/respuestas",
                           {"respuestas": wrong, "porcentaje": 100, "aprobado": True, "student": "user:102"})
        self.assertEqual(result.json["resultado"]["porcentaje"], 0)
        self.login(student=102)
        self.assertEqual(self.client.get(f"/api/algebra/intentos/{attempt['id']}").status_code, 404)
        self.assertEqual(self.post(f"/api/algebra/intentos/{attempt['id']}/respuestas", {"respuestas": wrong}).status_code, 404)
        self.assertEqual(self.client.get("/api/algebra/historial").json["historial"], [])
        self.login(demo=True)
        self.assertEqual(self.client.get("/api/algebra/historial").json["historial"], [])

    def test_invalid_answers_and_payloads_do_not_consume_attempt(self):
        attempt = self.start()
        for answers in ([], None, [None]*5, [{}]*5, ["hacked"]*5):
            self.assertEqual(self.post(f"/api/algebra/intentos/{attempt['id']}/respuestas", {"respuestas": answers}).status_code, 400)
        self.assertEqual(self.client.get(f"/api/algebra/intentos/{attempt['id']}").json["respuestas"], [])
        for value in (None, {}, [], True, "desconocido"):
            self.assertEqual(self.post("/api/algebra/intentos", {"tema": value, "modo": "diagnostico"}).status_code, 400)

    def test_unverifiable_free_text_reports_limitation(self):
        self.answer(self.start())
        practice = self.start(mode="practica", kind="resolver")
        response = self.post(f"/api/algebra/intentos/{practice['id']}/respuestas", {"respuestas": ["creo que x es tres"]})
        self.assertEqual(response.status_code, 400)
        self.assertIn("no podemos verificar", response.json["error"])
        self.assertEqual(self.client.get(f"/api/algebra/intentos/{practice['id']}").json["respuestas"], [])

    def test_all_topics_can_be_completed_and_history_survives_new_session(self):
        for topic in TOPICS:
            diagnostic = self.start(topic=topic["id"])
            self.answer(diagnostic)
            for kind in topic["tipos"]:
                practice = self.start(topic=topic["id"], mode="practica", kind=kind)
                self.assertEqual(self.answer(practice).json["resultado"]["porcentaje"], 100)
            final = self.start(topic=topic["id"], mode="final")
            self.assertTrue(self.answer(final).json["resultado"]["aprobado"])
        self.client = self.app.test_client()
        self.login()
        self.assertEqual(sum(t["aprobado"] for t in self.client.get("/api/algebra/progreso").json["temas"]), 10)

    def test_transaction_prevents_duplicate_pending_attempts(self):
        # Inicializar el esquema antes de que los dos lectores compitan por el mismo intento.
        algebra.progress(self.path, "user:101")
        def start(_):
            return algebra.start_attempt(self.path, "user:101", "expresiones", "diagnostico", "basico", "opcion_multiple")["id"]
        with ThreadPoolExecutor(max_workers=2) as pool:
            ids = list(pool.map(start, range(2)))
        self.assertEqual(ids[0], ids[1])

    def test_storage_failure_returns_503_without_success(self):
        with patch.object(algebra, "start_attempt", side_effect=sqlite3.OperationalError("unavailable")):
            response = self.post("/api/algebra/intentos", {"tema": "expresiones", "modo": "diagnostico"})
        self.assertEqual(response.status_code, 503)
        self.assertIn("error", response.json)


class AlgebraMathTests(TestCase):
    def test_graph_points_match_coefficients_and_explanation(self):
        for equation, coefficients in [("y = 2x + 1", [1, 2, 0]), ("y = (x - 2)**2", [4, -4, 1]),
                                       ("y = -x^2 + 3*x - 2", [-2, 3, -1]), ("y = x/2", [0, .5, 0]),
                                       ("y = 3", [3, 0, 0]), ("y = 0.0000001", [1e-7, 0, 0])]:
            graph = graph_equation(equation)
            self.assertEqual(graph["coeficientes"], coefficients)
            self.assertEqual(graph["puntos"][50][1], coefficients[0])
            for x, y in graph["puntos"]:
                self.assertAlmostEqual(y, coefficients[0]+coefficients[1]*x+coefficients[2]*x*x, places=5)
            self.assertTrue(graph["explicacion"])

    def test_graph_rejects_code_and_unsupported_math(self):
        for equation in ["__import__('os').system('calc')", "x.__class__", "[x for x in (1,2)]", "sin(x)",
                         "1/x", "x^3", "x^9999999", "2**1000000", "y=x=1", "x/0", "1e999", "", None, "x"*141]:
            with self.subTest(equation=equation), self.assertRaises(ValueError):
                graph_equation(equation)

    def test_numeric_answers_are_exact_and_support_fractions(self):
        self.assertTrue(numeric_equal("6/2", "3"))
        self.assertTrue(numeric_equal("0,5", "1/2"))
        for value in ("3.00000000001", "3+0", True, {}, "1/0", "NaN"):
            self.assertFalse(numeric_equal(value, "3"))

    def test_bank_options_matching_and_graphs_are_consistent_across_levels(self):
        for topic in TOPICS:
            for level in LEVELS:
                for kind in topic["tipos"]:
                    for seed in range(20):
                        question = make_question(topic["id"], level, kind, random.Random(seed))
                        self.assertTrue(question["pasos"])
                        if kind == "opcion_multiple":
                            self.assertEqual(len(set(question["opciones"])), 4)
                            self.assertIn(question["correcta"], question["opciones"])
                        if kind == "relacionar":
                            self.assertEqual(len(question["elementos"]), 3)
                            self.assertEqual(set(question["correcta"]), set(question["opciones"]))
                        if kind == "grafica":
                            self.assertEqual(len(question["grafica"]["puntos"]), 101)
