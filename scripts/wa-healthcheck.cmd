@echo off
cd /d "%~dp0.."
node src\wa-backup\index.js health
exit /b %ERRORLEVEL%
