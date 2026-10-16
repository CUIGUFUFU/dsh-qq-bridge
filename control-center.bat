@echo off
rem qq-bridge control center: one local web page for the bridge and SnowLuma.
rem It does NOT start the bridge or SnowLuma by itself - use the buttons on the page.
rem Closing this window stops the control center and the processes it started.
chcp 65001 >nul
cd /d "%~dp0"
node scripts\harden-state-acl.mjs --quiet
node src\launcher\control-center.mjs %*
if errorlevel 1 pause
