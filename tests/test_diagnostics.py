import sqlite3
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import patch

import app as app_module
from diagnostics import DIAGNOSTICS, evaluate


class DiagnosticTests(TestCase):
    def setUp(self):
        self.storage = TemporaryDirectory()
        self.addCleanup(self.storage.cleanup)
        self.app = app_module.app
        self.app.config.update(TESTING=True, SECRET_KEY="diagnostic-test",
                               DIAGNOSTICS_DB_PATH=str(Path(self.storage.name) / "results.sqlite3"))
        self.client = self.app.test_client()
        self.authenticate()

    def authenticate(self, student=42, role="alumno", demo=False):
        with self.client.session_transaction() as session:
            session.clear()
            session.update(loggedin=True, user_id=student, user_rol=role,
                           user_name="Estudiante", demo_account=demo, _csrf_token="test-csrf")

    def post(self, subject, answers, version=1):
        return self.client.post(f"/api/diagnosticos/{subject}",
                                json={"respuestas": answers, "version": version},
                                headers={"X-CSRF-Token": "test-csrf"})

    def test_unanswered_unknown_and_changed_version_are_rejected(self):
        for answers, version in [([], 1), (["A"] * 6, 2), (["A"] * 6, True),
                                 ([None] * 6, 1), ([{}] * 6, 1), (["Z"] * 6, 1)]:
            self.assertEqual(self.post("calculo", answers, version).status_code, 400)
        self.assertEqual(self.client.get("/api/diagnosticos/unknown").status_code, 404)
        self.assertEqual(self.client.get("/api/diagnosticos/calculo").json["diagnostico"], None)

    def test_server_grading_and_recommendations_for_each_material(self):
        for subject, bank in DIAGNOSTICS.items():
            response = self.client.get(f"/api/diagnosticos/{subject}")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(len(response.json["preguntas"]), 6)
            for question in response.json["preguntas"]:
                self.assertNotIn("correcta", question)
                self.assertNotIn("explicacion", question)
            answers = [item["correcta"].lower() for item in bank["preguntas"]]
            correct = self.post(subject, answers)
            self.assertEqual(correct.json["aciertos"], 6)
            self.assertEqual(correct.json["diagnostico"]["reforzar"], [])
            unknown = self.post(subject, ["?"] * 6).json["diagnostico"]
            self.assertEqual(unknown["aciertos"], 0)
            self.assertEqual(len(unknown["reforzar"]), 3)
            self.assertTrue(all(topic["recomendacion"] for topic in unknown["temas"]))

    def test_partial_result_identifies_specific_difficulty(self):
        result = evaluate("calculo", ["A", "C", "?", "?", "A", "D"])
        self.assertEqual(result["aciertos"], 4)
        self.assertEqual(result["reforzar"], ["Evaluación y límites"])
        topic = next(item for item in result["temas"] if item["clave"] == "limites")
        self.assertEqual(topic["estado"], "Por reforzar")
        self.assertEqual(topic["paginas"], [2, 3])

    def test_results_persist_and_are_isolated_by_student_and_demo(self):
        self.post("calculo", ["?"] * 6)
        self.client = self.app.test_client()
        self.authenticate()
        self.assertEqual(self.client.get("/api/diagnosticos/calculo").json["diagnostico"]["aciertos"], 0)
        self.authenticate(student=43)
        self.assertIsNone(self.client.get("/api/diagnosticos/calculo").json["diagnostico"])
        self.authenticate(demo=True)
        self.assertIsNone(self.client.get("/api/diagnosticos/calculo").json["diagnostico"])
        self.authenticate()
        self.post("calculo", ["A", "C", "D", "B", "A", "D"])
        self.assertEqual(self.client.get("/api/diagnosticos/calculo").json["diagnostico"]["aciertos"], 6)

    def test_student_authentication_csrf_and_role_are_required(self):
        self.assertEqual(self.client.post("/api/diagnosticos/calculo", json={"respuestas": ["?"] * 6}).status_code, 400)
        self.authenticate(role="maestro")
        self.assertEqual(self.client.get("/api/diagnosticos/calculo").status_code, 403)
        with self.client.session_transaction() as session:
            session.clear()
        self.assertEqual(self.client.get("/api/diagnosticos/calculo").status_code, 401)

    def test_storage_failure_does_not_set_english_level(self):
        with patch.object(app_module, "save_result", side_effect=sqlite3.OperationalError("unavailable")):
            self.assertEqual(self.post("ingles", ["?"] * 6).status_code, 503)
        with self.client.session_transaction() as session:
            self.assertNotIn("english_level", session)

    def test_english_level_is_restored_and_tutor_uses_weak_topics(self):
        self.post("ingles", ["?"] * 6)
        self.authenticate()
        self.assertEqual(self.client.get("/clase/ingles/conversacion").status_code, 200)
        with self.client.session_transaction() as session:
            self.assertEqual(session["english_level"], "A1")
        fake_response = type("Response", (), {"output_text": '{"english":"Hi!","feedback_es":"Vamos paso a paso.","example_en":"I have breakfast.","example_es":"Desayuno."}'})()
        with patch.object(app_module, "openai_client") as client, patch.object(app_module, "ELEVENLABS_API_KEY", ""):
            client.responses.create.return_value = fake_response
            response = self.client.post("/conversar_ingles", data={"mensaje": "Hello"}, headers={"X-CSRF-Token": "test-csrf"})
        self.assertEqual(response.status_code, 200)
        self.assertIn("Presente y hábitos", client.responses.create.call_args.kwargs["instructions"])
        self.assertEqual(client.responses.create.call_args.kwargs["model"], app_module.ENGLISH_OPENAI_MODEL)

    def test_class_tutor_receives_diagnostic_and_keeps_terra(self):
        self.post("calculo", ["A", "C", "?", "?", "A", "D"])
        fake_response = type("Response", (), {"output_text": "Repasemos los límites."})()
        with patch.object(app_module, "openai_client") as client, patch.object(app_module, "_material_text", return_value="Material"):
            client.responses.create.return_value = fake_response
            response = self.client.post("/consulta_clase", data={"materia": "calculo", "consulta": "Necesito repasar"}, headers={"X-CSRF-Token": "test-csrf"})
        self.assertEqual(response.status_code, 200)
        self.assertIn("Evaluación y límites", client.responses.create.call_args.kwargs["instructions"])
        self.assertEqual(client.responses.create.call_args.kwargs["model"], app_module.OPENAI_MODEL)
