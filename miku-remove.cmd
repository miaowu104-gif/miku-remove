@echo off
rem miku-voicebank show launcher (Windows)
rem   miku-remove.cmd            full show (~4m45s)
rem   miku-remove.cmd --check    report song / timeline / player status
rem   miku-remove.cmd --help     all switches
rem   miku-remove.cmd --fast     print the whole show at once
setlocal enableextensions
set "MIKU_HOME=%~dp0"
if "%MIKU_HOME:~-1%"=="\" set "MIKU_HOME=%MIKU_HOME:~0,-1%"

where node >nul 2>&1
if errorlevel 1 (
  echo [miku-voicebank] Node.js not found. Install Node.js 18+ and put it on PATH.
  echo.
  pause
  exit /b 1
)

rem console -> UTF-8; ANSI escapes are switched on by miku-show.mjs itself
chcp 65001 >nul 2>&1

node "%MIKU_HOME%\src\miku-show.mjs" %*
rem keep the window open when the launcher was double-clicked
if errorlevel 1 pause
exit /b %ERRORLEVEL%
