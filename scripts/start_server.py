"""Prepare the Railway state volume, drop root privileges, then start the server."""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[1]


def prepare_storage(directory: str, owner: tuple[int, int] | None = None) -> Path:
    root = Path(directory).resolve()
    # This directory is dedicated to app state; never change permissions outside it.
    root.mkdir(parents=True, exist_ok=True)
    managed = [root, root / 'backups']
    for item in managed:
        if item.is_symlink():
            raise RuntimeError('El directorio de estado no puede enlazar fuera del volumen.')
        item.mkdir(exist_ok=True)
    for name in ('diagnostics.sqlite3', 'algebra.sqlite3', 'experience.sqlite3'):
        for suffix in ('', '-journal', '-wal', '-shm'):
            candidate = root / (name + suffix)
            if candidate.exists():
                if candidate.is_symlink() or root not in candidate.resolve().parents:
                    raise RuntimeError('El archivo de estado debe estar dentro del volumen.')
                managed.append(candidate)
    if owner is not None:
        for item in managed:
            os.chown(item, *owner)
            item.chmod(0o750 if item.is_dir() else 0o640)
    return root


def main() -> None:
    directory = os.getenv('PERSISTENT_DATA_DIR', '')
    account = None
    if hasattr(os, 'getuid') and os.getuid() == 0:
        import pwd
        account = pwd.getpwnam('realidactica')
    if directory:
        prepare_storage(directory, (account.pw_uid, account.pw_gid) if account else None)
    if account:
        os.setgroups([])
        os.setgid(account.pw_gid)
        os.setuid(account.pw_uid)
    os.chdir(BASE_DIR)
    subprocess.run([sys.executable, 'scripts/init_db.py'], check=True)
    port = int(os.getenv('PORT', '8080'))
    if not 1 <= port <= 65535:
        raise RuntimeError('Puerto inválido.')
    os.execvp('gunicorn', ['gunicorn', 'app:app', '--bind', f'0.0.0.0:{port}',
                         '--workers', '2', '--threads', '4', '--timeout', '120'])


if __name__ == '__main__':
    main()
