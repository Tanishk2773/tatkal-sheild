@echo off
cd /d "%~dp0"
echo Starting Tatkal Shield in Docker. Keep this window open during the demo.
wsl -d Ubuntu -u root -- bash deploy/expo.sh
if errorlevel 1 pause
