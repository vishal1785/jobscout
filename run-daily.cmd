@echo off
cd /d "%~dp0"
node src/index.ts >> data\run.log 2>&1
