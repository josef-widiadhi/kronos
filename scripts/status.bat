@echo off
setlocal

title KRONOS Status
echo.
echo KRONOS - Service Status
echo ============================================================
echo.

cd /d "%~dp0..\docker"

docker compose version >nul 2>&1
if %errorlevel% equ 0 (
    docker compose ps
) else (
    docker-compose ps
)

echo.
echo ============================================================
echo API health:
curl -sf http://localhost/api/health >nul 2>&1
if %errorlevel% equ 0 (
    echo   [OK] healthy
) else (
    echo   [--] not reachable - is KRONOS running?
)
echo.
echo Dashboard : http://localhost
echo API Docs  : http://localhost/docs
echo ============================================================
echo.
pause
endlocal
