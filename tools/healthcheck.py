"""Container-Healthcheck: antwortet die API?"""
import os
import sys
import urllib.request

try:
    urllib.request.urlopen("http://127.0.0.1:%s/api/auth/me" % os.environ.get("KESTREL_PORT", "5000"), timeout=4)
except Exception:
    sys.exit(1)
