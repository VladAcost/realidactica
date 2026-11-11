"""Math classroom integration and narrowly scoped chart policy."""
import unittest
import app as app_module

class MathWidgetTests(unittest.TestCase):
    def setUp(self):
        app_module.app.config.update(TESTING=True, SECRET_KEY='math-test-secret')
        self.client = app_module.app.test_client()
        with self.client.session_transaction() as session:
            session.update(loggedin=True, user_id=1, user_name='Alumno', user_rol='alumno', _csrf_token='test')

    def test_math_panel_and_local_dependencies(self):
        for path in ['/clase/calculo', '/algebra']:
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200)
            text = response.get_data(as_text=True)
            self.assertEqual(text.count('id="math-widget"'), 1)
            self.assertIn('id="math-dialog"', text)
            self.assertNotIn('value="3d"', text)
            self.assertNotIn('value="matrix"', text)
            if path == '/algebra':
                self.assertIn('id="math-slot" hidden', text)
                self.assertNotIn('id="graph-form"', text)
            self.assertIn('vendor/plotly-strict-2.32.0.min.js', text)
            self.assertIn("style-src 'self' 'unsafe-inline'", response.headers['Content-Security-Policy'])
            self.assertIn("script-src 'self';", response.headers['Content-Security-Policy'])

    def test_other_subjects_unchanged(self):
        for path in ['/clase/frameworks', '/clase/liderazgo']:
            response = self.client.get(path)
            self.assertNotIn('id="math-widget"', response.get_data(as_text=True))
            self.assertNotIn('unsafe-inline', response.headers['Content-Security-Policy'])

if __name__ == '__main__':
    unittest.main()
