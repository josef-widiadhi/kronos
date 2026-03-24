#!/usr/bin/env python3
"""
Generate a bcrypt password hash for KRONOS owner login.
Usage: python3 hash_password.py
"""
import getpass
try:
    import bcrypt
except ImportError:
    import subprocess, sys
    subprocess.check_call([sys.executable, "-m", "pip", "install", "bcrypt"])
    import bcrypt

print("KRONOS - Password Hash Generator")
print("-" * 40)
password = getpass.getpass("Enter owner password: ")
confirm  = getpass.getpass("Confirm password:     ")

if password != confirm:
    print("ERROR: Passwords do not match.")
    exit(1)

hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=12)).decode()

print()
print("-" * 40)
print("Add this to your docker/secrets.env file:")
print()
escaped = hashed.replace("$", "$$")
print(f"OWNER_PASSWORD_HASH={escaped}")
print()
print("Then run: docker compose up -d (from the docker/ directory)")
