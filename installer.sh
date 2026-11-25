#!/bin/sh
# Mac / Linux : crée un lanceur « Silencio » (Linux : menu des applications ; Mac : lancer.sh à double-cliquer).
cd "$(dirname "$0")"
chmod +x lancer.sh
if [ -d "$HOME/.local/share/applications" ] || mkdir -p "$HOME/.local/share/applications" 2>/dev/null; then
  cat > "$HOME/.local/share/applications/silencio.desktop" <<FIN
[Desktop Entry]
Name=Silencio
Exec=$(pwd)/lancer.sh
Icon=$(pwd)/web/icone.png
Type=Application
Terminal=false
FIN
fi
echo "Lanceur créé. (Mac : double-cliquez lancer.sh, ou lancez « python3 main.py »)"
