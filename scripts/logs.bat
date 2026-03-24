@echo off
setlocal

title KRONOS Logs
echo.

cd /d "%~dp0..\docker"

docker compose version >nul 2>&1
if %errorlevel% equ 0 (
    set "COMPOSE=docker compose"
) else (
    set "COMPOSE=docker-compose"
)

set "SERVICE=%~1"

if "%SERVICE%"=="" (
    echo KRONOS - All service logs  [Ctrl+C to stop]
    echo.
    %COMPOSE% logs -f --tail=50
) else (
    echo KRONOS - Logs for: %SERVICE%  [Ctrl+C to stop]
    echo.
    %COMPOSE% logs -f --tail=100 %SERVICE%
)

endlocal
