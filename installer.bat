@echo off
rem A lancer UNE fois sur chaque ordinateur, depuis le dossier de Silencio (un clone git du depot).
rem Cree le raccourci « Silencio » sur le bureau : il met Silencio a jour puis l'ouvre dans le navigateur.
chcp 65001 >nul
cd /d "%~dp0"
where git >nul 2>nul || (
  echo Git n'est pas installe. Installation...
  winget install --id Git.Git -e --source winget || (echo Installez Git : https://git-scm.com/download/win & pause & exit /b 1)
)
set PY=python
where py >nul 2>nul && set PY=py -3
%PY% --version >nul 2>nul || (
  echo Python n'est pas installe. Installation...
  winget install --id Python.Python.3.12 -e --source winget || (echo Installez Python : https://www.python.org/downloads/ & pause & exit /b 1)
)
if not exist donnees mkdir donnees
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\Silencio.lnk');" ^
  "$s.TargetPath='%~dp0lancer.bat';$s.WorkingDirectory='%~dp0';$s.IconLocation='%~dp0web\icone.ico';$s.WindowStyle=7;" ^
  "$s.Description='Silencio (toujours la derniere version)';$s.Save()"
echo.
echo Le raccourci « Silencio » est sur le bureau.
pause
