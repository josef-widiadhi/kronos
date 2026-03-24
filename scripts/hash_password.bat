@echo off
setlocal EnableDelayedExpansion

title KRONOS Hash Password
echo.
echo KRONOS - Password Hash Generator
echo ============================================================
echo.

set "PYTHON="
where python >nul 2>&1
if %errorlevel% equ 0 set "PYTHON=python"
if "!PYTHON!"=="" (
    where python3 >nul 2>&1
    if %errorlevel% equ 0 set "PYTHON=python3"
)

if "!PYTHON!"=="" (
    echo [ERROR] Python is required.
    echo Install from https://www.python.org/downloads/
    echo Check "Add Python to PATH" during install.
    pause & exit /b 1
)

!PYTHON! -m pip show bcrypt >nul 2>&1
if %errorlevel% neq 0 (
    echo Installing bcrypt...
    !PYTHON! -m pip install bcrypt -q
)

:ask_pass
set "PASS="
set "PASS2="
for /f "delims=" %%i in ('powershell -NoProfile -Command "$s=Read-Host -Prompt '  Enter password' -AsSecureString;[Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))"') do set "PASS=%%i"
for /f "delims=" %%i in ('powershell -NoProfile -Command "$s=Read-Host -Prompt '  Confirm     ' -AsSecureString;[Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))"') do set "PASS2=%%i"

if not "!PASS!"=="!PASS2!" (
    echo   [ERROR] Passwords do not match.
    goto ask_pass
)
if "!PASS!"=="" (
    echo   [ERROR] Password cannot be empty.
    goto ask_pass
)

set "HASH="
for /f "delims=" %%h in ('!PYTHON! -c "import sys,bcrypt; print(bcrypt.hashpw(sys.argv[1].encode(),bcrypt.gensalt(12)).decode())" "!PASS!"') do set "HASH=%%h"

if "!HASH!"=="" (
    echo [ERROR] Hash generation failed.
    pause & exit /b 1
)

echo.
echo ============================================================
echo  Add to docker\secrets.env:
echo.
echo  OWNER_PASSWORD_HASH=!HASH!
echo.
echo ============================================================
echo.

if exist "%~dp0..\docker\secrets.env" (
    set /p "WRITE=  Write to docker\secrets.env automatically? [Y/N]: "
    if /i "!WRITE!"=="Y" (
        !PYTHON! -c "
import re, sys
env_path = sys.argv[1]
new_hash = sys.argv[2].replace('$', '$$')
with open(env_path, 'r') as f:
    content = f.read()
if 'OWNER_PASSWORD_HASH=' in content:
    content = re.sub(r'OWNER_PASSWORD_HASH=.*', 'OWNER_PASSWORD_HASH=' + new_hash, content)
else:
    content = content.rstrip() + chr(10) + 'OWNER_PASSWORD_HASH=' + new_hash + chr(10)
with open(env_path, 'w') as f:
    f.write(content)
print('  [OK] docker\secrets.env updated.')
" "%~dp0..\docker\secrets.env" "!HASH!" || echo   [ERROR] Could not update .env. Edit it manually.
    )
) else (
    echo   docker\secrets.env not found. Copy the hash above and create it manually.
)

echo.
pause
endlocal
