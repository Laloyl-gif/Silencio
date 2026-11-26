@echo off
rem Publie une nouvelle version : glisse le .zip recu (silencio.zip) sur ce fichier.
rem Le code du depot est remplace par celui du zip, puis envoye sur GitHub : le PC (raccourci du bureau)
rem et les telephones (application) se mettent a jour tout seuls au prochain lancement.
chcp 65001 >nul
cd /d "%~dp0.."
if "%~1"=="" (echo Glisse le fichier .zip de la nouvelle version sur publier_version.bat & pause & exit /b 1)
set PY=python
where py >nul 2>nul && set PY=py -3
%PY% outils\publier_version.py "%~1"
pause
