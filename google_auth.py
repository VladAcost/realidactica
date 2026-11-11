"""Google OpenID Connect: validación de state, nonce, firma, emisor y audiencia por Authlib."""
import secrets

import bcrypt
from authlib.integrations.flask_client import OAuth
from flask import flash, redirect, request, session, url_for


def register_google(app, cursor_factory, connection, start_session, base_url):
    oauth = OAuth(app)
    google = oauth.register(
        name='google', client_id=app.config['GOOGLE_CLIENT_ID'],
        client_secret=app.config['GOOGLE_CLIENT_SECRET'],
        server_metadata_url='https://accounts.google.com/.well-known/openid-configuration',
        client_kwargs={'scope': 'openid email profile', 'code_challenge_method': 'S256', 'timeout': 15})

    app.extensions['realidactica_google'] = google

    @app.context_processor
    def google_context():
        return {'google_configured': bool(app.config['GOOGLE_CLIENT_ID'] and app.config['GOOGLE_CLIENT_SECRET'])}

    @app.post('/auth/google')
    def google_start():
        if not app.config['GOOGLE_CLIENT_ID'] or not app.config['GOOGLE_CLIENT_SECRET']:
            flash('El acceso con Google estará disponible cuando se termine de configurar.', 'info')
            return redirect(url_for('login'))
        role = request.form.get('rol', 'alumno')
        if role not in {'alumno', 'maestro'}:
            return 'Rol inválido', 400
        session['google_signup_role'] = role
        # Fixed redirect origin avoids trusting a visitor-controlled Host header.
        return google.authorize_redirect(base_url + '/auth/google/callback', prompt='select_account')

    @app.get('/auth/google/callback')
    def google_callback():
        role = session.pop('google_signup_role', 'alumno')
        try:
            token = google.authorize_access_token()
            claims = token.get('userinfo', {})
            email = str(claims.get('email', '')).strip().lower()
            subject = str(claims.get('sub', ''))
            if claims.get('email_verified') is not True or not email or not subject:
                raise ValueError('Correo sin verificar')
        except Exception:
            app.logger.warning('Google rechazó una autenticación o fue cancelada')
            flash('No se pudo verificar tu acceso con Google. Intenta de nuevo.', 'danger')
            return redirect(url_for('login'))
        cursor = None
        try:
            cursor = cursor_factory()
            cursor.execute('SELECT u.* FROM usuarios u JOIN google_identities g ON g.user_id=u.id WHERE g.subject=%s LIMIT 1', (subject,))
            user = cursor.fetchone()
            if not user:
                cursor.execute('SELECT * FROM usuarios WHERE correo=%s LIMIT 1', (email,))
                user = cursor.fetchone()
                if user:
                    # Google is authoritative only for Gmail or verified Workspace addresses.
                    if not user['activo'] or not (email.endswith('@gmail.com') or claims.get('hd')):
                        flash('Esta cuenta necesita confirmación o vinculación por el administrador antes de usar Google.', 'info')
                        return redirect(url_for('login'))
                else:
                    name = str(claims.get('given_name') or claims.get('name') or 'Estudiante')[:100]
                    surname = str(claims.get('family_name') or '')[:100]
                    password = bcrypt.hashpw(secrets.token_bytes(32), bcrypt.gensalt()).decode()
                    active = role == 'alumno' or email in app.config['GOOGLE_APPROVER_EMAILS']
                    cursor.execute('INSERT INTO usuarios (nombre,apellido,correo,usuario,pass_hash,rol,activo) VALUES (%s,%s,%s,%s,%s,%s,%s)',
                                   (name, surname, email, 'g_' + secrets.token_hex(12), password, role, int(active)))
                    user = {'id': cursor.lastrowid, 'nombre': name, 'rol': role, 'activo': active}
                cursor.execute('INSERT INTO google_identities (subject,user_id,pending_teacher) VALUES (%s,%s,%s)',
                               (subject, user['id'], int(not user['activo'] and user['rol'] == 'maestro')))
                connection().commit()
            if not user['activo']:
                flash('Tu solicitud de cuenta docente está guardada. Podrás entrar cuando sea aprobada.', 'info')
                return redirect(url_for('login'))
            endpoint = start_session(user)
            session['google_email'] = email
            return redirect(url_for(endpoint))
        except Exception:
            connection().rollback()
            app.logger.exception('No se pudo completar el acceso con Google')
            flash('No pudimos completar el acceso. Intenta de nuevo más tarde.', 'danger')
            return redirect(url_for('login'))
        finally:
            if cursor:
                cursor.close()
