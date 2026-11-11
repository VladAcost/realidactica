import os
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import MagicMock, patch

from scripts.init_db import verify_existing_schema
from scripts.start_server import prepare_storage


class ProductionPreparationTests(TestCase):
    def test_storage_preserves_existing_data_and_prepares_only_known_paths(self):
        with TemporaryDirectory() as directory:
            root=Path(directory)
            existing=root/'algebra.sqlite3'
            existing.write_bytes(b'previous-data')
            other=root/'unrelated.txt';other.write_text('preserve')
            with patch('scripts.start_server.os.chown', create=True) as chown, patch.object(Path,'chmod'):
                prepared=prepare_storage(directory,(10001,10001))
                prepare_storage(directory,(10001,10001))
            self.assertEqual(prepared,root.resolve())
            self.assertEqual(existing.read_bytes(),b'previous-data')
            self.assertEqual(other.read_text(),'preserve')
            self.assertNotIn(other,[call.args[0] for call in chown.call_args_list])

    def test_existing_compatible_schema_passes_without_mutations(self):
        connection=MagicMock()
        cursor=connection.cursor.return_value
        cursor.fetchall.return_value=[('usuarios','id','int unsigned'),('usuarios','nombre','varchar(100)')]
        with patch.dict(os.environ,{'MYSQL_DB':'test'}):
            verify_existing_schema(connection,['CREATE TABLE IF NOT EXISTS usuarios (\n id INT UNSIGNED,\n nombre VARCHAR(100)\n) ENGINE=InnoDB'])
        self.assertTrue(cursor.execute.call_args.args[0].startswith('SELECT '))
        connection.commit.assert_not_called()

    def test_incompatible_schema_stops_with_column_names_and_no_ddl(self):
        connection=MagicMock()
        cursor=connection.cursor.return_value
        cursor.fetchall.return_value=[('usuarios','id','int unsigned')]
        with patch.dict(os.environ,{'MYSQL_DB':'test'}):
            with self.assertRaisesRegex(RuntimeError,'usuarios.pass_hash'):
                verify_existing_schema(connection,['CREATE TABLE IF NOT EXISTS usuarios (\n id INT UNSIGNED,\n pass_hash VARCHAR(255)\n) ENGINE=InnoDB'])
        self.assertEqual(cursor.execute.call_count,1)
        connection.commit.assert_not_called()

    def test_signed_existing_identity_requires_review(self):
        connection=MagicMock()
        connection.cursor.return_value.fetchall.return_value=[('usuarios','id','int')]
        with patch.dict(os.environ,{'MYSQL_DB':'test'}):
            with self.assertRaisesRegex(RuntimeError,'usuarios.id'):
                verify_existing_schema(connection,['CREATE TABLE IF NOT EXISTS usuarios (\n id INT UNSIGNED\n) ENGINE=InnoDB'])
