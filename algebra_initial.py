"""Diagnóstico inicial de los primeros cuatro temas; incluye división algebraica real."""
from algebra_content import TOPICS

INITIAL_TOPICS = [topic['id'] for topic in TOPICS[:4]]
# tema, consigna, expresión destacada, opciones, correcta, explicación
BANK = [
 ('expresiones','¿Cuál es el coeficiente de x?','7x + 4',['7','4','x','11'],'7','El número que multiplica a x es 7.'),
 ('expresiones','Elige la expresión para «el doble de un número más tres».','Un número → x',['2x + 3','2(x + 3)','x² + 3','3x + 2'],'2x + 3','El doble es 2x; después sumamos 3.'),
 ('expresiones','Evalúa cuando x = 3.','4x + 2',['14','12','18','9'],'14','Sustituye x: 4(3) + 2 = 14.'),
 ('signos','Calcula el producto.','(−6)(−4)',['24','−24','−10','10'],'24','Signos iguales dan positivo: 6 × 4 = 24.'),
 ('signos','Calcula el cociente.','(−24) ÷ 6',['−4','4','−18','−144'],'−4','Signos diferentes dan negativo: 24 ÷ 6 = 4.'),
 ('signos','Resuelve respetando las operaciones.','−5 + 3(−2)',['−11','−4','1','11'],'−11','Primero 3(−2) = −6; después −5 − 6 = −11.'),
 ('suma_resta','Simplifica los términos semejantes.','3x + 5x − 2',['8x − 2','8x² − 2','6x','8x + 2'],'8x − 2','Suma los coeficientes 3 + 5; el término independiente sigue siendo −2.'),
 ('suma_resta','Simplifica la resta.','(4x + 3) − (x − 2)',['3x + 5','3x + 1','5x + 1','3x − 5'],'3x + 5','Distribuye el menos: 4x + 3 − x + 2 = 3x + 5.'),
 ('suma_resta','Combina únicamente los términos semejantes.','2a + 3b − a + b',['a + 4b','5ab','a + 2b','3a + 4b'],'a + 4b','2a − a = a; 3b + b = 4b.'),
 ('multiplicacion','Aplica la propiedad distributiva.','2x(3x + 4)',['6x² + 8x','6x² + 4','5x² + 6x','6x + 8'],'6x² + 8x','Multiplica 2x por cada término: 6x² + 8x.'),
 ('multiplicacion','Divide coeficientes y potencias (x ≠ 0).','12x⁵ ÷ 3x²',['4x³','4x⁷','9x³','4x²'],'4x³','12 ÷ 3 = 4 y x⁵ ÷ x² = x⁽⁵⁻²⁾ = x³.'),
 ('multiplicacion','Divide cada término entre 3x (x ≠ 0).','(9x³ + 6x²) ÷ 3x',['3x² + 2x','3x² + 6x','3x³ + 2x²','6x² + 3x'],'3x² + 2x','9x³ ÷ 3x = 3x²; 6x² ÷ 3x = 2x.'),
]


def questions():
    return [{'tema': topic, 'enunciado': prompt, 'ecuacion': equation, 'tipo': 'opcion_multiple',
             'opciones': [*options, 'No lo sé todavía'], 'correcta': correct,
             'pasos': [explanation], 'pista': explanation}
            for topic, prompt, equation, options, correct, explanation in BANK]
