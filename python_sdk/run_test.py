from sqlalchemy import create_engine
import sys
import requests

try:
    r = requests.get("http://127.0.0.1:8000/api/tasks")
    print(r.status_code, r.text)
except Exception as e:
    print(e)
