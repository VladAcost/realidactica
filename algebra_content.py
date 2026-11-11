"""Contenido y operaciones verificables para la primera versión de RF-001 y RF-002."""
from __future__ import annotations

import ast
import math
import random
import re
from fractions import Fraction


LEVELS = {"basico": "Básico", "intermedio": "Intermedio", "avanzado": "Avanzado"}
KINDS = {
    "opcion_multiple": "Opción múltiple", "completar": "Completar espacios",
    "resolver": "Resolver con procedimiento", "relacionar": "Relacionar expresiones",
    "grafica": "Interpretar una gráfica", "problema": "Problema cotidiano",
}


def _topic(key, title, explanation, example, steps, hint, kinds=()):
    return {"id": key, "titulo": title, "explicacion": explanation, "ejemplo": example,
            "pasos": steps, "pista": hint,
            "tipos": ["opcion_multiple", "completar", "resolver", "relacionar", *kinds]}


TOPICS = [
    _topic("expresiones", "Lenguaje y expresiones algebraicas",
           "Una variable representa un número. En 3x + 2, 3 es el coeficiente de x y 2 es el término independiente. Para evaluar, sustituye la variable y respeta la jerarquía de operaciones.",
           "Evaluar 3x + 2 cuando x = 4", ["Sustituye x por 4: 3(4) + 2.", "Multiplica: 12 + 2.", "Suma: el resultado es 14."],
           "Sustituye primero la variable; multiplica antes de sumar.", ("problema",)),
    _topic("signos", "Leyes de los signos",
           "En multiplicación y división, signos iguales dan positivo y signos distintos dan negativo. Al sumar números de distinto signo, resta sus valores absolutos y conserva el signo del de mayor valor absoluto.",
           "Calcular (-4)(-3) + (-5)", ["Dos factores negativos dan un producto positivo: 12.", "Suma 12 y -5: 12 - 5.", "El resultado es 7."],
           "Determina el signo del producto antes de operar sus valores absolutos.", ("problema",)),
    _topic("suma_resta", "Suma y resta de expresiones algebraicas",
           "Solo puedes combinar términos con las mismas variables y exponentes. Para restar un paréntesis, cambia el signo de cada término que contiene.",
           "Simplificar (3x + 2) - (x - 4)", ["Distribuye el signo menos: 3x + 2 - x + 4.", "Agrupa términos semejantes: (3 - 1)x + (2 + 4).", "La expresión es 2x + 6."],
           "Distribuye el signo negativo y agrupa los coeficientes de la misma variable."),
    _topic("multiplicacion", "Multiplicación y división de expresiones algebraicas",
           "Al multiplicar potencias de la misma base, suma exponentes. Al dividirlas, resta exponentes, con denominador distinto de cero. La propiedad distributiva multiplica cada término del paréntesis.",
           "Simplificar 2x(3x + 4)", ["Distribuye 2x a ambos términos.", "2x · 3x = 6x² y 2x · 4 = 8x.", "Obtienes 6x² + 8x."],
           "Opera los coeficientes y después los exponentes de la misma base."),
    _topic("productos_notables", "Productos notables",
           "El cuadrado de un binomio cumple (x + a)² = x² + 2ax + a². La diferencia de cuadrados cumple (x + a)(x - a) = x² - a².",
           "Desarrollar (x + 3)²", ["El cuadrado del primer término es x².", "El doble producto es 2 · x · 3 = 6x.", "El cuadrado del segundo término es 9: x² + 6x + 9."],
           "No olvides el término del doble producto."),
    _topic("factorizacion", "Factorización",
           "Factorizar escribe una suma como producto. Busca primero factor común. En x² + bx + c, busca dos números cuya suma sea b y cuyo producto sea c.",
           "Factorizar x² + 5x + 6", ["Busca números que sumen 5 y multipliquen 6.", "Los números son 2 y 3.", "La factorización es (x + 2)(x + 3); compruébala multiplicando."],
           "Comprueba tanto la suma como el producto de los factores."),
    _topic("lineales", "Ecuaciones de primer grado",
           "Una igualdad se conserva si aplicas la misma operación a ambos miembros. Para resolver ax + b = c, resta b y divide entre a, siempre que a sea distinto de cero.",
           "Resolver 3x + 2 = 14", ["Resta 2 a ambos lados: 3x = 12.", "Divide ambos lados entre 3: x = 4.", "Comprueba: 3(4) + 2 = 14."],
           "Deshaz primero la suma o resta y después la multiplicación.", ("grafica", "problema")),
    _topic("cuadraticas", "Ecuaciones de segundo grado",
           "Una ecuación ax² + bx + c = 0, con a distinto de cero, puede resolverse por factorización o con x = (-b ± √(b² - 4ac)) / (2a). Si el discriminante es negativo, no tiene raíces reales.",
           "Resolver x² - 5x + 6 = 0", ["Factoriza: (x - 2)(x - 3) = 0.", "Un producto es cero si al menos un factor es cero.", "Las soluciones son x = 2 y x = 3; ambas verifican la ecuación."],
           "Si ya tienes los factores, iguala cada factor a cero.", ("grafica",)),
    _topic("sistemas", "Sistemas de ecuaciones",
           "Resolver un sistema consiste en encontrar valores que cumplan todas sus ecuaciones. Puedes usar sustitución o eliminación y después verificar en ambas igualdades.",
           "Resolver x + y = 7 y x - y = 1", ["Suma ambas ecuaciones para eliminar y: 2x = 8.", "Divide entre 2: x = 4. Sustituye: 4 + y = 7, por tanto y = 3.", "Comprueba: 4 + 3 = 7 y 4 - 3 = 1."],
           "Suma las ecuaciones si los términos de una variable son opuestos.", ("problema",)),
    _topic("graficas", "Representación gráfica de ecuaciones",
           "En y = mx + b, m indica cuánto cambia y cuando x aumenta una unidad y b es el corte con el eje y. Una ecuación cuadrática describe una parábola. Cada punto (x, y) debe satisfacer la ecuación.",
           "Representar y = 2x + 1", ["Para x = 0, y = 1: punto (0, 1).", "Para x = 1, y = 3: punto (1, 3).", "Une los puntos en una recta; su pendiente es 2 y su corte con el eje y es 1."],
           "Sustituye la coordenada x para comprobar la coordenada y.", ("grafica", "problema")),
]
TOPIC_MAP = {topic["id"]: topic for topic in TOPICS}


