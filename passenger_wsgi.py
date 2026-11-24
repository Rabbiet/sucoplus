import os
import sys

# Pastikan direktori root proyek ada di sys.path
PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
if PROJECT_DIR not in sys.path:
    sys.path.insert(0, PROJECT_DIR)

# Import instance Flask sebagai 'application' sesuai standar WSGI cPanel
from app import app as application