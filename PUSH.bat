@echo off
echo Deploying to GitHub (auto-deploys to Cloudflare)...
git add .
git commit -m "Update %date% %time%"
git push origin main
echo.
echo Done! Cloudflare will auto-deploy in ~1 minute.
pause
