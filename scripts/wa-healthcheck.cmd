@echo off
cd /d "%~dp0.."
node scripts\run-with-unc.mjs src\wa-backup\index.js health
exit /b %ERRORLEVEL%
