# BlueHub — indice

| File | Cosa contiene |
|---|---|
| `bluehub-extension/extension.js` | Pulsante nel menu rapido di GNOME |
| `bluehub-extension/prefs.js` | Pannello di controllo (finestra Preferenze): canali, Cerca BT, microfoni, audio condiviso |
| `bluehub-extension/bluehub-core.js` | Logica comune: Bluetooth (D-Bus), audio (pactl), configurazione |
| `bluehub-extension/metadata.json` | Nome, UUID, versioni GNOME supportate |
| `installa-bluehub.sh` | Installa/aggiorna l'estensione e apre il pannello |
| `README.md` | Descrizione pubblica del progetto |
| `LICENSE` | Testo della licenza GPL-2.0 |
| `CLAUDE.md` | Istruzioni e stato del lavoro |

## Strada verso extensions.gnome.org
- [x] Cartella dedicata + git locale (04/11/2026)
- [x] `bluehub.py` dentro l'estensione, percorso relativo (04/11/2026, ramo `ego/percorso-relativo`)
- [x] Comandi `pactl` asincroni (04/11/2026)
- [x] Tolte impostazioni specifiche dell'XPS 17: ora "fallback_sink" in ~/.config/bluehub.json (04/11/2026)
- [x] Nuovo UUID `bluehub@bria-bria.github.io` e app id `io.github.bria_bria.BlueHub` (04/11/2026)
- [x] Licenza GPL-2.0-or-later: file `LICENSE` + intestazioni SPDX (04/11/2026; senza campo `url`: repository privato)
- [x] Revisione code-review + correzione di 5 errori (04/11/2026)
- [x] Pannello riscritto in GJS dentro `prefs.js` + `bluehub-core.js`; `bluehub.py` eliminato (04/11/2026)
- [ ] Pacchetto zip per extensions.gnome.org (con `LICENSE` dentro)
- [x] Su GitHub, privato: `bria-bria/bluehub` (04/11/2026)
- [ ] Caricamento su extensions.gnome.org (lo fa Michele)
