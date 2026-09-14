@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo [错误] 未找到 Node.js。请先安装 Node 20 或更高版本：
  echo        https://nodejs.org/
  echo.
  pause
  exit /b 1
)

node scripts/install.mjs
echo.
pause