def graph_equation(value: str) -> dict:
    """Parsea polinomios de grado <= 2 con una lista cerrada de nodos AST, sin eval."""
    message = "Usa y = 2x + 1 o y = x^2 - 4. Se admiten polinomios en x de grado máximo 2."
    if not isinstance(value, str) or not value.strip() or len(value) > 140:
        raise ValueError(message)
    expression = value.strip().lower().replace("−", "-").replace("²", "^2").replace("^", "**")
    if expression.startswith("y"):
        if not re.match(r"^y\s*=", expression):
            raise ValueError(message)
        expression = expression.split("=", 1)[1].strip()
    expression = re.sub(r"(?<=\d)\s*(?=x)", "*", expression)
    try:
        tree = ast.parse(expression, mode="eval")
        if sum(1 for _ in ast.walk(tree)) > 60:
            raise ValueError(message)

        def polynomial(node):
            if isinstance(node, ast.Constant) and type(node.value) in (int, float):
                if not math.isfinite(node.value) or abs(node.value) > 10000:
                    raise ValueError(message)
                constant = Fraction(str(node.value))
                if constant.denominator > 10**12:
                    raise ValueError(message)
                return [constant, Fraction(0), Fraction(0)]
            if isinstance(node, ast.Name) and node.id == "x":
                return [Fraction(0), Fraction(1), Fraction(0)]
            if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
                sign = -1 if isinstance(node.op, ast.USub) else 1
                return [sign * item for item in polynomial(node.operand)]
            if not isinstance(node, ast.BinOp):
                raise ValueError(message)
            left, right = polynomial(node.left), polynomial(node.right)
            if isinstance(node.op, (ast.Add, ast.Sub)):
                sign = -1 if isinstance(node.op, ast.Sub) else 1
                result = [a + sign * b for a, b in zip(left, right)]
            elif isinstance(node.op, ast.Div) and right[1:] == [0, 0] and right[0]:
                result = [a / right[0] for a in left]
            elif isinstance(node.op, ast.Mult):
                product = [sum((left[i] * right[j] for i in range(3) for j in range(3) if i+j == k), Fraction(0)) for k in range(5)]
                if any(product[3:]):
                    raise ValueError(message)
                result = product[:3]
            elif isinstance(node.op, ast.Pow) and right[1:] == [0, 0] and right[0] in (0, 1, 2):
                if right[0] == 0:
                    result = [Fraction(1), Fraction(0), Fraction(0)]
                elif right[0] == 1:
                    result = left
                elif left[2]:
                    raise ValueError(message)
                else:
                    result = [left[0]**2, 2*left[0]*left[1], left[1]**2]
            else:
                raise ValueError(message)
            if any(abs(item) > 10000 or item.denominator > 10**12 for item in result):
                raise ValueError(message)
            return result

        c, b, a = map(float, polynomial(tree.body))
    except (SyntaxError, TypeError, ZeroDivisionError, OverflowError, RecursionError) as exc:
        raise ValueError(message) from exc
    points = [[x / 5, a*(x/5)**2 + b*(x/5) + c] for x in range(-50, 51)]
    if a:
        vertex = [-b/(2*a) if b else 0.0, c - b*b/(4*a)]
        explanation = (f"Es una parábola que abre hacia {'arriba' if a > 0 else 'abajo'}. "
                       f"Su vértice es ({vertex[0]:.4g}, {vertex[1]:.4g}) y corta el eje y en {c:.4g}.")
    elif b:
        explanation = f"Es una recta de pendiente {b:.4g}. Al aumentar x una unidad, y cambia {b:.4g}. Corta el eje y en {c:.4g}."
    else:
        explanation = f"Es una recta horizontal: y siempre vale {c:.4g}."
    return {"ecuacion": value.strip(), "coeficientes": [c, b, a], "puntos": points,
            "explicacion": explanation, "dominio": [-10, 10]}


