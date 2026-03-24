@echo off
setlocal EnableDelayedExpansion

title KRONOS Startup
echo.
echo  KRONOS - Knowledge Runtime Orchestration and Node Operating System
echo  ===================================================================
echo.

cd /d "%~dp0..\docker"

echo [1/4] Checking dependencies...

where docker >nul 2>&1
if %errorlevel% neq 0 (
    echo   [ERROR] Docker not found.
    echo   Install Docker Desktop: https://www.docker.com/products/docker-desktop/
    pause & exit /b 1
)
echo   [OK] docker found

docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo   [ERROR] Docker Desktop is not running.
    echo   Start Docker Desktop then re-run this script.
    pause & exit /b 1
)
echo   [OK] Docker daemon running

docker compose version >nul 2>&1
if %errorlevel% equ 0 (
    set "COMPOSE=docker compose"
    echo   [OK] docker compose v2
) else (
    docker-compose --version >nul 2>&1
    if %errorlevel% equ 0 (
        set "COMPOSE=docker-compose"
        echo   [OK] docker-compose v1
    ) else (
        echo   [ERROR] docker compose not found.
        pause & exit /b 1
    )
)

echo.
echo [2/4] Checking configuration...

:: Check if secrets.env exists and is valid (not a placeholder)
set "NEED_SECRETS=1"
if exist "secrets.env" (
    findstr /c:"REPLACE_ME" "secrets.env" >nul 2>&1
    if !errorlevel! neq 0 (
        echo   [OK] secrets.env found and configured
        set "NEED_SECRETS=0"
    ) else (
        echo   [WARN] secrets.env has placeholder values - regenerating...
    )
) else (
    echo   secrets.env not found - creating now...
)

if "!NEED_SECRETS!"=="0" goto env_ok

echo.

:: Generate a secret key
for /f "delims=" %%i in ('powershell -NoProfile -Command "[System.Guid]::NewGuid().ToString('N') + [System.Guid]::NewGuid().ToString('N')"') do set "SECRET_KEY=%%i"

:: Try Python for custom password, fall back to default admin/admin
where python >nul 2>&1
if %errorlevel% neq 0 goto use_default_hash

python -m pip show bcrypt >nul 2>&1
if %errorlevel% neq 0 python -m pip install bcrypt -q >nul 2>&1

:ask_pass
set "PASS="
set "PASS2="
for /f "delims=" %%i in ('powershell -NoProfile -Command "$s=Read-Host -Prompt '  Set password (default: admin)' -AsSecureString;[Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))"') do set "PASS=%%i"

:: If empty, use default admin password
if "!PASS!"=="" (
    echo   Using default password: admin
    set "PASS=admin"
    goto gen_hash
)

for /f "delims=" %%i in ('powershell -NoProfile -Command "$s=Read-Host -Prompt '  Confirm password' -AsSecureString;[Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))"') do set "PASS2=%%i"

if not "!PASS!"=="!PASS2!" (
    echo   [ERROR] Passwords do not match. Try again.
    echo.
    goto ask_pass
)

:gen_hash
python -c "import sys,bcrypt; h=bcrypt.hashpw(sys.argv[1].encode(),bcrypt.gensalt(12)).decode(); he=h.replace('$','$$'); open('secrets.env','w').write('SECRET_KEY='+sys.argv[2]+chr(10)+'OWNER_USERNAME=admin'+chr(10)+'OWNER_PASSWORD_HASH='+he+chr(10))" "!PASS!" "!SECRET_KEY!"
if %errorlevel% equ 0 (
    echo   [OK] secrets.env created
    goto env_ok
)

:use_default_hash
echo   [WARN] Using default admin/admin credentials. Change after first login.
(
    echo SECRET_KEY=!SECRET_KEY!
    echo OWNER_USERNAME=admin
    echo OWNER_PASSWORD_HASH=$$2b$$12$$TNITcBiziGQNaaTxPx0h.OT7TuZpx8/Rllbu59bKXGusIG.HWFjNy
) > "secrets.env"
echo   [OK] secrets.env created with default credentials

:env_ok
echo.
echo [3/4] Building and starting services...
echo   First build may take 3-5 minutes.
echo.

%COMPOSE% up -d --build
if %errorlevel% neq 0 (
    echo.
    echo   [WARN] Some services had issues starting (check output above).
    echo   Continuing - core services may still be running...
    echo.
)

echo.
echo [4/4] Waiting for API to be ready...
set /a TRIES=0

:health_loop
if %TRIES% geq 30 (
    echo.
    echo   [WARN] Health check timed out. Try opening http://localhost in 30 seconds.
    goto done
)
curl -sf http://localhost/api/health >nul 2>&1
if %errorlevel% equ 0 goto api_ok
set /a TRIES+=1
echo   Waiting... attempt !TRIES!/30
timeout /t 2 /nobreak >nul
goto health_loop

:api_ok
echo.
echo   [OK] API is healthy

:done
echo.
echo  ============================================================
echo   KRONOS is running!
echo.
echo   Dashboard : http://localhost
echo   API Docs  : http://localhost/docs
echo   Login     : admin / (your password)
echo  ============================================================
echo.
echo   Pull a model to get started:
echo   scripts\pull_model.bat llama3.2
echo.
echo   Other scripts:
echo   scripts\stop.bat     - stop services
echo   scripts\logs.bat     - view logs
echo   scripts\status.bat   - check status
echo.
pause
endlocal
