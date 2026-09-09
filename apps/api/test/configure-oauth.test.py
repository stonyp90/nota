import importlib.util
from pathlib import Path
import unittest
spec = importlib.util.spec_from_file_location('configure_oauth', Path(__file__).parents[1] / 'scripts/configure-oauth.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
class Configuration(unittest.TestCase):
    def test_preserves_existing_values_and_key(self):
        old = {'NOTA_OAUTH_ENCRYPTION_KEY': 'ab' * 32, 'STRIPE_SECRET_KEY': 'keep'}
        env = {'TABLE_NAME': 'nota-main'}
        merged, updated = mod.prepare(old, env, {'google': {'client_id': 'id', 'client_secret': 'private'}})
        self.assertEqual(merged['STRIPE_SECRET_KEY'], 'keep')
        self.assertEqual(merged['NOTA_OAUTH_ENCRYPTION_KEY'], old['NOTA_OAUTH_ENCRYPTION_KEY'])
        self.assertEqual(updated['TABLE_NAME'], env['TABLE_NAME'])
        self.assertNotIn('NOTA_OAUTH_GOOGLE_CLIENT_SECRET', updated)
        self.assertNotIn('NOTA_OAUTH_GOOGLE_CLIENT_SECRET', old)
    def test_invalid_input_cannot_replace_other_secrets(self):
        for value in [{}, {'STRIPE_SECRET_KEY': 'oops'}, {'google': {'client_id': 'id'}}, {'google': {'client_id': 'id', 'client_secret': ' '}}]:
            with self.assertRaises(ValueError): mod.validate_credentials(value)
    def test_invalid_existing_key_does_not_rotate_silently(self):
        with self.assertRaises(ValueError):
            mod.prepare({'NOTA_OAUTH_ENCRYPTION_KEY': 'broken'}, {}, {'google': {'client_id': 'id', 'client_secret': 'private'}})
if __name__ == '__main__': unittest.main()
