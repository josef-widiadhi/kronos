@echo off
setlocal EnableDelayedExpansion

title KRONOS Pull Model
echo.
echo KRONOS - Pull Ollama Model
echo.

set "MODEL=%~1"

if "!MODEL!"=="" (
    echo Popular models:
    echo   llama3.2          ~2GB   general purpose
    echo   llama3.2:1b       ~800MB lightweight
    echo   mistral           ~4GB   strong reasoning
    echo   codellama         ~4GB   code focused
    echo   nomic-embed-text  ~250MB embeddings (already pulled)
    echo.
    set /p "MODEL=Enter model name: "
)

if "!MODEL!"=="" (
    echo [ERROR] No model specified.
    pause & exit /b 1
)

echo.
echo Pulling !MODEL! into kronos_ollama...
echo This may take several minutes depending on model size.
echo.

docker exec -it kronos_ollama ollama pull !MODEL!

if %errorlevel% equ 0 (
    echo.
    echo [OK] Model '!MODEL!' is now available in KRONOS.
    echo Select it in the Ollama page of the dashboard.
) else (
    echo.
    echo [ERROR] Pull failed. Is KRONOS running?
    echo Start it first: scripts\start.bat
)

echo.
pause
endlocal
