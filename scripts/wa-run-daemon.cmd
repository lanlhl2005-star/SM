@echo off
REM Site Memo Baileys photo backup daemon — for Task Scheduler "At log on".
cd /d "%~dp0.."
node src\wa-backup\index.js run
