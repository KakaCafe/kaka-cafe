@echo off
title Kaka Cafe - Push Update
color 0A
echo.
echo  ================================================
echo    KAKA CAFE - Push Update to Cloudflare
echo  ================================================
echo.

where node >nul 2>&1
if %errorlevel% neq 0 goto NO_NODE

where wrangler >nul 2>&1
if %errorlevel% neq 0 goto INSTALL_WRANGLER
goto BUILD

:NO_NODE
echo  [ERROR] Node.js not found. Download from nodejs.org
pause & exit /b 1

:INSTALL_WRANGLER
echo  Installing Wrangler...
call npm install -g wrangler
if %errorlevel% neq 0 (echo [ERROR] Wrangler install failed & pause & exit /b 1)

:BUILD
echo  Building...
call npm install --silent
call npm run build
if %errorlevel% neq 0 (echo [ERROR] Build failed & pause & exit /b 1)

set CF_PROJECT=kaka-cafe
if exist .cloudflare-config (
    for /f "tokens=1,2 delims==" %%a in (.cloudflare-config) do (
        if "%%a"=="CF_PROJECT" set CF_PROJECT=%%b
    )
)

echo  Deploying to %CF_PROJECT%.pages.dev ...
call wrangler pages deploy dist --project-name=%CF_PROJECT% --commit-dirty=true
if %errorlevel% neq 0 goto FAIL

echo.
echo  ================================================
echo    LIVE at https://%CF_PROJECT%.pages.dev
echo  ================================================
pause
exit /b 0

:FAIL
echo  [ERROR] Deploy failed. Try: wrangler login  then run again.
pause
exit /b 1
