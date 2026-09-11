from http.server import BaseHTTPRequestHandler
import hashlib
import json
from pathlib import Path

from verifier_assets.aau_wake41_repaired_harness import run_tests

EXPECTED_SHA256 = '2ea7007c911398d899c244f1555e0eb106567ab894648bd848a8ad8aae16a05a'
ASSET = Path(__file__).resolve().parent.parent / 'verifier_assets' / 'aau_wake41_repaired_harness.py'


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        actual = hashlib.sha256(ASSET.read_bytes()).hexdigest()
        result = run_tests()
        body = {
            'runtime': 'vercel_python_serverless',
            'asset_sha256': actual,
            'expected_sha256': EXPECTED_SHA256,
            'hash_match': actual == EXPECTED_SHA256,
            'test_result': result,
        }
        encoded = json.dumps(body, sort_keys=True).encode('utf-8')
        self.send_response(200 if body['hash_match'] and result.get('pass') else 500)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)
