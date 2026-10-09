"""Draws the app icons and the in-app logo from the club logo (tools/src/logo-ceibos.png), in the
flyer palette. Needs Pillow. Run from the scanner folder: `python3 tools/make-icons.py`.

  icons/icon-192.png, icons/icon-512.png  "any": logo on a dark-green square
  icons/icon-maskable-512.png             "maskable": logo inside the 80% safe zone
  icons/apple-touch-icon.png              180x180 for the iOS home screen
  icons/logo.png                          transparent logo for the scanner's top bar
"""
from PIL import Image

DARK = (6, 18, 12)
logo = Image.open('tools/src/logo-ceibos.png').convert('RGBA')


def icon(size, share):
    """`share`: the logo's width as a fraction of the icon's."""
    img = Image.new('RGBA', (size, size), DARK + (255,))
    w = round(size * share)
    h = round(logo.height * w / logo.width)
    mark = logo.resize((w, h), Image.LANCZOS)
    img.alpha_composite(mark, ((size - w) // 2, (size - h) // 2))
    return img.convert('RGB')


icon(192, 0.86).save('icons/icon-192.png', optimize=True)
icon(512, 0.86).save('icons/icon-512.png', optimize=True)
icon(512, 0.70).save('icons/icon-maskable-512.png', optimize=True)
icon(180, 0.82).save('icons/apple-touch-icon.png', optimize=True)
small = logo.resize((128, round(logo.height * 128 / logo.width)), Image.LANCZOS)
small.save('icons/logo.png', optimize=True)
