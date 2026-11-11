"""Estado privado de bienvenida y tareas asignadas a grupos."""
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path


@contextmanager
def database(path):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=10)
    db.row_factory = sqlite3.Row
    try:
        db.executescript('''
        CREATE TABLE IF NOT EXISTS welcome (student TEXT PRIMARY KEY, seen TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS tasks (
          id INTEGER PRIMARY KEY, teacher INTEGER NOT NULL, group_id INTEGER NOT NULL,
          title TEXT NOT NULL, instructions TEXT NOT NULL, due TEXT NOT NULL, created TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS submissions (
          task INTEGER NOT NULL REFERENCES tasks(id), student TEXT NOT NULL,
          response TEXT NOT NULL, submitted TEXT NOT NULL, PRIMARY KEY(task, student));
        CREATE INDEX IF NOT EXISTS task_groups ON tasks(group_id, due);
        ''')
        if 'subject' not in {row[1] for row in db.execute('PRAGMA table_info(tasks)')}:
            try:
                db.execute("ALTER TABLE tasks ADD COLUMN subject TEXT NOT NULL DEFAULT 'general'")
                db.commit()
            except sqlite3.OperationalError:
                if 'subject' not in {row[1] for row in db.execute('PRAGMA table_info(tasks)')}:
                    raise
        db.executescript("""
        CREATE TABLE IF NOT EXISTS kady_messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT, student TEXT NOT NULL, agent TEXT NOT NULL,
          role TEXT NOT NULL, content TEXT NOT NULL, created TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS kady_memory ON kady_messages(student,agent,id);
        CREATE TABLE IF NOT EXISTS kady_notices (
          student TEXT NOT NULL, agent TEXT NOT NULL, notice TEXT NOT NULL, seen TEXT NOT NULL,
          PRIMARY KEY(student,agent,notice));
        """)
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def now():
    return datetime.now(timezone.utc).isoformat()


def first_visit(path, student, mark=False):
    with database(path) as db:
        seen = db.execute('SELECT 1 FROM welcome WHERE student=?', (student,)).fetchone()
        if mark:
            db.execute('INSERT OR IGNORE INTO welcome VALUES (?,?)', (student, now()))
        return not bool(seen)


def student_tasks(path, student, groups):
    if not groups:
        return []
    with database(path) as db:
        rows = db.execute(f'''SELECT t.*, s.submitted, s.response FROM tasks t
            LEFT JOIN submissions s ON s.task=t.id AND s.student=?
            WHERE t.group_id IN ({','.join('?' for _ in groups)}) ORDER BY t.due,t.id''',
            (student, *groups)).fetchall()
        return [dict(row) for row in rows]


def conversation(path, student, agent, limit=16):
    with database(path) as db:
        rows=db.execute('SELECT id,role,content FROM kady_messages WHERE student=? AND agent=? ORDER BY id DESC LIMIT ?',
                        (student,agent,limit)).fetchall()
        return [dict(row) for row in reversed(rows)]


def remember(path, student, agent, prompt, answer):
    with database(path) as db:
        db.executemany('INSERT INTO kady_messages (student,agent,role,content,created) VALUES (?,?,?,?,?)',
                       [(student,agent,'user',prompt[:4000],now()),(student,agent,'assistant',answer[:4000],now())])
        db.execute('DELETE FROM kady_messages WHERE student=? AND agent=? AND id NOT IN (SELECT id FROM kady_messages WHERE student=? AND agent=? ORDER BY id DESC LIMIT 40)',
                   (student,agent,student,agent))


def notice_seen(path, student, agent, notice):
    with database(path) as db:
        return bool(db.execute('SELECT 1 FROM kady_notices WHERE student=? AND agent=? AND notice=?',(student,agent,notice)).fetchone())


def claim_notice(path, student, agent, notice):
    with database(path) as db:
        result=db.execute('INSERT OR IGNORE INTO kady_notices VALUES (?,?,?,?)',(student,agent,notice,now()))
        return result.rowcount == 1
