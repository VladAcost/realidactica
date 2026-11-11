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
