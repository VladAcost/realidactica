import unittest
from io import BytesIO
from unittest.mock import patch
from tempfile import TemporaryDirectory
from pathlib import Path

import app as app_module

app = app_module.app


class RealidacticaSmokeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.storage = TemporaryDirectory()
        self.addCleanup(self.storage.cleanup)
        app.config.update(TESTING=True, SECRET_KEY="test-only-secret", DIAGNOSTICS_DB_PATH=str(Path(self.storage.name) / "diagnostics.sqlite3"))
        self.client = app.test_client()

    def login_as(self, role: str) -> str:
        token = "csrf-test-token"
        with self.client.session_transaction() as session:
            session.update(
                loggedin=True,
                user_id=1,
                user_name="Prueba",
                user_rol=role,
                _csrf_token=token,
                chat_history=[],
            )
        return token

    def test_public_pages_and_security_headers(self) -> None:
        for path in ("/", "/login", "/registro", "/health"):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200, path)
            self.assertIn("Content-Security-Policy", response.headers)
            self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
            self.assertEqual(response.headers["X-Frame-Options"], "DENY")
            self.assertIn("microphone=(self)", response.headers["Permissions-Policy"])

    def test_class_pdf_can_only_be_framed_by_same_origin(self) -> None:
        response = self.client.get("/static/clases/calculo/integrales.pdf")
        try:
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers["X-Frame-Options"], "SAMEORIGIN")
            self.assertIn("frame-ancestors 'self'", response.headers["Content-Security-Policy"])
        finally:
            response.close()

    def test_student_pages_render(self) -> None:
        self.login_as("alumno")
        for path in ("/prin", "/encuesta", "/clase/calculo", "/clase/frameworks", "/clase/liderazgo", "/clase/ingles/conversacion"):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200, path)

    def test_role_boundaries(self) -> None:
        self.login_as("alumno")
        self.assertEqual(self.client.get("/prin_m").status_code, 403)
        self.assertEqual(self.client.get("/portal-maestro").status_code, 403)

    def test_english_conversation_uses_luna_and_returns_feedback(self) -> None:
        token = self.login_as("alumno")
        first = self.client.post("/conversar_ingles", data={"mensaje": "I went home"}, headers={"X-CSRF-Token": token})
        self.assertEqual(first.status_code, 400)
        assessment = self.client.post("/evaluar_ingles", json={"respuestas": ["b", "a", "c", "b", "c", "b"]}, headers={"X-CSRF-Token": token})
        self.assertEqual(assessment.status_code, 200)
        self.assertEqual(assessment.json["nivel"], "B2")
        fake_response = type("Response", (), {"output_text": '{"english":"Great! What did you do there?","feedback_es":"Tu frase es correcta.","example_en":"I went home.","example_es":"Fui a casa."}'})()
        with patch.object(app_module, "openai_client") as client:
            client.responses.create.return_value = fake_response
            response = self.client.post("/conversar_ingles", data={"mensaje": "I went home"}, headers={"X-CSRF-Token": token})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["feedback_es"], "Tu frase es correcta.")
        self.assertEqual(client.responses.create.call_args.kwargs["model"], app_module.ENGLISH_OPENAI_MODEL)
        self.assertEqual(client.responses.create.call_args.kwargs["reasoning"]["effort"], "none")
        self.assertFalse(client.responses.create.call_args.kwargs["store"])

    def test_english_quiz_rejects_incomplete_answers(self) -> None:
        token = self.login_as("alumno")
        response = self.client.post("/evaluar_ingles", json={"respuestas": ["a"]}, headers={"X-CSRF-Token": token})
        self.assertEqual(response.status_code, 400)

    def test_english_audio_uses_elevenlabs_transcription(self) -> None:
        token = self.login_as("alumno")
        mock_response = type("Response", (), {"json": lambda self: {"text": "Hola Kady, I like music"},
                                              "raise_for_status": lambda self: None})()
        with patch.object(app_module, "ELEVENLABS_API_KEY", "test-key"), patch.object(app_module.httpx, "post", return_value=mock_response) as post:
            response = self.client.post(
                "/transcribir_ingles",
                data={"audio": (BytesIO(b"test audio"), "utterance.webm", "audio/webm"), "modo": "activacion"},
                headers={"X-CSRF-Token": token},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["texto"], "Hola Kady, I like music")
        self.assertEqual(post.call_args.kwargs["data"]["model_id"], "scribe_v2")
        self.assertEqual(post.call_args.kwargs["data"]["keyterms"], ["Hola Kady", "Kady"])
        self.assertNotIn("language_code", post.call_args.kwargs["data"])

    def test_english_audio_accepts_spanish_transcript(self) -> None:
        token = self.login_as("alumno")
        mock_response = type("Response", (), {"json": lambda self: {"text": "Quiero practicar cómo pedir un café."},
                                              "raise_for_status": lambda self: None})()
        with patch.object(app_module, "ELEVENLABS_API_KEY", "test-key"), patch.object(app_module.httpx, "post", return_value=mock_response) as post:
            response = self.client.post(
                "/transcribir_ingles",
                data={"audio": (BytesIO(b"test audio"), "utterance.webm", "audio/webm"), "modo": "conversacion"},
                headers={"X-CSRF-Token": token},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["texto"], "Quiero practicar cómo pedir un café.")
        self.assertNotIn("language_code", post.call_args.kwargs["data"])
        self.assertNotIn("keyterms", post.call_args.kwargs["data"])

    def test_english_audio_rejects_non_audio_file(self) -> None:
        token = self.login_as("alumno")
        with patch.object(app_module, "ELEVENLABS_API_KEY", "test-key"):
            response = self.client.post(
                "/transcribir_ingles",
                data={"audio": (BytesIO(b"not audio"), "note.txt", "text/plain")},
                headers={"X-CSRF-Token": token},
            )
        self.assertEqual(response.status_code, 400)

    def test_elevenlabs_voice_uses_female_voice_id(self) -> None:
        app_module._kady_voice_id.cache_clear()
        mock_response = type("Response", (), {"content": b"ID3audio", "raise_for_status": lambda self: None})()
        with patch.object(app_module, "ELEVENLABS_API_KEY", "test-key"), patch.object(app_module, "ELEVENLABS_VOICE_ID", "femaleVoice123"), patch.object(app_module.httpx, "post", return_value=mock_response) as post:
            audio = app_module._kady_speech({"english": "Hello", "feedback_es": "Bien", "example_en": "Hi", "example_es": "Hola"})
        app_module._kady_voice_id.cache_clear()
        self.assertTrue(audio)
        self.assertIn("femaleVoice123", post.call_args.args[0])
        self.assertEqual(post.call_args.kwargs["json"]["model_id"], "eleven_multilingual_v2")
        self.assertNotIn("Hola", post.call_args.kwargs["json"]["text"])

    def test_csrf_is_required_for_logout(self) -> None:
        token = self.login_as("alumno")
        self.assertEqual(self.client.post("/logout").status_code, 400)
        response = self.client.post("/logout", data={"_csrf_token": token})
        self.assertEqual(response.status_code, 302)

    def test_registration_does_not_offer_teacher_role(self) -> None:
        response = self.client.get("/registro")
        self.assertNotIn(b'value="maestro"', response.data)

    def test_demo_accounts_are_explicit_and_role_scoped(self) -> None:
        demo_env = {
            "DEMO_STUDENT_USERNAME": "alumno.demo",
            "DEMO_STUDENT_PASSWORD": "student-test-password",
            "DEMO_TEACHER_USERNAME": "maestro.demo",
            "DEMO_TEACHER_PASSWORD": "teacher-test-password",
        }
        with patch.object(app_module, "DEMO_MODE", True), patch.dict("os.environ", demo_env):
            response = self.client.get("/login")
            with self.client.session_transaction() as session:
                token = session["_csrf_token"]
            response = self.client.post(
                "/login",
                data={"usuario": "alumno.demo", "password": "student-test-password", "_csrf_token": token},
            )
            self.assertEqual(response.status_code, 302)
            self.assertTrue(response.headers["Location"].endswith("/prin"))

    def test_demo_dashboard_chat_does_not_require_mysql(self) -> None:
        token = self.login_as("alumno")
        with self.client.session_transaction() as user_session:
            user_session["user_id"] = 900_001
        fake_response = type("Response", (), {"output_text": "Vamos a practicar paso a paso."})()
        with patch.object(app_module, "DEMO_MODE", True), patch.object(app_module, "_db_cursor") as cursor, patch.object(app_module, "openai_client") as client:
            client.responses.create.return_value = fake_response
            response = self.client.post(
                "/consulta", data={"consulta": "Explícame una integral sencilla"},
                headers={"X-CSRF-Token": token},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["mensaje"], "Vamos a practicar paso a paso.")
        cursor.assert_not_called()


if __name__ == "__main__":
    unittest.main()
