@echo off
rem Met Silencio sur GitHub la premiere fois (depot public cree sur github.com, par exemple « Silencio »).
rem Lance-le, puis colle l'adresse du depot (https://github.com/COMPTE/Silencio).
chcp 65001 >nul
cd /d "%~dp0.."
set /p URL=Adresse du depot GitHub : 
if not exist ".git" git init -b main
git add -A
git commit -m "Silencio"
git remote remove origin 2>nul
git remote add origin %URL%
git push -u origin main --force || (echo. & echo ECHEC de l'envoi sur GitHub : verifie l'adresse et la connexion. & pause & exit /b 1)
echo.
echo Fait. Lance maintenant installer.bat (dans le dossier de Silencio, a cote de main.py) pour creer le raccourci du bureau.
pause
