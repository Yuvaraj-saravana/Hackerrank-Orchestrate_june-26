import os
import sys
import json
import urllib.parse
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler

# Add parent directory to path so we can import from code
REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.append(str(REPO_ROOT))

# Import logic from main agent and evaluation
try:
    from code.evaluation.main import (
        load_user_history,
        load_evidence_requirements,
        call_claude_strategy_a,
        call_claude_strategy_b,
        client,
        get_heuristic_fallback
    )
except ImportError:
    # Fallback pathing if run from different dir
    sys.path.append(str(REPO_ROOT / 'code'))
    from evaluation.main import (
        load_user_history,
        load_evidence_requirements,
        call_claude_strategy_a,
        call_claude_strategy_b,
        client,
        get_heuristic_fallback
    )

class DashboardRequestHandler(BaseHTTPRequestHandler):
    def end_headers(self):
        # Enable CORS for convenience
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path
        query = urllib.parse.parse_qs(parsed_url.query)

        # Serve Dashboard Files
        if path == '/' or path == '/index.html':
            self.serve_file(REPO_ROOT / 'code' / 'dashboard' / 'index.html', 'text/html')
        elif path == '/index.css':
            self.serve_file(REPO_ROOT / 'code' / 'dashboard' / 'index.css', 'text/css')
        elif path == '/index.js':
            self.serve_file(REPO_ROOT / 'code' / 'dashboard' / 'index.js', 'application/javascript')
        
        # Serve Images from dataset
        elif path.startswith('/images/') or path.startswith('/dataset/images/'):
            # clean path
            rel_path = path.replace('/dataset/', '').lstrip('/')
            img_file = REPO_ROOT / 'dataset' / rel_path
            if not img_file.exists():
                img_file = REPO_ROOT / rel_path
            
            if img_file.exists() and img_file.is_file():
                ext = img_file.suffix.lower()
                mime = 'image/png' if ext == '.png' else 'image/jpeg'
                self.serve_file(img_file, mime)
            else:
                self.send_error(404, f"Image not found: {path}")

        # API: Get Claims
        elif path == '/api/claims':
            ds_type = query.get('dataset', ['test'])[0]
            csv_name = 'sample_claims.csv' if ds_type == 'sample' else 'claims.csv'
            csv_path = REPO_ROOT / 'dataset' / csv_name
            
            if csv_path.exists():
                import pandas as pd
                df = pd.read_csv(csv_path)
                # replace NaN with None for JSON serialization
                claims = df.where(pd.notnull(df), None).to_dict(orient='records')
                self.send_json(claims)
            else:
                self.send_error(404, f"Dataset not found: {csv_name}")

        # API: Get User History
        elif path == '/api/history':
            user_id = query.get('user_id', [''])[0].strip()
            history_dict = load_user_history()
            hist = history_dict.get(user_id, {
                'past_claim_count': 0,
                'accept_claim': 0,
                'manual_review_claim': 0,
                'rejected_claim': 0,
                'last_90_days_claim_count': 0,
                'history_flags': 'none',
                'history_summary': 'no history'
            })
            self.send_json(hist)

        # API: Get Metrics
        elif path == '/api/metrics':
            metrics_path = REPO_ROOT / 'code' / 'evaluation' / 'evaluation_results.json'
            if metrics_path.exists():
                self.serve_file(metrics_path, 'application/json')
            else:
                self.send_json({"error": "No evaluation results available. Run evaluation first."})
        else:
            self.send_error(404, "Page not found")

    def do_POST(self):
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path

        # API: Verify Claim
        if path == '/api/verify':
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            params = json.loads(post_data.decode('utf-8'))

            dataset = params.get('dataset', 'test')
            idx = int(params.get('index', 0))
            strategy = params.get('strategy', 'strategy_a')

            # Load row
            csv_name = 'sample_claims.csv' if dataset == 'sample' else 'claims.csv'
            csv_path = REPO_ROOT / 'dataset' / csv_name
            
            if not csv_path.exists():
                self.send_json({"error": "CSV dataset not found"}, status=404)
                return

            import pandas as pd
            df = pd.read_csv(csv_path)
            if idx < 0 or idx >= len(df):
                self.send_json({"error": f"Invalid row index: {idx}"}, status=400)
                return

            row = df.iloc[idx].to_dict()
            history_dict = load_user_history()
            er_df = load_evidence_requirements()

            # Execute
            try:
                if strategy == 'strategy_b':
                    verdict, in_t, out_t = call_claude_strategy_b(client, row, history_dict, er_df, REPO_ROOT)
                else:
                    verdict, in_t, out_t = call_claude_strategy_a(client, row, history_dict, er_df, REPO_ROOT)
                
                response_data = {
                    "verdict": verdict,
                    "input_tokens": in_t,
                    "output_tokens": out_t,
                    "estimated_cost_usd": (in_t / 1e6) * 3.0 + (out_t / 1e6) * 15.0
                }
            except Exception as e:
                # Fallback to local heuristic parser
                hist = history_dict.get(row['user_id'], {})
                verdict = get_heuristic_fallback(row, hist, er_df, REPO_ROOT, error_msg=f"API error: {str(e)}")
                response_data = {
                    "verdict": verdict,
                    "input_tokens": 0,
                    "output_tokens": 0,
                    "estimated_cost_usd": 0.0
                }

            self.send_json(response_data)
        else:
            self.send_error(404, "Endpoint not found")

    def serve_file(self, file_path, content_type):
        if file_path.exists() and file_path.is_file():
            self.send_response(200)
            self.send_header('Content-Type', content_type)
            # Add length if text or known
            stat = file_path.stat()
            self.send_header('Content-Length', str(stat.st_size))
            self.end_headers()
            with open(file_path, 'rb') as f:
                self.wfile.write(f.read())
        else:
            self.send_error(404, f"File not found: {file_path.name}")

    def send_json(self, data, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        response_bytes = json.dumps(data).encode('utf-8')
        self.send_header('Content-Length', str(len(response_bytes)))
        self.end_headers()
        self.wfile.write(response_bytes)

def run_server(port=8000):
    server_address = ('', port)
    httpd = HTTPServer(server_address, DashboardRequestHandler)
    print(f"Visual Claim Verification Dashboard Server started on http://localhost:{port}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server...")
        httpd.server_close()

if __name__ == '__main__':
    port = 8000
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            pass
    run_server(port)
