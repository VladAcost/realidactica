"""Compañera global, navegación permitida y tareas con autorización por grupo."""
import base64
import json
import re
import sqlite3
import unicodedata
from datetime import date

import httpx
from flask import jsonify, render_template, request, session, url_for

import experience
import kady_agents


def normalize(text):
    return ''.join(c for c in unicodedata.normalize('NFD', text.lower()) if unicodedata.category(c) != 'Mn')


def navigation_target(text, role):
    text = normalize(text)
    if not re.search(r'\b(ir|ve|vamos|abre|abrir|lleva\w*|redirig\w*|entrar|regresa\w*|volver|quiero (?:ver|repasar|estudiar|practicar))\b', text):
        return None
    destinations = ([(r'\b(inicio|resumen)\b', '/prin_m' if role == 'maestro' else '/prin'),
                     (r'\btareas?\b', '/tareas')])
    if role == 'alumno':
        destinations += [(r'\balgebra\b','/algebra'), (r'\bcalcul[oa]\b','/clase/calculo'),
                         (r'\b(ingles|english)\b','/clase/ingles/conversacion'),
                         (r'\b(javascript|frameworks?)\b','/clase/frameworks'),
                         (r'\bliderazgo\b','/clase/liderazgo'), (r'\bestilo\b','/encuesta'), (r'\bperfil\b','/perfil')]
    else:
        destinations += [(r'\bmateriales?\b','/portal-maestro'), (r'\bgrupos?\b','/gestion')]
    matches = {target for pattern, target in destinations if re.search(pattern, text)}
    return matches.pop() if len(matches) == 1 else None


