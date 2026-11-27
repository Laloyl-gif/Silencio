"""Fabrique toutes les icônes de Silencio (web, PC, Android, extension) à partir d'un seul dessin.

Le dessin est fait dans un carré de 100 × 100 (la partie visible). Pour Android (icône adaptative), le fond et les
rideaux débordent sur 25 unités de chaque côté : le lanceur rogne les bords à sa façon sans jamais couper la boîte.
Utilise rsvg-convert (librsvg) et Pillow : python outils/icones.py
"""
import io
import os
import subprocess

from PIL import Image

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

DEFS = """<defs>
  <linearGradient id="nuit" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b1f52"/><stop offset=".7" stop-color="#0e0f24"/><stop offset="1" stop-color="#08080f"/></linearGradient>
  <linearGradient id="velours" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7a0f25"/><stop offset=".55" stop-color="#c8243f"/><stop offset="1" stop-color="#8e1430"/></linearGradient>
  <linearGradient id="velours2" x1="1" y1="0" x2="0" y2="0"><stop offset="0" stop-color="#7a0f25"/><stop offset=".55" stop-color="#c8243f"/><stop offset="1" stop-color="#8e1430"/></linearGradient>
  <linearGradient id="lambrequin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9c1832"/><stop offset="1" stop-color="#d22d49"/></linearGradient>
  <linearGradient id="face" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5671ff"/><stop offset="1" stop-color="#2537c0"/></linearGradient>
  <radialGradient id="lumiere" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#7c8bff" stop-opacity=".55"/><stop offset="1" stop-color="#7c8bff" stop-opacity="0"/></radialGradient>
  <radialGradient id="halo" cx=".5" cy=".42" r=".55"><stop offset="0" stop-color="#3a46b8" stop-opacity=".45"/><stop offset="1" stop-color="#3a46b8" stop-opacity="0"/></radialGradient>
</defs>"""

# le fond : nuit, halo, rideaux ouverts sur les côtés, lambrequin festonné en haut, lumière au sol
SCENE = """
  <rect x="-25" y="-25" width="150" height="150" fill="url(#nuit)"/>
  <ellipse cx="50" cy="48" rx="46" ry="44" fill="url(#halo)"/>
  <ellipse cx="50" cy="79" rx="27" ry="6.5" fill="url(#lumiere)"/>
  <path d="M-25 -25H22C22 18 15 52 22 125H-25Z" fill="url(#velours)"/>
  <path d="M125 -25H78C78 18 85 52 78 125H125Z" fill="url(#velours2)"/>
  <g fill="none" stroke="#5c0919" stroke-opacity=".6" stroke-width="1.3" stroke-linecap="round">
    <path d="M6 10C6 45 3 80 6 125M14 12C14 46 10 84 14 125"/>
    <path d="M94 10C94 45 97 80 94 125M86 12C86 46 90 84 86 125"/>
  </g>
  <path d="M-25 -25H125V12C116 20 108 20 100 13C92 20 84 20 75 13C67 20 58 20 50 13C42 20 33 20 25 13C16 20 8 20 0 13C-8 20 -17 20 -25 12Z" fill="url(#lambrequin)"/>
  <path d="M-25 9C-17 17 -8 17 0 10C8 17 16 17 25 10C33 17 42 17 50 10C58 17 67 17 75 10C84 17 92 17 100 10C108 17 116 17 125 9" fill="none" stroke="#f2c14e" stroke-opacity=".75" stroke-width="1.1"/>
"""

# la boîte bleue, au centre exact de la partie visible (un peu plus bas pour équilibrer le lambrequin)
BOITE = """
  <g transform="translate(50 52) scale(.205)">
    <path d="M0-115 100-60 0-5-100-60z" fill="#8197ff"/>
    <path d="M-100-60 0-5v115l-100-55z" fill="url(#face)"/>
    <path d="M100-60 0-5v115l100-55z" fill="#1b2896"/>
    <path d="M0-66 15-58 0-50-15-58z" fill="#f2c14e"/>
  </g>
"""


def svg(vue, contenu, coins=None):
    clip = ""
    if coins is not None:
        x, y, w, h = vue
        clip = f'<clipPath id="coins"><rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{coins}"/></clipPath>'
        contenu = f'<g clip-path="url(#coins)">{contenu}</g>'
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{" ".join(map(str, vue))}">{DEFS}{clip}{contenu}</svg>')


def rendre(code, taille):
    png = subprocess.run(["rsvg-convert", "-w", str(taille), "-h", str(taille)], input=code.encode(),
                         capture_output=True, check=True).stdout
    return Image.open(io.BytesIO(png)).convert("RGBA")


def main():
    carre = svg((0, 0, 100, 100), SCENE + BOITE, coins=22)        # web, PC, extension : coins arrondis
    with open(os.path.join(RACINE, "web", "icone.svg"), "w", encoding="utf-8") as f:
        f.write(carre)
    for chemin, taille in [("web/icone.png", 512), ("web/icone-512.png", 512), ("web/icone-192.png", 192),
                           ("android/app/src/main/res/drawable/icone.png", 256),
                           ("android/app/src/main/res/mipmap-xhdpi/ic_lanceur.png", 96),
                           ("android/app/src/main/res/mipmap-xxhdpi/ic_lanceur.png", 144),
                           ("android/app/src/main/res/mipmap-xxxhdpi/ic_lanceur.png", 192),
                           ("extension/icone-48.png", 48), ("extension/icone-96.png", 96),
                           ("extension/icone-128.png", 128)]:
        rendre(carre, taille).save(os.path.join(RACINE, chemin))
    grand = rendre(carre, 256)
    grand.save(os.path.join(RACINE, "web", "icone.ico"), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64),
                                                                  (128, 128), (256, 256)])
    # Android : icône adaptative (fond plein + boîte au premier plan), 108 dp dont 72 dp visibles
    vue = (-25, -25, 150, 150)
    rendre(svg(vue, SCENE), 432).convert("RGB").save(
        os.path.join(RACINE, "android/app/src/main/res/drawable-nodpi/ic_fond.png"))
    rendre(svg(vue, BOITE), 432).save(os.path.join(RACINE, "android/app/src/main/res/drawable-nodpi/ic_premier_plan.png"))


if __name__ == "__main__":
    main()
