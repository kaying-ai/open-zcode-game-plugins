@echo off
rem kui launcher for Windows (cmd.exe / PowerShell).
rem Runs the Node implementation at cli\src\main.mjs.
rem Node ships with the host app, so nothing has to be installed.
setlocal
set "HERE=%~dp0"

where node >nul 2>nul
if not errorlevel 1 (
  node "%HERE%..\src\main.mjs" %*
  exit /b %ERRORLEVEL%
)

set "ROOT=%WORKBUDDY_CONFIG_DIR%"
if not defined ROOT set "ROOT=%CODEBUDDY_CONFIG_DIR%"
if not defined ROOT set "ROOT=%USERPROFILE%\.workbuddy"

for /d %%V in ("%ROOT%\binaries\node\versions\*") do (
  if exist "%%V\node.exe" (
    "%%V\node.exe" "%HERE%..\src\main.mjs" %*
    exit /b %ERRORLEVEL%
  )
)

echo kui: no Node runtime found ^(checked PATH and %ROOT%\binaries\node^) 1>&2
exit /b 2
