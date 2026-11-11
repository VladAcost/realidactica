"""Rutas del módulo de álgebra usando la identidad y protección CSRF existentes."""
import sqlite3

from flask import Blueprint, current_app, jsonify, render_template, request

import algebra
from algebra_content import KINDS, LEVELS, TOPIC_MAP, graph_equation


def register_algebra(app, roles_required, student_identity):
    module = Blueprint("algebra", __name__)

    def path():
        return current_app.config["ALGEBRA_DB_PATH"]

    def data():
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            raise algebra.LearningError("Envía los datos de la actividad en formato JSON.")
        return payload

    @module.errorhandler(algebra.LearningError)
    def learning_error(error):
        return jsonify(error=str(error)), error.status

    @module.errorhandler(sqlite3.Error)
    @module.errorhandler(OSError)
    def storage_error(error):
        current_app.logger.error("Almacenamiento de álgebra no disponible", exc_info=error)
        if request.path.startswith("/api/"):
            return jsonify(error="No pudimos acceder al historial. Conserva tus respuestas e intenta de nuevo."), 503
        return render_template("error.html", code=503, message="No pudimos acceder a álgebra. Intenta de nuevo."), 503

    @module.get("/algebra")
    @roles_required("alumno")
    def classroom():
        return render_template("algebra.html", topics=algebra.progress(path(), student_identity()), levels=LEVELS, kinds=KINDS)

    @module.route("/api/algebra/inicial", methods=["GET", "POST"])
    @roles_required("alumno")
    def initial():
        return jsonify(intento=algebra.initial_state(path(), student_identity(), start=request.method == "POST"))

    @module.get("/api/algebra/progreso")
    @roles_required("alumno")
    def progress():
        return jsonify(temas=algebra.progress(path(), student_identity()))

    @module.post("/api/algebra/intentos")
    @roles_required("alumno")
    def start():
        payload = data()
        fields = [payload.get("tema"), payload.get("modo"), payload.get("nivel", "basico"), payload.get("tipo", "opcion_multiple")]
        if any(not isinstance(value, str) for value in fields):
            raise algebra.LearningError("Tema, modalidad, nivel y tipo deben ser texto.")
        return jsonify(algebra.start_attempt(path(), student_identity(), *fields))

    @module.post("/api/algebra/intentos/<attempt_id>/respuestas")
    @roles_required("alumno")
    def submit(attempt_id):
        payload = data()
        return jsonify(algebra.submit_attempt(path(), student_identity(), attempt_id,
                                              payload.get("respuestas"), payload.get("procedimiento", "")))

    @module.get("/api/algebra/historial")
    @roles_required("alumno")
    def history():
        return jsonify(historial=algebra.history(path(), student_identity()))

    @module.get("/api/algebra/intentos/<attempt_id>")
    @roles_required("alumno")
    def detail(attempt_id):
        return jsonify(algebra.attempt_detail(path(), student_identity(), attempt_id))

    @module.post("/api/algebra/grafica")
    @roles_required("alumno")
    def graph():
        payload = data()
        if not isinstance(payload.get("tema"), str) or payload["tema"] not in TOPIC_MAP:
            raise algebra.LearningError("Selecciona un tema de álgebra válido.")
        try:
            result = graph_equation(payload.get("ecuacion"))
        except ValueError as error:
            raise algebra.LearningError(str(error)) from error
        return jsonify(result)

    app.register_blueprint(module)
