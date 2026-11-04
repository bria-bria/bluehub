# BlueHub — istruzioni per Claude

Rispondere sempre in italiano. Guidare Michele un passo alla volta.

## Cos'è
Estensione GNOME Shell + pannello Python (GTK4/libadwaita) per gestire più
dispositivi Bluetooth insieme (gamepad, cuffie) e l'audio condiviso.
Repository git locale in questa cartella (ramo `main`).

## Origine
Copiato il 04/11/2026 da `Projects/Mio Portatile Linux/` (la copia là è vecchia,
non più usata). Dal 04/11/2026 l'installazione si fa da qui con
`./installa-bluehub.sh`: il pannello gira dalla copia installata in
`~/.local/share/gnome-shell/extensions/<uuid>/bluehub.py`.

## Obiettivo: pubblicare su extensions.gnome.org
Cose da sistemare prima (vedi `00_INDICE.md`):
1. ~~`bluehub.py` dentro l'estensione, aperto con percorso relativo (`this.path`)~~ fatto
2. comandi `pactl` asincroni (ora `communicate_utf8` sincrono blocca GNOME)
3. togliere `effect_input.xps17_eq` (esiste solo sull'XPS 17 di Michele)
4. UUID con un dominio di Michele (es. `bluehub@<account>.github.io`)
5. licenza GPL-2.0-or-later + campo `url` in `metadata.json`

Pubblicare su GitHub e caricare su extensions.gnome.org: **solo con il sì di
Michele**. L'account e il caricamento su extensions.gnome.org li fa lui.