def _base_question(topic: str, level: str, rng: random.Random, problem=False):
    size = {"basico": 6, "intermedio": 9, "avanzado": 16}[level]
    a, b, x = (rng.randint(2, size + 1) for _ in range(3))
    variant = rng.randrange(2)
    graph = None
    if topic == "expresiones":
        answer = a*x+b
        prompt = f"Evalúa {a}x + {b} cuando x = {x}."
        if problem:
            prompt = f"Un cuaderno cuesta {a} pesos y el envío cuesta {b} pesos por pedido. ¿Cuánto pagas por {x} cuadernos?"
        steps = [f"Sustituye: {a}({x}) + {b}.", f"Multiplica: {a*x} + {b}.", f"Resultado: {answer}."]
    elif topic == "signos":
        answer = a*b-x if variant else -a*b+x
        prompt = f"Calcula (-{a})({'-' if variant else ''}{b}) + ({-x if variant else x})."
        if problem:
            answer = -a*b+x
            prompt = f"Una cuenta inicia en 0 pesos. Se registran {b} cargos de {a} pesos y un abono de {x} pesos. ¿Cuál es el saldo? Usa signo negativo si hay deuda."
        steps = ["Determina el signo del producto o de los cargos.", "Realiza la multiplicación y después la suma.", f"Resultado: {answer}."]
    elif topic == "suma_resta":
        answer = a-b if variant else a+b
        prompt = f"En ({a}x + {x}) {'-' if variant else '+'} ({b}x - 1), ¿cuál es el coeficiente de x al simplificar?"
        steps = ["Agrupa únicamente los términos con x.", f"Opera sus coeficientes: {a} {'-' if variant else '+'} {b}.", f"El coeficiente de x es {answer}."]
    elif topic == "multiplicacion":
        answer = a+b if variant else a*b
        prompt = f"En x^{a} · x^{b}, ¿cuál es el exponente de x?" if variant else f"En {a}x({b}x + {x}), ¿cuál es el coeficiente de x²?"
        steps = ["Identifica si debes operar coeficientes o exponentes.", "Suma exponentes de la misma base." if variant else f"Multiplica {a} por {b}.", f"Resultado solicitado: {answer}."]
    elif topic == "productos_notables":
        answer = a*a if variant else 2*a
        prompt = f"En (x + {a})², ¿cuál es {'el término independiente' if variant else 'el coeficiente de x'}?"
        steps = [f"Usa (x + a)² = x² + 2ax + a² con a = {a}.", f"Desarrollo: x² + {2*a}x + {a*a}.", f"El valor solicitado es {answer}."]
    elif topic == "factorizacion":
        answer = b
        prompt = f"Completa el factor: x² + {a+b}x + {a*b} = (x + {a})(x + ___). Escribe el número faltante."
        steps = [f"Los números deben sumar {a+b} y multiplicar {a*b}.", f"Uno es {a}; el otro es {b}.", f"Comprueba: (x + {a})(x + {b})."]
    elif topic == "lineales":
        answer = x
        prompt = f"Resuelve {a}x + {b} = {a*x+b}. ¿Cuánto vale x?"
        if problem:
            prompt = f"Un taxi cobra {b} pesos de salida y {a} pesos por kilómetro. El total es {a*x+b} pesos. ¿Cuántos kilómetros recorriste?"
        steps = [f"Resta {b} a ambos lados: {a}x = {a*x}.", f"Divide entre {a}: x = {x}.", f"Comprueba: {a}({x}) + {b} = {a*x+b}."]
    elif topic == "cuadraticas":
        low, high = sorted((a, a+b))
        answer = high if variant else low
        prompt = f"Resuelve x² - {low+high}x + {low*high} = 0. Escribe {'la mayor' if variant else 'la menor'} raíz."
        steps = [f"Factoriza: (x - {low})(x - {high}) = 0.", f"Las raíces son {low} y {high}.", f"La raíz solicitada es {answer}."]
    elif topic == "sistemas":
        answer = x
        prompt = f"En x + y = {x+b} y x - y = {x-b}, ¿cuánto vale x?"
        if problem:
            prompt = f"Dos cajas tienen {x+b} lápices en total. La primera tiene {x-b} lápices más que la segunda (si el número es negativo, tiene menos). ¿Cuántos tiene la primera?"
        steps = [f"Suma las ecuaciones: 2x = {2*x}.", f"Divide entre 2: x = {x}.", f"Comprueba con y = {b} en ambas ecuaciones."]
    else:
        answer = a*x+b
        prompt = f"Para la recta y = {a}x + {b}, ¿cuánto vale y cuando x = {x}?"
        if problem:
            prompt = f"Una planta mide inicialmente {b} cm y crece {a} cm por semana. El modelo es y = {a}x + {b}. ¿Cuánto mide tras {x} semanas?"
        steps = [f"Sustituye x = {x} en y = {a}x + {b}.", f"Calcula {a} · {x} + {b}.", f"La coordenada y es {answer}."]
    return prompt, answer, steps, graph


