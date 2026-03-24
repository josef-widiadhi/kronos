@echo off
setlocal

title KRONOS Stop
echo.
echo KRONOS - Stopping all services...
echo Data volumes are preserved. Run start.bat to restart.
echo.

cd /d "%~dp0..\docker"

docker compose version >nul 2>&1
if %errorlevel% equ 0 (
    docker compose down
) else (
    docker-compose down
)

if %errorlevel% equ 0 (
    echo.
    echo [OK] All services stopped.
) else (
    echo.
    echo [WARN] Some services may not have stopped cleanly. Check: docker ps
)

echo.
pause
endlocal
