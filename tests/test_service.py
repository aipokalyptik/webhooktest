#!/usr/bin/env python3
"""HTTP integration tests; Python standard library only, isolated storage, bounded server lifetime."""
import base64
import concurrent.futures
import contextlib
import http.client
import hashlib
import shutil
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import unittest
from urllib.parse import urlencode

ROOT = Path(__file__).resolve().parents[1]

class ServiceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='webhooktest-')
        cls.storage = Path(cls.temp.name) / 'captures'
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            cls.port = listener.getsockname()[1]
        cls.env = dict(os.environ, WEBHOOK_DATA_DIR=str(cls.storage))
        cls.log = open(Path(cls.temp.name) / 'server.log', 'w+')
        cls.server = subprocess.Popen(['php', '-d', 'enable_post_data_reading=Off', '-S', f'127.0.0.1:{cls.port}', '.conf/router.php'], cwd=ROOT, env=cls.env, stdout=cls.log, stderr=cls.log)
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            try:
                cls.http('GET', '/')
                return
            except (OSError, http.client.HTTPException):
                if cls.server.poll() is not None:
                    break
                time.sleep(.05)
        cls.tearDownClass()
        raise RuntimeError('PHP server failed to start within 8 seconds')

    @classmethod
    def tearDownClass(cls):
        cls.server.terminate()
        try:
            cls.server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            cls.server.kill()
            cls.server.wait(timeout=2)
        cls.log.close()
        cls.temp.cleanup()

    @classmethod
    def http(cls, method, path, body=None, headers=None):
        connection = http.client.HTTPConnection('127.0.0.1', cls.port, timeout=10)
        try:
            connection.request(method, path, body=body, headers=headers or {})
            response = connection.getresponse()
            return response.status, dict((k.lower(), v) for k, v in response.getheaders()), response.read()
        finally:
            connection.close()

    def api(self, action='list', method='GET', **params):
        status, headers, body = self.http(method, '/api.php?' + urlencode(dict(action=action, **params)))
        return status, json.loads(body)

    def capture(self, body=b'{"event":"hello"}', inbox=None, method='POST', headers=None, query=''):
        inbox = inbox or self._testMethodName.lower()
        status, response_headers, response = self.http(method, '/ingest.php?inbox=' + inbox + query, body, headers or {'Content-Type':'application/json', 'X-Trace':'trace-123'})
        self.assertEqual(status, 201, response)
        record_id = response_headers['x-webhook-id']
        if method != 'HEAD':
            receipt = json.loads(response)
            self.assertEqual(receipt['id'], record_id)
            self.assertIn('request=' + record_id, receipt['permalink'])
        status, record = self.api('request', id=record_id)
        self.assertEqual(status, 200)
        return record

    def test_conf_loading_and_stable_default_storage(self):
        root = (Path(self.temp.name) / 'config-check').resolve()
        conf = root / '.conf'
        conf.mkdir(parents=True)
        shutil.copyfile(ROOT / '.conf/bootstrap.php', conf / 'bootstrap.php')
        code = 'require ".conf/bootstrap.php"; echo json_encode(config());'
        env = dict(self.env)
        env.pop('WEBHOOK_DATA_DIR', None)
        env.pop('WEBHOOK_BASE_URL', None)
        def settings():
            result = subprocess.run(['php', '-r', code], cwd=root, env=env, capture_output=True, text=True, timeout=5)
            self.assertEqual(result.returncode, 0, result.stderr)
            return json.loads(result.stdout)
        expected = str(root.parent / ('.webhooktest-' + hashlib.sha256(str(root).encode()).hexdigest()[:12]))
        self.assertEqual(settings()['data_dir'], expected)
        (conf / 'config.php').write_text("<?php return ['base_url'=>'https://hooks.example.test/subdir','max_body_bytes'=>1234];")
        env['WEBHOOK_BASE_URL'] = 'https://overridden.example.test'
        configured = settings()
        self.assertEqual(configured['base_url'], 'https://hooks.example.test/subdir')
        self.assertEqual(configured['max_body_bytes'], 1234)
        self.assertEqual(configured['data_dir'], expected)
        (conf / 'config.local.php').write_text("<?php return ['max_body_bytes'=>5678];")
        configured = settings()
        self.assertEqual(configured['base_url'], 'https://hooks.example.test/subdir')
        self.assertEqual(configured['max_body_bytes'], 5678)
        self.assertEqual(configured['data_dir'], expected)

    def test_storage_error_recovers_with_config_php(self):
        root = Path(self.temp.name) / 'storage-recovery'
        (root / '.conf').mkdir(parents=True)
        for filename in ['.conf/bootstrap.php', '.conf/router.php', 'api.php', 'ingest.php']:
            shutil.copyfile(ROOT / filename, root / filename)
        # A regular file cannot be used as a storage directory, even when run as root.
        (root / 'blocked').write_text('not a directory')
        config = root / '.conf/config.php'
        config.write_text("<?php return ['data_dir'=>dirname(__DIR__) . '/blocked'];")
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            port = listener.getsockname()[1]
        server = subprocess.Popen(['php', '-d', 'enable_post_data_reading=Off', '-S', f'127.0.0.1:{port}', '.conf/router.php'], cwd=root, env=self.env, stdout=self.log, stderr=self.log)
        def request(method, path, body=None):
            connection = http.client.HTTPConnection('127.0.0.1', port, timeout=5)
            try:
                connection.request(method, path, body=body)
                response = connection.getresponse()
                return response.status, json.loads(response.read())
            finally:
                connection.close()
        try:
            deadline = time.monotonic() + 5
            while True:
                try:
                    status, result = request('GET', '/api.php')
                    break
                except OSError:
                    if time.monotonic() > deadline:
                        raise
                    time.sleep(.05)
            self.assertEqual(status, 503)
            self.assertIn('.conf/config.php', result['error'])
            self.assertIn('data_dir', result['error'])
            config.write_text("<?php return ['data_dir'=>dirname(__DIR__) . '/working'];")
            status, result = request('POST', '/ingest.php', b'capture after storage repair')
            self.assertEqual(status, 201)
            self.assertTrue((root / 'working' / (result['id'] + '.json')).is_file())
            status, result = request('GET', '/api.php')
            self.assertEqual(status, 200)
            self.assertEqual(result['stats']['total'], 1)
        finally:
            server.terminate()
            server.wait(timeout=5)

    def test_private_conf_directory_is_not_served(self):
        for path in ['/.conf/nginx.conf', '/.conf/apache.conf', '/.conf/config.example.php', '/.conf/config.php', '/.conf/config.local.php', '/.conf/bootstrap.php', '/.conf/router.php', '/.conf/restore.php', '/%2econf/nginx.conf', '/.git/config']:
            status, headers, body = self.http('GET', path)
            self.assertEqual(status, 404, path)
            self.assertEqual(json.loads(body)['error'], 'Not found.')
            self.assertIn('no-store', headers['cache-control'])
        status, _, body = self.http('GET', '/robots.txt')
        self.assertEqual(status, 200)
        self.assertEqual(body, (ROOT / 'robots.txt').read_bytes())

    def test_raw_headers_metadata_and_downloads(self):
        body = b'{"large":9007199254740993,"message":"space  and\\nlines"}\n'
        r = self.capture(body, query='&tag=one&tag=two&literal=%25')
        self.assertEqual(r['body'].encode(), body)
        self.assertEqual(base64.b64decode(r['body_base64']), body)
        self.assertEqual(r['headers']['X-Trace'], 'trace-123')
        self.assertIn('tag=one&tag=two', r['query'])
        self.assertEqual(r['size'], len(body))
        for action in ['download', 'export']:
            status, headers, downloaded = self.http('GET', f'/api.php?action={action}&id={r["id"]}')
            self.assertEqual(status, 200)
            self.assertIn('attachment;', headers['content-disposition'])
            self.assertEqual(downloaded if action == 'download' else base64.b64decode(json.loads(downloaded)['body_base64']), body)
        stored = json.loads((self.storage / (r['id'] + '.json')).read_text())
        self.assertEqual(stored['body'], r['body'])
        self.assertEqual(stored['version'], 1)

    def test_all_standard_methods(self):
        for method in ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'TRACE', 'PROPFIND']:
            with self.subTest(method=method):
                r = self.capture(b'payload', method=method)
                self.assertEqual(r['method'], method)
                self.assertEqual(r['body'], 'payload')

    def test_binary_and_empty(self):
        body = bytes(range(256)) * 32
        r = self.capture(body, headers={'Content-Type':'application/octet-stream'})
        self.assertIsNone(r['body'])
        self.assertEqual(r['body_encoding'], 'base64')
        self.assertEqual(base64.b64decode(r['body_base64']), body)
        r = self.capture(b'')
        self.assertEqual(r['body'], '')
        self.assertEqual(r['size'], 0)

    def test_multipart_is_byte_exact(self):
        body = b'--BOUNDARY\r\nContent-Disposition: form-data; name="file"; filename="a.bin"\r\nContent-Type: application/octet-stream\r\n\r\n\x00\xff\x01\r\n--BOUNDARY--\r\n'
        r = self.capture(body, headers={'Content-Type':'multipart/form-data; boundary=BOUNDARY'})
        self.assertEqual(base64.b64decode(r['body_base64']), body)

    def test_search_literal_and_pagination_and_inbox_isolation(self):
        inbox = self._testMethodName.lower()
        for i in range(53):
            self.capture(f'item {i} %_ literal'.encode(), inbox=inbox)
        for query in ['%_', 'TRACE-123', 'application/json', 'POST', 'item 52']:
            status, result = self.api(inbox=inbox, q=query)
            self.assertEqual(status, 200)
            self.assertGreater(result['matched'], 0)
        _, result = self.api(inbox=inbox, q='%_', page=2)
        self.assertEqual(result['matched'], 53)
        self.assertEqual(len(result['requests']), 3)
        self.assertEqual(result['pages'], 2)
        self.assertNotIn('body', result['requests'][0])
        _, result = self.api(inbox='nonexistent-inbox', q='item')
        self.assertEqual(result['matched'], 0)

    def test_older_cleanup_preview_scope_and_boundary(self):
        inbox = self._testMethodName.lower()
        old = self.capture(inbox=inbox)
        boundary = self.capture(inbox=inbox)
        other = self.capture(inbox='other-retention-inbox')
        for record, date in [(old, '2020-01-01T00:00:00.000000Z'), (boundary, '2021-01-01T00:00:00.000000Z')]:
            path = self.storage / (record['id'] + '.json')
            data = json.loads(path.read_text())
            data['received_at'] = date
            path.write_text(json.dumps(data))
        args = dict(action='maintenance', inbox=inbox, before='2021-01-01T00:00:00Z')
        _, preview = self.api(**args)
        self.assertEqual(preview['matching']['count'], 1)
        status, _ = self.api(method='DELETE', **args)
        self.assertEqual(status, 400)
        status, _, body = self.http('DELETE', '/api.php?' + urlencode(args), headers={'X-Confirm-Scope':inbox})
        self.assertEqual(status, 200, body)
        self.assertEqual(json.loads(body)['deleted'], 1)
        self.assertEqual(self.api('request', id=old['id'])[0], 404)
        self.assertEqual(self.api('request', id=boundary['id'])[0], 200)
        self.assertEqual(self.api('request', id=other['id'])[0], 200)
        self.assertEqual(self.api('maintenance', before='2020-02-31T00:00:00Z')[0], 400)

    def test_single_delete_flush_backup(self):
        inbox = self._testMethodName.lower()
        r = self.capture(inbox=inbox)
        status, headers, body = self.http('GET', '/api.php?action=backup')
        self.assertEqual(status, 200)
        backup = json.loads(body)
        self.assertEqual(backup['format'], 'webhooktest')
        self.assertIn(r['id'], [x['id'] for x in backup['requests']])
        self.assertIn('.json', headers['content-disposition'])
        self.assertFalse(list(self.storage.glob('.backup-*')))
        self.assertEqual(self.api('delete', id=r['id'])[0], 405)
        self.assertEqual(self.api('delete', method='DELETE', id=r['id'])[0], 200)
        self.assertEqual(self.api('request', id=r['id'])[0], 404)
        self.capture(inbox=inbox)
        status, _, body = self.http('DELETE', '/api.php?action=clear&inbox=' + inbox, headers={'X-Confirm-Inbox':inbox})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)['deleted'], 1)

    def test_curl_replay_recreates_method_headers_and_bytes(self):
        for method, body in [('PATCH', b"quotes '\" and newline\n"), ('PUT', bytes(range(256))), ('POST', b'z' * 400000), ('HEAD', b''), ('GET', b'')]:
            with self.subTest(method=method, size=len(body)):
                original = self.capture(body, method=method)
                code = "const fs=require('node:fs'); const {replayCurl}=require('./assets/core.js'); process.stdout.write(replayCurl(JSON.parse(fs.readFileSync(0,'utf8'))));"
                command = subprocess.run(['node','-e',code], input=json.dumps(original), text=True, cwd=ROOT, capture_output=True, timeout=10)
                self.assertEqual(command.returncode, 0, command.stderr)
                replay = subprocess.run(['/bin/sh'], input=command.stdout, text=True, cwd=ROOT, capture_output=True, timeout=10)
                self.assertEqual(replay.returncode, 0, replay.stderr)
                _, listing = self.api(inbox=original['inbox'])
                replayed_id = listing['requests'][0]['id']
                self.assertNotEqual(replayed_id, original['id'])
                _, replayed = self.api('request', id=replayed_id)
                self.assertEqual(replayed['body_base64'], original['body_base64'])
                self.assertEqual(replayed['method'], original['method'])
                self.assertEqual(replayed['uri'], original['uri'])
                self.assertEqual({k.lower():v for k,v in replayed['headers'].items()}, {k.lower():v for k,v in original['headers'].items()})

    def test_restore_roundtrip_conflicts_and_invalid_ids(self):
        record = self.capture()
        status, _, body = self.http('GET', '/api.php?action=backup')
        self.assertEqual(status, 200)
        backup = Path(self.temp.name) / 'backup.json'
        backup.write_bytes(body)
        target = Path(self.temp.name) / 'restore-target'
        env = dict(self.env, WEBHOOK_DATA_DIR=str(target))
        def restore():
            return subprocess.run(['php', '.conf/restore.php', str(backup)], cwd=ROOT, env=env, capture_output=True, timeout=10)
        result = restore()
        self.assertEqual(result.returncode, 0, result.stderr)
        restored = json.loads((target / (record['id'] + '.json')).read_text())
        self.assertEqual(restored['body_base64'], record['body_base64'])
        self.assertEqual(restore().returncode, 0)
        restored['body'] = 'conflict'
        (target / (record['id'] + '.json')).write_text(json.dumps(restored))
        self.assertNotEqual(restore().returncode, 0)
        bad = json.loads(body)
        bad['requests'][0]['id'] = '../../escape'
        backup.write_text(json.dumps(bad))
        self.assertNotEqual(restore().returncode, 0)

    def test_subdirectory_hosting_and_multipart_configuration(self):
        root = Path(self.temp.name) / 'webroot'
        root.mkdir()
        (root / 'nested').symlink_to(ROOT, target_is_directory=True)
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            port = listener.getsockname()[1]
        server = subprocess.Popen(['php', '-d', 'enable_post_data_reading=On', '-S', f'127.0.0.1:{port}', '-t', str(root)], cwd=ROOT, env=self.env, stdout=self.log, stderr=self.log)
        def request(method, path, body=None, headers=None):
            connection = http.client.HTTPConnection('127.0.0.1',port,timeout=5)
            try:
                connection.request(method,path,body=body,headers=headers or {})
                response = connection.getresponse()
                return response.status,response.read()
            finally:
                connection.close()
        try:
            deadline = time.monotonic() + 5
            while True:
                try:
                    status, body = request('GET','/nested/index.php')
                    break
                except OSError:
                    if time.monotonic() > deadline:
                        raise
                    time.sleep(.05)
            self.assertEqual(status,200)
            self.assertIn(f'data-base-url="http://127.0.0.1:{port}/nested/"'.encode(),body)
            status, body = request('POST','/nested/ingest.php?inbox=nested',b'hello')
            self.assertEqual(status,201)
            self.assertIn('/nested/index.php?request=',json.loads(body)['permalink'])
            status, body = request('POST','/nested/ingest.php',b'--test--',{'Content-Type':'multipart/form-data; boundary=test'})
            self.assertEqual(status,503)
            self.assertIn('enable_post_data_reading',json.loads(body)['error'])
        finally:
            server.terminate()
            server.wait(timeout=5)

    def test_z_global_flush(self):
        self.capture(inbox='flush-one')
        self.capture(inbox='flush-two')
        status, preview = self.api('maintenance', scope='all')
        self.assertEqual(status, 200)
        self.assertGreaterEqual(preview['matching']['count'], 2)
        status, _, body = self.http('DELETE', '/api.php?action=maintenance&scope=all', headers={'X-Confirm-Scope':'all'})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)['deleted'], preview['matching']['count'])
        self.assertEqual(self.api('maintenance', scope='all')[1]['totals']['count'], 0)
        self.assertFalse(list(self.storage.glob('*.json')))

    def test_robots_no_cache_and_error_headers(self):
        for path in ['/', '/index.php?asset=app.css', '/index.php?asset=app.js', '/robots.txt', '/api.php', '/api.php?action=missing', '/api.php?id[]=bad', '/api.php?action=request&id=00000000000000000000000000000000', '/.git/config']:
            status, headers, _ = self.http('GET', path)
            self.assertIn('no-store', headers['cache-control'], path)
            self.assertIn('noindex', headers['x-robots-tag'], path)
        self.assertEqual(self.http('POST', '/')[0], 405)
        self.assertEqual(self.api(inbox='../x')[0], 400)
        self.assertEqual(self.api(page=0)[0], 400)
        self.assertEqual(self.api('request', id='../../x')[0], 400)
        self.assertEqual(self.http('POST', '/ingest.php?inbox[]=x', b'x')[0], 400)

    def test_body_limit_and_preflight(self):
        status, _, _ = self.http('POST', '/ingest.php', b'x' * (10 * 1024 * 1024 + 1))
        self.assertEqual(status, 413)
        status, headers, body = self.http('OPTIONS', '/ingest.php?inbox=preflight', headers={'Origin':'https://example.com','Access-Control-Request-Method':'PATCH','Access-Control-Request-Headers':'X-Test, Content-Type'})
        self.assertEqual(status, 204)
        self.assertEqual(body, b'')
        self.assertEqual(headers['access-control-allow-origin'], '*')
        self.assertEqual(self.api('request', id=headers['x-webhook-id'])[1]['method'], 'OPTIONS')

    def test_concurrent_process_writers(self):
        code = 'require ".conf/bootstrap.php"; save_capture(["id"=>bin2hex(random_bytes(16)), "inbox"=>"concurrent", "received_at"=>gmdate("c"), "headers"=>(object)[], "body_base64"=>"", "size"=>0]);'
        def writer(_):
            return subprocess.run(['php','-r',code], cwd=ROOT, env=self.env, capture_output=True, timeout=10)
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(writer, range(24)))
        for result in results:
            self.assertEqual(result.returncode, 0, result.stderr)
        captures = [json.loads(path.read_text()) for path in self.storage.glob('*.json')]
        self.assertEqual(sum(x['inbox'] == 'concurrent' for x in captures), 24)
        # Remove synthetic records which intentionally omit display metadata.
        for path in self.storage.glob('*.json'):
            if json.loads(path.read_text())['inbox'] == 'concurrent':
                path.unlink()
        self.assertFalse(list(self.storage.glob('.capture-*')))

if __name__ == '__main__':
    unittest.main(verbosity=2)