def make_question(topic: str, level: str, kind: str, rng: random.Random) -> dict:
    prompt, answer, steps, graph = _base_question(topic, level, rng, kind == "problema")
    question = {"tipo": kind, "enunciado": prompt, "correcta": str(answer), "pasos": steps,
                "pista": TOPIC_MAP[topic]["pista"]}
    if kind == "grafica":
        a, b, x = rng.randint(1, 4), rng.randint(-4, 4), rng.randint(-3, 3)
        equation = f"y = {a}x^2 + ({b})" if topic == "cuadraticas" else f"y = {a}x + ({b})"
        answer = a*x*x+b if topic == "cuadraticas" else a*x+b
        question.update(enunciado=f"Observa {equation}. ¿Cuál es la coordenada y cuando x = {x}?",
                        correcta=str(answer), grafica=graph_equation(equation),
                        pasos=[f"Sustituye x = {x} en {equation}.", f"El punto es ({x}, {answer})."])
    elif kind == "relacionar":
        items = [(prompt, answer, steps)]
        for _ in range(100):
            p, value, s, _ = _base_question(topic, level, rng)
            if value not in [item[1] for item in items]:
                items.append((p, value, s))
            if len(items) == 3:
                break
        values = [str(item[1]) for item in items]
        rng.shuffle(values)
        question.update(enunciado="Relaciona cada ejercicio con su resultado.",
                        elementos=[item[0] for item in items], opciones=values,
                        correcta=[str(item[1]) for item in items],
                        pasos=[f"{item[0]} {' '.join(item[2])}" for item in items])
    elif kind == "opcion_multiple":
        distractors = {answer}
        while len(distractors) < 4:
            distractors.add(answer + rng.choice([-1, 1])*rng.randint(1, max(4, abs(answer)//2)))
        values = list(distractors)
        rng.shuffle(values)
        question["opciones"] = [str(value) for value in values]
    return question


def parse_number(given):
    if not isinstance(given, str) or len(given) > 60:
        return None
    given = given.strip().replace(",", ".").replace("−", "-")
    if not re.fullmatch(r"[+-]?\d+(?:\.\d+)?(?:/[+-]?\d+(?:\.\d+)?)?", given):
        return None
    try:
        # Fraction evita tolerancias que aceptarían una respuesta cercana pero incorrecta.
        if "/" in given:
            numerator, denominator = given.split("/")
            actual = Fraction(numerator) / Fraction(denominator)
        else:
            actual = Fraction(given)
        return actual
    except (ValueError, ZeroDivisionError):
        return None


def numeric_equal(given, expected) -> bool:
    actual = parse_number(given)
    return actual is not None and actual == Fraction(expected)


def check_answer(question, given):
    if question["tipo"] == "relacionar":
        return isinstance(given, list) and len(given) == len(question["correcta"]) and all(
            numeric_equal(answer, expected) for answer, expected in zip(given, question["correcta"]))
    return numeric_equal(given, question["correcta"])
