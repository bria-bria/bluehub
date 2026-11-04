# BlueHub — indice

| File | Cosa contiene |
|---|---|
| `bluehub-extension/bluehub.py` | Pannello di controllo GTK4 (canali BT, microfoni, audio condiviso) |
| `bluehub-extension/extension.js` | Pulsante nel menu rapido di GNOME |
| `bluehub-extension/prefs.js` | Finestra preferenze (apre il pannello) |
| `bluehub-extension/metadata.json` | Nome, UUID, versioni GNOME supportate |
| `installa-bluehub.sh` | Installa/aggiorna l'estensione e apre il pannello |
| `README.md` | Descrizione pubblica del progetto |
| `CLAUDE.md` | Istruzioni e stato del lavoro |

## Strada verso extensions.gnome.org
- [x] Cartella dedicata + git locale (04/11/2026)
- [x] `bluehub.py` dentro l'estensione, percorso relativo (04/11/2026, ramo `ego/percorso-relativo`)
- [x] Comandi `pactl` asincroni (04/11/2026)
- [x] Tolte impostazioni specifiche dell'XPS 17: ora "fallback_sink" in ~/.config/bluehub.json (04/11/2026)
- [ ] Nuovo UUID (`bluehub@bria-bria.github.io`)
- [ ] Licenza GPL (senza campo `url`: repository privato)
- [x] Su GitHub, privato: `bria-bria/bluehub` (04/11/2026)
- [ ] Caricamento su extensions.gnome.org (lo fa Michele)
