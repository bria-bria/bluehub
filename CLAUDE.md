# BlueHub — istruzioni per Claude

Rispondere sempre in italiano. Guidare Michele un passo alla volta.

## Cos'è
Estensione GNOME Shell + pannello Python (GTK4/libadwaita) per gestire più
dispositivi Bluetooth insieme (gamepad, cuffie) e l'audio condiviso.
Repository git in questa cartella, collegato a GitHub **privato**
`bria-bria/bluehub` (deciso da Michele il 04/11/2026: resta privato anche
dopo la pubblicazione su extensions.gnome.org).

## Origine
Copiato il 04/11/2026 da `Projects/Mio Portatile Linux/` (la copia là è vecchia,
non più usata). Dal 04/11/2026 l'installazione si fa da qui con
`./installa-bluehub.sh`: il pannello gira dalla copia installata in
`~/.local/share/gnome-shell/extensions/<uuid>/bluehub.py`.

## Obiettivo: pubblicare su extensions.gnome.org
Cose da sistemare prima (vedi `00_INDICE.md`):
1. ~~`bluehub.py` dentro l'estensione, aperto con percorso relativo (`this.path`)~~ fatto
2. ~~comandi `pactl` asincroni~~ fatto
3. ~~togliere `effect_input.xps17_eq`~~ fatto: ora è "fallback_sink" nel `~/.config/bluehub.json` di Michele
4. ~~UUID `bluehub@bria-bria.github.io`~~ fatto (il vecchio `bluehub@michele.local` viene rimosso da `installa-bluehub.sh`; NON usare più lo script vecchio in `Mio Portatile Linux`, reinstallerebbe la versione vecchia)
5. licenza GPL-2.0-or-later nel pacchetto; **niente campo `url`** in
   `metadata.json` finché il repository è privato (darebbe 404)

Pubblicare su GitHub e caricare su extensions.gnome.org: **solo con il sì di
Michele**. L'account e il caricamento su extensions.gnome.org li fa lui.
