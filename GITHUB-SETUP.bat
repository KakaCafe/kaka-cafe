@echo off
echo ============================================
echo  Kaka Cafe POS - GitHub Setup
echo ============================================
echo.

set /p GITHUB_USER=Enter your GitHub username: 

echo.
echo Step 1: Initializing Git...
git init
git add .
git commit -m "Initial commit - Kaka Cafe POS"

echo.
echo Step 2: Connecting to GitHub...
git remote add origin https://github.com/%GITHUB_USER%/kaka-cafe-pos.git
git branch -M main
git push -u origin main

echo.
echo ============================================
echo  DONE! Repo pushed to GitHub.
echo  Now connect Cloudflare Pages to GitHub:
echo  1. Go to Cloudflare Pages dashboard
echo  2. Create new project - Connect to Git
echo  3. Select kaka-cafe-pos repo
echo  4. Build command: npm run build
echo  5. Output directory: dist
echo ============================================
pause
