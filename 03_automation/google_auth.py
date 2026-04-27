"""
Одноразовый скрипт для получения Google OAuth2 refresh token.
Запусти, авторизуйся в браузере — токен сохранится в .env.local
"""
import json, urllib.parse, urllib.request, http.server, webbrowser, threading, sys

CLIENT_ID     = "259600343740-q45hul8m7qklimb68urstspg840lfmbu.apps.googleusercontent.com"
CLIENT_SECRET = "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"
REDIRECT_URI  = "http://localhost:8765"
SCOPES        = "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file"

auth_code = None

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        global auth_code
        params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        auth_code = params.get("code", [None])[0]
        self.send_response(200)
        self.end_headers()
        self.wfile.write("<h2>OK! Return to terminal.</h2>".encode())
    def log_message(self, *args): pass

server = http.server.HTTPServer(("localhost", 8765), Handler)
thread = threading.Thread(target=server.handle_request)
thread.start()

auth_url = (
    "https://accounts.google.com/o/oauth2/auth?"
    + urllib.parse.urlencode({
        "client_id": CLIENT_ID,
        "redirect_uri": REDIRECT_URI,
        "response_type": "code",
        "scope": SCOPES,
        "access_type": "offline",
        "prompt": "consent",
    })
)

print("Открываю браузер для авторизации...")
webbrowser.open(auth_url)
thread.join()

if not auth_code:
    print("Не удалось получить код авторизации.")
    sys.exit(1)

# Меняем код на токены
data = urllib.parse.urlencode({
    "code": auth_code,
    "client_id": CLIENT_ID,
    "client_secret": CLIENT_SECRET,
    "redirect_uri": REDIRECT_URI,
    "grant_type": "authorization_code",
}).encode()

req = urllib.request.Request("https://oauth2.googleapis.com/token", data=data)
with urllib.request.urlopen(req) as r:
    tokens = json.loads(r.read())

refresh_token = tokens.get("refresh_token")
if not refresh_token:
    print("refresh_token не получен. Попробуй удалить доступ приложению в Google и запустить снова.")
    sys.exit(1)

print(f"\n✓ Refresh token получен!")
print(f"\nДобавь в .env.local:\n")
print(f"GOOGLE_CLIENT_ID={CLIENT_ID}")
print(f"GOOGLE_CLIENT_SECRET={CLIENT_SECRET}")
print(f"GOOGLE_REFRESH_TOKEN={refresh_token}")
