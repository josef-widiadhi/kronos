@echo off
setlocal EnableDelayedExpansion

title KRONOS Reset
echo.
echo KRONOS - Full Reset
echo ============================================================
echo  WARNING: This permanently deletes ALL data:
echo    - PostgreSQL database  (agents, collections, approvals)
echo    - ChromaDB vector store (all embeddings)
echo    - Ollama models         (must re-pull after reset)
echo    - Redis cache
echo ============================================================
echo.
set "CONFIRM="
set /p "CONFIRM=  Type RESET to confirm, anything else to cancel: "

if /i not "!CONFIRM!"=="RESET" (
    echo.
    echo Cancelled. No changes made.
    pause & exit /b 0
)

echo.
echo Removing all containers and volumes...

cd /d "%~dp0..\docker"

docker compose version >nul 2>&1
if %errorlevel% equ 0 (
    docker compose down -v
) else (
    docker-compose down -v
)

docker volume rm kronos_postgres_data >nul 2>&1
docker volume rm kronos_chroma_data   >nul 2>&1
docker volume rm kronos_ollama_data   >nul 2>&1
docker volume rm kronos_redis_data    >nul 2>&1

echo.
echo [OK] Full reset complete.
echo Run start.bat to start fresh.
echo.
pause
endlocal
