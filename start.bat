@echo off
rem Kindred launcher.
rem   start.bat          check requirements, update, build if needed, then run the app
rem   start.bat dev      same checks, then run in development mode (npm run tauri dev)
rem   start.bat check    only check and report; installs, updates and builds nothing
rem All the work is done by scripts\launcher.ps1 (readable, commented). Log: launcher.log
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launcher.ps1" %*
exit /b %errorlevel%
