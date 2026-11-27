# Crée le raccourci « Silencio » sur le bureau et dans le menu Démarrer (cherche « Silencio » avec la touche Windows).
# Appelé par installer.bat, ou par Silencio (Réglages, Avancé, « Créer le raccourci »).
$ErrorActionPreference = 'Stop'
$dossier = Split-Path -Parent $PSScriptRoot
$cible = Join-Path $dossier 'lancer.bat'
$icone = Join-Path $dossier 'web\icone.ico'
$endroits = @()
foreach ($nom in 'Desktop', 'DesktopDirectory') {
  try { $p = [Environment]::GetFolderPath($nom); if ($p -and (Test-Path $p)) { $endroits += $p } } catch {}
}
$endroits += Join-Path ([Environment]::GetFolderPath('Programs')) ''
$faits = @()
foreach ($e in ($endroits | Select-Object -Unique)) {
  try {
    $lnk = Join-Path $e 'Silencio.lnk'
    $s = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
    $s.TargetPath = $cible
    $s.WorkingDirectory = $dossier
    $s.IconLocation = $icone
    $s.WindowStyle = 7
    $s.Description = 'Silencio (toujours la dernière version)'
    $s.Save()
    $faits += $lnk
  } catch { Write-Host "Impossible d'écrire dans $e : $_" }
}
if ($faits.Count -eq 0) { Write-Host 'Aucun raccourci créé.'; exit 1 }
$faits | ForEach-Object { Write-Host "Raccourci créé : $_" }