def register_experience(app, login_required, roles_required, identity, cursor_factory, connection,
                        voice_id, voice_key, ai_client, model, safety_identifier, material_text, subjects):
    def storage():
        return app.config['EXPERIENCE_DB_PATH']

    def groups(student=False):
        if session.get('demo_account'):
            return [{'id_grupo': -1, 'nombre_grupo': 'Grupo de demostración'}]
        cursor = cursor_factory()
        try:
            if student:
                cursor.execute('SELECT g.id_grupo, g.nombre_grupo FROM grupos g JOIN grupo_alumno a ON a.id_grupo=g.id_grupo WHERE a.id_alumno=%s', (session['user_id'],))
            else:
                cursor.execute('SELECT id_grupo, nombre_grupo FROM grupos ORDER BY nombre_grupo')
            return cursor.fetchall()
        finally:
            cursor.close()

    def selected_agent(payload=None):
        value=(payload or {}).get('agente', (payload or {}).get('materia', request.args.get('agente')))
        try:
            return kady_agents.resolve(value)
        except ValueError as error:
            raise ValueError(str(error)) from error

    def learning_profile():
        known=experience.notice_seen(storage(), identity(), 'inicio', 'learning-complete')
        if session.get('demo_account'):
            return {'available':True,'completed':known}
        cursor=None
        try:
            cursor=cursor_factory()
            cursor.execute('SELECT resultado_final,porcentaje_visual,porcentaje_auditivo,porcentaje_kinestesico FROM perfiles_aprendizaje WHERE id_alumno=%s LIMIT 1', (session['user_id'],))
            row=cursor.fetchone()
            return {'available':True,'completed':bool(row) or known,'perfil':row}
        except Exception:
            return {'available':False,'completed':known}
        finally:
            if cursor: cursor.close()

    def task_status(agent='inicio'):
        if session['user_rol'] != 'alumno':
            return {'available':True,'items':[], 'message':'Puedes crear tareas para tus grupos y revisar sus entregas desde Tareas.'}
        try:
            rows=experience.student_tasks(storage(), identity(), [g['id_grupo'] for g in groups(True)])
            pending=[row for row in rows if not row['submitted'] and (agent == 'inicio' or row['subject'] == agent)]
            if pending:
                summary='; '.join(f"{row['title']} (entrega {row['due']})" for row in pending[:5])
                message=f'Tienes {len(pending)} tareas pendientes: {summary}. Podemos organizar una a la vez.'
            elif agent == 'inicio':
                message='No tienes tareas pendientes registradas en Realidáctica. Puedes respirar con calma. ¿Te gustaría repasar alguna materia?'
            else:
                message=f"No tienes tareas pendientes de {kady_agents.AGENTS[agent]['materia']} registradas. Podemos practicar con un ejercicio cuando quieras."
            return {'available':True,'items':pending,'message':message}
        except Exception:
            app.logger.warning('No se pudo consultar el estado de tareas',exc_info=True)
            return {'available':False,'items':[],'message':'Ahora no pude consultar tus tareas. Intenta de nuevo en un momento.'}

    def approver():
        return bool(session.get('google_email') and session['google_email'] in app.config['GOOGLE_APPROVER_EMAILS'])

    @app.context_processor
    def companion_context():
        return {'can_approve_teachers':approver(), 'kady_agent':kady_agents.for_page(request.path,request.args.get('materia')),
                'kady_subjects':kady_agents.SUBJECTS}

    @app.get('/api/kady/contexto')
    @login_required
    def context():
        try: agent=selected_agent()
        except ValueError as error: return jsonify(error=str(error)),400
        first=experience.first_visit(storage(),identity())
        profile=learning_profile() if session['user_rol']=='alumno' and agent['id']=='inicio' else None
        status=task_status(agent['id'])
        notice=None
        text=''
        redirect=None
        if first:
            notice='platform-welcome-v2'
            text=f"Hola, {session.get('user_name','')}. ¿Cómo estás? Realidáctica es tu espacio para aprender y practicar a tu ritmo. "
            if session['user_rol']=='alumno':
                text+='Empecemos con un test breve para conocerte mejor.'
                if request.args.get('pagina') != '/encuesta' and not (profile and profile['completed']): redirect='/encuesta'
            else:
                text+='Aquí puedes compartir materiales, organizar tus grupos y crear tareas.'
        elif not experience.notice_seen(storage(),identity(),agent['id'],'intro-v2'):
            notice='intro-v2'
            text=agent['saludo']
            if agent['id']=='inicio':
                text+=' '+status['message']
                if profile and profile['available'] and not profile['completed']:
                    text+=' Te propongo comenzar con Mi estilo de aprendizaje para conocer tus preferencias.'
        response=jsonify(first_visit=first,checkin=bool(notice),mensaje=text,notice=notice,redirect=redirect,
                         agente=agent,history=experience.conversation(storage(),identity(),agent['id']),
                         tasks=status,learning=profile,voice_configured=bool(voice_key()))
        response.headers['Cache-Control']='no-store'
        return response

    @app.post('/api/kady/bienvenida')
    @login_required
    def welcome():
        payload=request.get_json(silent=True) or {}
        if not isinstance(payload,dict): return jsonify(error='Datos inválidos.'),400
        try: agent=selected_agent(payload)
        except ValueError as error: return jsonify(error=str(error)),400
        notice=payload.get('notice','platform-welcome-v2')
        if notice not in {'platform-welcome-v2','intro-v2'}: return jsonify(error='Aviso inválido.'),400
        owner='inicio' if notice=='platform-welcome-v2' else agent['id']
        fresh=experience.claim_notice(storage(),identity(),owner,notice)
        if notice=='platform-welcome-v2':
            experience.first_visit(storage(),identity(),mark=True)
            experience.claim_notice(storage(),identity(),'inicio','intro-v2')
        session['kady_checkin']=False
        return jsonify(ok=True,fresh=fresh)

    @app.post('/api/kady/voz')
    @login_required
    def speech():
        payload = request.get_json(silent=True) or {}
        text = payload.get('texto') if isinstance(payload, dict) else None
        if not isinstance(text, str) or not text.strip() or len(text) > 2400:
            return jsonify(error='Texto de voz inválido.'), 400
        if not voice_key():
            return jsonify(error='La voz de Kady aún no está configurada.'), 503
        try:
            response = httpx.post(f'https://api.elevenlabs.io/v1/text-to-speech/{voice_id("es")}',
                params={'output_format': 'mp3_44100_128'}, headers={'xi-api-key': voice_key()},
                json={'text': text, 'model_id': 'eleven_multilingual_v2', 'language_code': 'es',
                      'voice_settings': {'stability': .65, 'similarity_boost': .75, 'style': .15, 'speed': .94}}, timeout=35)
            response.raise_for_status()
            if not response.content:
                raise ValueError('Audio vacío')
            result = jsonify(audio_base64=base64.b64encode(response.content).decode('ascii'))
            result.headers['Cache-Control'] = 'no-store'
            return result
        except Exception:
            app.logger.warning('No se pudo generar voz de Kady', exc_info=True)
            return jsonify(error='La voz no está disponible ahora. Puedes seguir leyendo y escribiendo.'), 502

    @app.post('/api/kady/transcribir')
    @login_required
    def transcribe():
        if not voice_key():
            return jsonify(error='La voz aún no está configurada.'), 503
        clip = request.files.get('audio')
        allowed = {'audio/webm','audio/mp4','audio/ogg','audio/wav','audio/mpeg'}
        if not clip or clip.mimetype not in allowed:
            return jsonify(error='Formato de audio no compatible.'), 400
        content = clip.stream.read(2 * 1024 * 1024 + 1)
        if not content or len(content) > 2 * 1024 * 1024:
            return jsonify(error='Graba hasta 60 segundos de audio (máximo 2 MB).'), 400
        try:
            response = httpx.post('https://api.elevenlabs.io/v1/speech-to-text', headers={'xi-api-key': voice_key()},
                data={'model_id':'scribe_v2', 'tag_audio_events':'false','num_speakers':'1','timestamps_granularity':'none',
                      **({} if request.form.get('agente')=='ingles' else {'language_code':'spa'})},
                files={'file': ('voice.' + {'audio/webm':'webm','audio/mp4':'m4a','audio/ogg':'ogg','audio/wav':'wav','audio/mpeg':'mp3'}[clip.mimetype], content, clip.mimetype)}, timeout=35)
            response.raise_for_status()
            return jsonify(texto=str(response.json().get('text', ''))[:4000])
        except Exception:
            app.logger.warning('No se pudo transcribir voz de Kady', exc_info=True)
            return jsonify(error='No pude escuchar esa frase. Intenta de nuevo o escríbela.'), 502

    @app.post('/api/kady/mensaje')
    @login_required
    def message():
        payload=request.get_json(silent=True)
        if not isinstance(payload,dict) or not isinstance(payload.get('mensaje'),str) or not 0 < len(payload['mensaje'].strip()) <= 4000:
            return jsonify(error='Escribe una pregunta de hasta 4000 caracteres.'),400
        try: agent=selected_agent(payload)
        except ValueError as error: return jsonify(error=str(error)),400
        agent_id=agent['id']; prompt=payload['mensaje'].strip(); normalized=normalize(prompt)
        memory=experience.conversation(storage(),identity(),agent_id)
        def answer(text, target=None, link=None):
            experience.remember(storage(),identity(),agent_id,prompt,text)
            return jsonify(mensaje=text,agente=agent_id,**({'navegar':target} if target else {}),**({'enlace':link} if link else {}))
        target=navigation_target(prompt,session['user_rol'])
        if target:
            if agent_id!='inicio' and target not in {'/prin','/prin_m', '/tareas?materia='+agent_id}:
                if target=='/tareas':
                    target='/tareas?materia='+agent_id
                else:
                    return answer(f"En esta pestaña te acompaño solo con {agent['materia']}. Kady Inicio puede ayudarte a cambiar de materia.",link={'url':'/prin','texto':'Abrir Kady Inicio'})
            return answer('Claro, vamos.',target)
        asking_status=(re.search(r'\b(tarea|tareas|pendiente|pendientes)\b',normalized) and
                       (re.search(r'\b(tengo|hay|cuales|que tengo|cuantas)\b',normalized) or normalized.strip('¿? .!') in {'mis tareas','tareas pendientes','pendientes'}))
        outside=kady_agents.other_subject(prompt,agent_id)
        if outside and agent_id!='inicio':
            return answer(f"Soy tu tutora de {agent['materia']}. Para {kady_agents.AGENTS[outside]['materia']}, abre su clase desde Inicio. Aquí seguimos con tus dudas de {agent['materia']}.",link={'url':'/prin','texto':'Volver a Inicio'})
        if outside and agent_id=='inicio' and not asking_status:
            destination={'algebra':'/algebra','calculo':'/clase/calculo','frameworks':'/clase/frameworks','liderazgo':'/clase/liderazgo','ingles':'/clase/ingles/conversacion'}[outside]
            return answer(f"Podemos practicar eso con {kady_agents.AGENTS[outside]['nombre']}. Te acompañará con explicaciones y ejercicios en su clase.",link={'url':destination,'texto':'Abrir '+kady_agents.AGENTS[outside]['materia']})
        status=task_status(outside if outside and agent_id=='inicio' and asking_status else agent_id)
        if asking_status: return answer(status['message'])
        profile=learning_profile() if agent_id=='inicio' and session['user_rol']=='alumno' else None
        if profile and re.search(r'\b(estilo de aprendizaje|tipo de aprendizaje|mi perfil|test principal)\b',normalized):
            if not profile['available']: return answer('Ahora no pude consultar tu perfil. Puedes revisarlo desde Mi perfil.',link={'url':'/perfil','texto':'Abrir mi perfil'})
            if not profile['completed']: return answer('Aún no has completado Mi estilo de aprendizaje. Son preguntas breves para conocer tus preferencias. ¿Comenzamos?',link={'url':'/encuesta','texto':'Comenzar mi test'})
            return answer('Tu cuestionario de aprendizaje ya está registrado. Puedes consultar tus preferencias en Mi perfil.',link={'url':'/perfil','texto':'Ver mi perfil'})
        client=ai_client()
        if client is None: return jsonify(error='La conversación aún no está configurada. Puedes consultar tus pendientes o abrir una clase desde Inicio.'),503
        reference={'tareas':{'disponible':status['available'],'pendientes':[{k:row[k] for k in ('id','title','instructions','due','subject')} for row in status['items'][:6]]}}
        if profile: reference['perfil_de_aprendizaje']=profile
        try:
            if agent_id in subjects: reference['material_de_clase']=material_text(agent_id)
            elif agent_id=='algebra':
                from algebra_content import TOPIC_MAP
                topic=payload.get('tema')
                if isinstance(topic,str) and topic in TOPIC_MAP: reference['tema_actual']=TOPIC_MAP[topic]
            response=client.responses.create(model=model,
                instructions=kady_agents.instructions(agent,session['user_rol'])+'\nDatos de referencia: '+json.dumps(reference,ensure_ascii=False,default=str),
                input=[*({'role':item['role'],'content':item['content']} for item in memory[-12:]),{'role':'user','content':prompt}],
                reasoning={'effort':'low'},max_output_tokens=800,safety_identifier=safety_identifier(),store=False)
            text=response.output_text.strip()
            if not text: return jsonify(error='No llegó una respuesta completa. Tu pregunta sigue aquí; intenta de nuevo.'),502
            repeated_question=any(normalize(item['content'])==normalized for item in memory if item['role']=='user') or bool(re.search(r'\b(repite|repetir|otra vez|de nuevo)\b',normalized))
            if not repeated_question and any(normalize(item['content'])==normalize(text) for item in memory if item['role']=='assistant'):
                text='Podemos avanzar desde la explicación anterior. ¿Qué paso te gustaría que aclaremos con otro ejemplo?'
            return answer(text)
        except Exception:
            app.logger.warning('Conversación de Kady no disponible',exc_info=True)
            return jsonify(error='No pude responder ahora. Tu pregunta sigue aquí para reintentarlo.'),502

    @app.get('/tareas')
    @login_required
    def tasks_page():
        return render_template('tareas.html',task_subject=request.args.get('materia') if request.args.get('materia') in kady_agents.SUBJECTS else None)

    @app.get('/api/tareas')
    @login_required
    def tasks():
        try:
            available_groups = groups(session['user_rol'] == 'alumno')
            if session['user_rol'] == 'alumno':
                rows = experience.student_tasks(storage(), identity(), [g['id_grupo'] for g in available_groups])
            else:
                with experience.database(storage()) as db:
                    rows = [dict(row) for row in db.execute('SELECT * FROM tasks WHERE teacher=? ORDER BY due,id', (session['user_id'],))]
                    for row in rows:
                        row['entregas'] = [dict(s) for s in db.execute('SELECT student,response,submitted FROM submissions WHERE task=?', (row['id'],))]
                student_ids = sorted({int(s['student'].split(':')[1]) for row in rows for s in row['entregas'] if re.fullmatch(r'user:\d+', s['student'])})
                if student_ids:
                    cursor = cursor_factory()
                    try:
                        cursor.execute('SELECT id,nombre,apellido FROM usuarios WHERE id IN (' + ','.join('%s' for _ in student_ids) + ')', tuple(student_ids))
                        names = {str(u['id']): f"{u['nombre']} {u['apellido']}" for u in cursor.fetchall() if 'id' in u}
                        for row in rows:
                            for submission in row['entregas']:
                                submission['nombre'] = names.get(submission['student'].split(':')[1], submission['student'])
                    finally:
                        cursor.close()
            selected=request.args.get('materia')
            if selected in kady_agents.SUBJECTS: rows=[row for row in rows if row['subject']==selected]
            return jsonify(tareas=rows, grupos=available_groups, materias=kady_agents.SUBJECTS)
        except Exception:
            app.logger.warning('No se pudieron cargar tareas', exc_info=True)
            return jsonify(error='No pudimos consultar las tareas. Intenta de nuevo.'), 503

    @app.post('/api/tareas')
    @roles_required('maestro')
    def create_task():
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return jsonify(error='Datos inválidos.'), 400
        subject=payload.get('materia','general')
        if subject not in {'general',*kady_agents.SUBJECTS}: return jsonify(error='Selecciona una materia válida.'),400
        title, instructions, due, group = (payload.get(k) for k in ('titulo','instrucciones','fecha','grupo'))
        try:
            if not isinstance(title, str) or not 1 <= len(title.strip()) <= 150 or not isinstance(instructions, str) or not 1 <= len(instructions.strip()) <= 4000:
                raise ValueError()
            if type(group) is not int or group not in [g['id_grupo'] for g in groups()]:
                raise ValueError()
            date.fromisoformat(due)
        except (ValueError, TypeError):
            return jsonify(error='Revisa el título, instrucciones, grupo y fecha de entrega.'), 400
        with experience.database(storage()) as db:
            cursor = db.execute('INSERT INTO tasks (teacher,group_id,title,instructions,due,created,subject) VALUES (?,?,?,?,?,?,?)',
                               (session['user_id'], group, title.strip(), instructions.strip(), due, experience.now(),subject))
            return jsonify(id=cursor.lastrowid), 201

    @app.put('/api/tareas/<int:task_id>/materia')
    @roles_required('maestro')
    def classify_task(task_id):
        payload=request.get_json(silent=True)
        subject=payload.get('materia') if isinstance(payload,dict) else None
        if not isinstance(subject,str) or subject not in {'general',*kady_agents.SUBJECTS}: return jsonify(error='Materia inválida.'),400
        with experience.database(storage()) as db:
            result=db.execute('UPDATE tasks SET subject=? WHERE id=? AND teacher=?',(subject,task_id,session['user_id']))
            if not result.rowcount: return jsonify(error='Tarea no encontrada.'),404
        return jsonify(ok=True)

    @app.post('/api/grupos/inscribir')
    @roles_required('maestro')
    def enroll_student():
        if session.get('demo_account'):
            return jsonify(error='La inscripción requiere cuentas reales. El grupo de demostración ya incluye al alumno de prueba.'), 400
        payload = request.get_json(silent=True)
        email = payload.get('correo') if isinstance(payload, dict) else None
        group = payload.get('grupo') if isinstance(payload, dict) else None
        if not isinstance(email, str) or len(email) > 150 or type(group) is not int:
            return jsonify(error='Selecciona un grupo y el correo del estudiante.'), 400
        if group not in [g['id_grupo'] for g in groups()]:
            return jsonify(error='Grupo no encontrado.'), 400
        cursor = cursor_factory()
        try:
            cursor.execute("SELECT id FROM usuarios WHERE correo=%s AND rol='alumno' AND activo=1 LIMIT 1", (email.strip().lower(),))
            student = cursor.fetchone()
            if not student:
                return jsonify(error='No encontramos un estudiante activo con ese correo.'), 404
            cursor.execute('INSERT IGNORE INTO grupo_alumno (id_grupo,id_alumno) VALUES (%s,%s)', (group, student['id']))
            connection().commit()
            return jsonify(ok=True)
        except Exception:
            connection().rollback()
            return jsonify(error='No pudimos inscribir al estudiante. Intenta de nuevo.'), 503
        finally:
            cursor.close()

    @app.post('/api/tareas/<int:task_id>/entregar')
    @roles_required('alumno')
    def submit_task(task_id):
        payload = request.get_json(silent=True)
        answer = payload.get('respuesta') if isinstance(payload, dict) else None
        if not isinstance(answer, str) or not 1 <= len(answer.strip()) <= 8000:
            return jsonify(error='Escribe tu entrega (hasta 8000 caracteres).'), 400
        rows = experience.student_tasks(storage(), identity(), [g['id_grupo'] for g in groups(True)])
        if not any(row['id'] == task_id for row in rows):
            return jsonify(error='Tarea no encontrada.'), 404
        with experience.database(storage()) as db:
            db.execute('INSERT INTO submissions VALUES (?,?,?,?) ON CONFLICT(task,student) DO UPDATE SET response=excluded.response,submitted=excluded.submitted',
                       (task_id, identity(), answer.strip(), experience.now()))
        return jsonify(ok=True)

    @app.get('/aprobaciones')
    @login_required
    def approvals_page():
        if not approver():
            return 'Acceso restringido', 403
        return render_template('aprobaciones.html')

    @app.route('/api/docentes/pendientes', methods=['GET','POST'])
    @login_required
    def approvals():
        if not approver():
            return jsonify(error='Acceso restringido.'), 403
        cursor = cursor_factory()
        try:
            if request.method == 'POST':
                payload = request.get_json(silent=True)
                user_id = payload.get('id') if isinstance(payload, dict) else None
                if type(user_id) is not int:
                    return jsonify(error='Cuenta inválida.'), 400
                cursor.execute("UPDATE usuarios u JOIN google_identities g ON g.user_id=u.id SET u.activo=1,g.pending_teacher=0 WHERE u.id=%s AND u.rol='maestro' AND g.pending_teacher=1", (user_id,))
                connection().commit()
            cursor.execute("SELECT u.id,u.nombre,u.apellido,u.correo FROM usuarios u JOIN google_identities g ON g.user_id=u.id WHERE g.pending_teacher=1 AND u.activo=0 AND u.rol='maestro'")
            return jsonify(docentes=cursor.fetchall())
        finally:
            cursor.close()

    @app.errorhandler(sqlite3.Error)
    def experience_storage_error(error):
        app.logger.error('Almacenamiento no disponible', exc_info=error)
        if request.path.startswith('/api/'):
            return jsonify(error='No pudimos guardar o consultar los datos. Intenta de nuevo.'), 503
        return render_template('error.html', code=503, message='No pudimos acceder a tus datos.'), 503
