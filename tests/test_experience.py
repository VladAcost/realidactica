import json
import sqlite3
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import MagicMock, patch

import algebra
import app as module
import experience
from experience_routes import navigation_target


class ExperienceTests(TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.app = module.app
        self.old = {key: self.app.config.get(key) for key in ('EXPERIENCE_DB_PATH','ALGEBRA_DB_PATH','GOOGLE_APPROVER_EMAILS')}
        self.addCleanup(lambda: self.app.config.update(self.old))
        self.app.config.update(TESTING=True, EXPERIENCE_DB_PATH=str(Path(self.tmp.name)/'experience.db'),
                               ALGEBRA_DB_PATH=str(Path(self.tmp.name)/'algebra.db'), GOOGLE_APPROVER_EMAILS={'realidactica@gmail.com'})
        self.client = self.app.test_client()
        self.connection = MagicMock()
        self.cursor = self.connection.cursor.return_value
        self.cursor.fetchall.return_value = [{'id_grupo': 7, 'nombre_grupo':'Primero A'}]
        self.mysql = patch.object(module, 'mysql', SimpleNamespace(connection=self.connection))
        self.mysql.start()
        self.addCleanup(self.mysql.stop)
        self.login()

    def login(self, role='alumno', user=41, **extra):
        with self.client.session_transaction() as s:
            s.clear()
            s.update(loggedin=True, user_id=user, user_name='Andrea', user_rol=role, _csrf_token='test', **extra)

    def post(self, path, data):
        return self.client.post(path,json=data,headers={'X-CSRF-Token':'test'})

    def task(self):
        self.login('maestro')
        result=self.post('/api/tareas',{'titulo':'Repaso de expresiones','instrucciones':'Simplifica 2x + 3x.', 'grupo':7, 'fecha':'2026-12-12'})
        self.assertEqual(result.status_code,201,result.json)
        return result.json['id']

    def test_task_lifecycle_checks_groups_and_teacher_ownership(self):
        task_id=self.task()
        self.login('alumno',user=90)
        self.assertEqual(len(self.client.get('/api/tareas').json['tareas']),1)
        self.assertIn('1 tareas pendientes',self.client.get('/api/kady/contexto').json['mensaje'])
        self.assertEqual(self.post(f'/api/tareas/{task_id}/entregar',{'respuesta':'5x'}).status_code,200)
        self.assertIn('No tienes tareas pendientes',self.client.get('/api/kady/contexto').json['mensaje'])
        self.cursor.fetchall.return_value=[{'id_grupo':8,'nombre_grupo':'Segundo B'}]
        self.assertEqual(self.client.get('/api/tareas').json['tareas'],[])
        self.assertEqual(self.post(f'/api/tareas/{task_id}/entregar',{'respuesta':'5x'}).status_code,404)
        self.login('maestro',user=42)
        self.assertEqual(self.client.get('/api/tareas').json['tareas'],[])
        self.login('maestro')
        self.assertEqual(self.client.get('/api/tareas').json['tareas'][0]['entregas'][0]['response'],'5x')

    def test_empty_and_unavailable_tasks_are_distinct(self):
        result=self.client.get('/api/kady/contexto').json
        self.assertTrue(result['tasks']['available'])
        self.assertIn('¿Cómo estás',result['mensaje'])
        self.assertIn('álgebra',result['mensaje'])
        self.cursor.execute.side_effect=RuntimeError('offline')
        result=self.client.get('/api/kady/contexto').json
        self.assertFalse(result['tasks']['available'])
        self.assertNotIn('No tienes tareas pendientes',result['mensaje'])

    def test_welcome_is_persistent_and_account_scoped(self):
        self.assertTrue(self.client.get('/api/kady/contexto').json['first_visit'])
        self.post('/api/kady/bienvenida',{})
        self.login()
        self.assertFalse(self.client.get('/api/kady/contexto').json['first_visit'])
        self.login(user=42)
        self.assertTrue(self.client.get('/api/kady/contexto').json['first_visit'])

    def test_navigation_is_allowlisted_and_does_not_require_ai(self):
        for prompt,path in [('Llévame a inicio','/prin'),('Quiero repasar álgebra','/algebra'),('Abre inglés','/clase/ingles/conversacion'),('Ve a mis tareas','/tareas')]:
            self.assertEqual(self.post('/api/kady/mensaje',{'mensaje':prompt}).json['navegar'],path)
        self.assertIsNone(navigation_target('Abre https://malicioso.example','alumno'))
        self.assertIsNone(navigation_target('Abre álgebra o inicio','alumno'))
        self.assertIsNone(navigation_target('Abre álgebra','maestro'))
        self.assertIsNone(navigation_target('Explícame qué es álgebra','alumno'))

    def test_role_csrf_validation_and_auth_boundaries(self):
        self.assertEqual(self.post('/api/tareas',{}).status_code,403)
        self.assertEqual(self.client.post('/api/kady/mensaje',json={'mensaje':'Hola'}).status_code,400)
        for value in ([],None,{'mensaje':[]},{'mensaje':'x'*4001}):
            self.assertEqual(self.post('/api/kady/mensaje',value).status_code,400)
        self.login('maestro')
        self.assertEqual(self.post('/api/tareas',{'titulo':'T','instrucciones':'I','grupo':99,'fecha':'2026-12-12'}).status_code,400)
        with self.client.session_transaction() as s: s.clear()
        self.assertEqual(self.client.get('/api/kady/contexto').status_code,401)
        self.assertEqual(self.client.get('/api/tareas').status_code,401)

    def test_voice_spanish_settings_and_private_response(self):
        response=MagicMock(content=b'ID3')
        module._kady_voice_id.cache_clear()
        self.addCleanup(module._kady_voice_id.cache_clear)
        with patch.object(module,'ELEVENLABS_API_KEY','test'), patch.dict('os.environ',{'KADY_SPANISH_VOICE_ID':'SpanishVoice123'}),patch('experience_routes.httpx.post',return_value=response) as post:
            result=self.post('/api/kady/voz',{'texto':'Vas muy bien, sin prisa.'})
        self.assertEqual(result.status_code,200)
        self.assertEqual(result.headers['Cache-Control'],'no-store')
        self.assertIn('SpanishVoice123',post.call_args.args[0])
        self.assertEqual(post.call_args.kwargs['json']['language_code'],'es')
        self.assertLess(post.call_args.kwargs['json']['voice_settings']['speed'],1)

    def test_voice_failure_does_not_claim_audio_success(self):
        with patch.object(module,'ELEVENLABS_API_KEY',''):
            self.assertEqual(self.post('/api/kady/voz',{'texto':'Hola'}).status_code,503)
        self.assertEqual(self.post('/api/kady/voz',{'texto':[]}).status_code,400)

    def initial(self, count=12):
        attempt=self.post('/api/algebra/inicial',{}).json['intento']
        private=algebra.initial_questions()
        answers=[q['correcta'] if i<count else 'No lo sé todavía' for i,q in enumerate(private)]
        result=self.post('/api/algebra/intentos/'+attempt['id']+'/respuestas',{'respuestas':answers,'porcentaje':100})
        return attempt,result

    def test_initial_perfect_credits_only_four_topics_and_resumes_once(self):
        attempt,result=self.initial()
        self.assertEqual(result.status_code,200,result.json)
        self.assertTrue(result.json['resultado']['aprobado'])
        self.assertEqual(len(attempt['preguntas']),12)
        self.assertTrue(all('correcta' not in q for q in attempt['preguntas']))
        self.assertTrue(any('÷' in q['ecuacion'] for q in attempt['preguntas']))
        topics=self.client.get('/api/algebra/progreso').json['temas']
        self.assertEqual(sum(t['aprobado'] for t in topics),4)
        self.assertTrue(topics[4]['habilitado'])
        self.assertFalse(topics[5]['habilitado'])
        self.assertTrue(all(t['nivel_recomendado']=='avanzado' for t in topics[:4]))
        self.assertEqual(self.post('/api/algebra/inicial',{}).json['intento']['id'],attempt['id'])
        self.login(user=99)
        self.assertIsNone(self.client.get('/api/algebra/inicial').json['intento'])
        self.assertEqual(self.client.get('/api/algebra/intentos/'+attempt['id']).status_code,404)

    def test_initial_errors_do_not_credit_and_allow_guided_practice(self):
        _,result=self.initial(11)
        self.assertFalse(result.json['resultado']['aprobado'])
        self.assertEqual(result.json['resultado']['temas_acreditados'],[])
        topics=self.client.get('/api/algebra/progreso').json['temas']
        self.assertFalse(any(t['aprobado'] for t in topics))
        self.assertTrue(topics[0]['diagnostico'])
        self.assertEqual(self.post('/api/algebra/intentos',{'tema':'expresiones','modo':'practica','nivel':'basico','tipo':'resolver'}).status_code,200)

    def test_google_rejects_invalid_state_before_database_access(self):
        self.cursor.reset_mock()
        self.assertEqual(self.client.get('/auth/google/callback?state=bad&code=bad').status_code,302)
        self.cursor.execute.assert_not_called()

    def test_google_verified_existing_role_is_preserved(self):
        google=self.app.extensions['realidactica_google']
        self.cursor.fetchone.return_value={'id':1,'nombre':'Docente','rol':'maestro','activo':1}
        with patch.object(google,'authorize_access_token',return_value={'userinfo':{'email_verified':True,'email':'teacher@gmail.com','sub':'google123'}}):
            result=self.client.get('/auth/google/callback')
        self.assertTrue(result.location.endswith('/prin_m'))
        with self.client.session_transaction() as s: self.assertEqual(s['user_rol'],'maestro')

    def test_google_new_teacher_remains_pending(self):
        google=self.app.extensions['realidactica_google']
        self.cursor.fetchone.return_value=None
        self.cursor.lastrowid=55
        with self.client.session_transaction() as s: s['google_signup_role']='maestro'
        with patch.object(google,'authorize_access_token',return_value={'userinfo':{'email_verified':True,'email':'newteacher@gmail.com','sub':'new123'}}):
            result=self.client.get('/auth/google/callback')
        self.assertTrue(result.location.endswith('/login'))
        inserts=[c for c in self.cursor.execute.call_args_list if 'INSERT INTO usuarios' in c.args[0]]
        self.assertEqual(inserts[0].args[1][-2:],('maestro',0))

    def test_teacher_approval_requires_verified_configured_google_account(self):
        self.login('maestro',google_email='other@gmail.com')
        self.assertEqual(self.client.get('/api/docentes/pendientes').status_code,403)
        self.login(google_email='realidactica@gmail.com')
        self.cursor.fetchall.return_value=[]
        self.assertEqual(self.post('/api/docentes/pendientes',{'id':99}).status_code,200)
        self.assertTrue(any('pending_teacher=1' in call.args[0] for call in self.cursor.execute.call_args_list))

    def test_demo_teacher_and_student_can_use_tasks_without_mysql(self):
        self.login('maestro',user=900002,demo_account=True)
        created=self.post('/api/tareas',{'titulo':'Tarea de demostración','instrucciones':'Evalúa 2x para x=3.', 'grupo':-1,'fecha':'2026-12-12'})
        self.assertEqual(created.status_code,201)
        self.login('alumno',user=900001,demo_account=True)
        self.assertEqual(len(self.client.get('/api/tareas').json['tareas']),1)
        self.assertEqual(self.post('/api/tareas/'+str(created.json['id'])+'/entregar',{'respuesta':'6'}).status_code,200)
        self.assertEqual(self.client.get('/api/kady/contexto').json['tasks']['items'],[])
        self.cursor.execute.assert_not_called()

    def test_enrollment_requires_teacher_and_active_student(self):
        self.assertEqual(self.post('/api/grupos/inscribir', {'correo':'student@example.com','grupo':7}).status_code,403)
        self.login('maestro')
        self.cursor.fetchone.return_value=None
        self.assertEqual(self.post('/api/grupos/inscribir', {'correo':'student@example.com','grupo':7}).status_code,404)
        self.cursor.fetchone.return_value={'id':90}
        self.assertEqual(self.post('/api/grupos/inscribir', {'correo':'student@example.com','grupo':7}).status_code,200)
        self.assertTrue(any('INSERT IGNORE INTO grupo_alumno' in call.args[0] for call in self.cursor.execute.call_args_list))

    def test_new_pages_render_global_bubble_without_fixed_chat(self):
        for path in ['/prin','/algebra','/tareas','/clase/calculo']:
            result=self.client.get(path)
            self.assertEqual(result.status_code,200)
            self.assertIn(b'id="kady-bubble"',result.data)
            self.assertNotIn(b'class="panel chat-panel"',result.data)
            self.assertNotIn(b'class="panel class-assistant"',result.data)
