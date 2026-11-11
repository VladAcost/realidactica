import json
import io
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
        self.cursor.fetchone.return_value = None
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
        self.assertIn('1 tareas pendientes',self.client.get('/api/kady/contexto').json['tasks']['message'])
        self.assertEqual(self.post(f'/api/tareas/{task_id}/entregar',{'respuesta':'5x'}).status_code,200)
        self.assertIn('No tienes tareas pendientes',self.client.get('/api/kady/contexto').json['tasks']['message'])
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
        self.assertEqual(result['redirect'],'/encuesta')
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

    def test_continuous_voice_accepts_wav_and_preserves_subject_language(self):
        response=MagicMock()
        response.json.return_value={'text':'Ayúdame con este paso.'}
        for agent in ('algebra','ingles'):
            with patch.object(module,'ELEVENLABS_API_KEY','test'),patch('experience_routes.httpx.post',return_value=response) as post:
                result=self.client.post('/api/kady/transcribir',data={'audio':(io.BytesIO(b'RIFF'+b'\0'*1000),'voice.wav','audio/wav'),'agente':agent},headers={'X-CSRF-Token':'test'})
            self.assertEqual(result.status_code,200,result.json)
            self.assertEqual(result.json['texto'],'Ayúdame con este paso.')
            self.assertEqual(post.call_args.kwargs['files']['file'][2],'audio/wav')
            data=post.call_args.kwargs['data']
            self.assertEqual(data.get('language_code'),'spa' if agent=='algebra' else None)
            self.assertEqual(data['num_speakers'],'1')

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

    def test_sign_in_csp_allows_google_redirect_without_expanding_other_pages(self):
        for path in ('/login', '/auth/google'):
            policy=self.client.get(path).headers['Content-Security-Policy']
            self.assertIn("form-action 'self' https://accounts.google.com;", policy)
            self.assertIn("script-src 'self'",policy)
        policy=self.client.get('/registro').headers['Content-Security-Policy']
        self.assertIn("form-action 'self';",policy)
        self.assertNotIn('accounts.google.com',policy)

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

    def ask_agent(self,agent,prompt,reply='Pensemos en un ejemplo distinto.'):
        with patch.object(module,'openai_client') as client:
            client.responses.create.return_value=SimpleNamespace(output_text=reply)
            response=self.post('/api/kady/mensaje',{'agente':agent,'mensaje':prompt})
            call=client.responses.create.call_args
        return response,call

    def test_agents_keep_separate_instructions_and_memory(self):
        self.assertEqual(self.ask_agent('algebra','Dame un ejemplo con x.','Solo-álgebra-123')[0].status_code,200)
        response,call=self.ask_agent('liderazgo','¿Cómo puedo escuchar mejor a mi equipo?','Solo-liderazgo-456')
        self.assertEqual(response.status_code,200)
        self.assertIn('Kady Liderazgo',call.kwargs['instructions'])
        self.assertNotIn('Solo-álgebra-123',str(call.kwargs['input']))
        _,call=self.ask_agent('algebra','¿Y cuál sería el siguiente paso?','Respuesta de seguimiento')
        self.assertIn('Solo-álgebra-123',str(call.kwargs['input']))
        self.assertNotIn('Solo-liderazgo-456',str(call.kwargs['input']))
        self.login(user=42)
        self.assertEqual(self.client.get('/api/kady/contexto?agente=algebra').json['history'],[])

    def test_each_subject_has_its_own_identity(self):
        expected={'/algebra':'Kady Álgebra','/clase/calculo':'Kady Cálculo','/clase/frameworks':'Kady JavaScript','/clase/liderazgo':'Kady Liderazgo','/clase/ingles/conversacion':'Kady Inglés','/prin':'Kady Inicio'}
        for url,name in expected.items():
            response=self.client.get(url)
            self.assertEqual(response.status_code,200)
            self.assertIn(name.encode(),response.data)

    def test_welcome_is_brief_redirects_once_and_does_not_repeat_on_reload(self):
        first=self.client.get('/api/kady/contexto?agente=inicio&pagina=/prin').json
        self.assertEqual(first['redirect'],'/encuesta')
        self.assertLess(len(first['mensaje'].split()),50)
        claim={'agente':'inicio','notice':first['notice']}
        self.assertTrue(self.post('/api/kady/bienvenida',claim).json['fresh'])
        self.assertFalse(self.post('/api/kady/bienvenida',claim).json['fresh'])
        again=self.client.get('/api/kady/contexto?agente=inicio&pagina=/encuesta').json
        self.assertIsNone(again['notice']);self.assertEqual(again['mensaje'],'')
        self.login()
        self.assertIsNone(self.client.get('/api/kady/contexto?agente=inicio').json['notice'])
        subject=self.client.get('/api/kady/contexto?agente=algebra').json
        self.assertEqual(subject['notice'],'intro-v2')
        self.post('/api/kady/bienvenida',{'agente':'algebra','notice':'intro-v2'})
        self.assertIsNone(self.client.get('/api/kady/contexto?agente=algebra').json['notice'])

    def test_teacher_welcome_and_current_survey_do_not_redirect_to_another_test(self):
        self.login('maestro')
        self.assertIsNone(self.client.get('/api/kady/contexto').json['redirect'])
        self.login(user=60)
        self.assertIsNone(self.client.get('/api/kady/contexto?pagina=/encuesta').json['redirect'])

    def test_home_reminds_only_if_learning_profile_is_incomplete(self):
        response=self.post('/api/kady/mensaje',{'agente':'inicio','mensaje':'Mi estilo de aprendizaje'})
        self.assertEqual(response.json['enlace']['url'],'/encuesta')
        self.cursor.fetchone.return_value={'resultado_final':'Visual','porcentaje_visual':50,'porcentaje_auditivo':25,'porcentaje_kinestesico':25}
        response=self.post('/api/kady/mensaje',{'agente':'inicio','mensaje':'Mi estilo de aprendizaje'})
        self.assertEqual(response.json['enlace']['url'],'/perfil')
        self.assertIn('ya está registrado',response.json['mensaje'])

    def test_subject_tutors_reject_other_subjects_before_model_call(self):
        with patch.object(module,'openai_client') as client:
            response=self.post('/api/kady/mensaje',{'agente':'algebra','mensaje':'Explícame JavaScript.'})
            self.assertEqual(response.status_code,200)
            self.assertIn('solo',self.client.get('/api/kady/contexto?agente=algebra').json['agente']['ambito'].lower())
            self.assertNotIn('navegar',response.json)
            self.assertEqual(response.json['enlace']['url'],'/prin')
            client.responses.create.assert_not_called()
        response=self.post('/api/kady/mensaje',{'agente':'algebra','mensaje':'Abre inglés'})
        self.assertNotIn('navegar',response.json)
        self.assertEqual(self.post('/api/kady/mensaje',{'agente':'algebra','mensaje':'Llévame a inicio'}).json['navegar'],'/prin')

    def test_home_hands_tutoring_to_the_relevant_agent(self):
        with patch.object(module,'openai_client') as client:
            response=self.post('/api/kady/mensaje',{'agente':'inicio','mensaje':'Explícame las ecuaciones de álgebra.'})
            client.responses.create.assert_not_called()
        self.assertEqual(response.json['enlace']['url'],'/algebra')

    def test_tasks_and_assignment_help_are_scoped_by_subject(self):
        self.login('maestro')
        ids={}
        for subject,title in [('algebra','Polinomios privados'),('liderazgo','Equipos privados')]:
            response=self.post('/api/tareas',{'titulo':title,'instrucciones':'Actividad exclusiva de '+subject,'grupo':7,'fecha':'2026-12-12','materia':subject})
            self.assertEqual(response.status_code,201);ids[subject]=response.json['id']
        self.login()
        pending=self.post('/api/kady/mensaje',{'agente':'algebra','mensaje':'¿Tengo tareas pendientes?'}).json['mensaje']
        self.assertIn('Polinomios privados',pending);self.assertNotIn('Equipos privados',pending)
        _,call=self.ask_agent('algebra','Ayúdame a resolver mi tarea.')
        self.assertIn('Actividad exclusiva de algebra',call.kwargs['instructions'])
        self.assertNotIn('Actividad exclusiva de liderazgo',call.kwargs['instructions'])
        filtered=self.client.get('/api/tareas?materia=algebra').json['tareas']
        self.assertEqual([row['id'] for row in filtered],[ids['algebra']])
        self.assertIn('Kady Álgebra'.encode(),self.client.get('/tareas?materia=algebra').data)

    def test_only_owner_teacher_can_change_subject_of_existing_task(self):
        task_id=self.task()
        url=f'/api/tareas/{task_id}/materia'
        self.login()
        self.assertEqual(self.client.put(url,json={'materia':'algebra'},headers={'X-CSRF-Token':'test'}).status_code,403)
        self.login('maestro',user=42)
        self.assertEqual(self.client.put(url,json={'materia':'algebra'},headers={'X-CSRF-Token':'test'}).status_code,404)
        self.login('maestro')
        self.assertEqual(self.client.put(url,json={'materia':'algebra'},headers={'X-CSRF-Token':'test'}).status_code,200)
        self.assertEqual(self.client.get('/api/tareas').json['tareas'][0]['subject'],'algebra')

    def test_explicit_repeated_question_is_allowed_but_unprompted_duplicate_is_rephrased(self):
        self.ask_agent('algebra','¿Qué es x?','x representa un número.')
        response,_=self.ask_agent('algebra','¿Qué es x?','x representa un número.')
        self.assertEqual(response.json['mensaje'],'x representa un número.')
        response,_=self.ask_agent('algebra','Dame un paso nuevo.','x representa un número.')
        self.assertNotEqual(response.json['mensaje'],'x representa un número.')

    def test_invalid_agent_ids_are_rejected(self):
        for agent in ('desconocido',[],{}):
            self.assertEqual(self.post('/api/kady/mensaje',{'agente':agent,'mensaje':'Hola'}).status_code,400)
        self.assertEqual(self.client.get('/api/kady/contexto?agente=desconocido').status_code,400)

    def test_old_task_records_migrate_without_losing_assignments(self):
        path=str(Path(self.tmp.name)/'legacy.sqlite3')
        with sqlite3.connect(path) as db:
            db.execute('CREATE TABLE tasks (id INTEGER PRIMARY KEY,teacher INTEGER NOT NULL,group_id INTEGER NOT NULL,title TEXT NOT NULL,instructions TEXT NOT NULL,due TEXT NOT NULL,created TEXT NOT NULL)')
            db.execute("INSERT INTO tasks VALUES (1,41,7,'Anterior','Conservar','2026-12-12','2026-11-11')")
        db.close()
        rows=experience.student_tasks(path,'user:41',[7])
        self.assertEqual(rows[0]['title'],'Anterior');self.assertEqual(rows[0]['subject'],'general')
