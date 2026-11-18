@echo off
REM Site Memo Baileys photo backup daemon — for Task Scheduler "At log on".
REM Uses run-with-unc so \\Server\... is allowlisted for Node UNC checks.
cd /d "%~dp0.."
node scripts\run-with-unc.mjs src\wa-backup\index.js run
