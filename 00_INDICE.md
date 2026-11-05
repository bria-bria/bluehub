# BlueHub — indice

| File | Cosa contiene |
|---|---|
| `bluehub-extension/extension.js` | Pulsante nel menu rapido di GNOME |
| `bluehub-extension/prefs.js` | Pannello di controllo (finestra Preferenze): canali, Cerca BT, microfoni, audio condiviso |
| `bluehub-extension/icons/bluehub-symbolic.svg` | Icona "hub a raggi" del pulsante nel menu rapido |
| `bluehub-extension/bluehub-panel-model.js` | Modello del pannello: stato, regole e testi (senza grafica), usato da finestra e hub |
| `bluehub-extension/bluehub-hub-panel.js` | Pannello completo dentro Smart Calendar Hub (St): colonna + riquadro affiancato |
| `bluehub-extension/bluehub-hub-kit.js` | Pannello nell'hub con il kit di pezzi dell'hub ("Page model"); il pannello St è il ripiego |
| `bluehub-extension/stylesheet.css` | Stile del pannello nell'hub |
| `bluehub-extension/bluehub-i18n.js` | Traduzioni: inglese di base, italiano incluso, file utente per le altre lingue |
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
- [x] Licenza GPL-2.0-or-later: file `LICENSE` + intestazioni SPDX (04/11/2026)
- [x] Revisione code-review + correzione di 5 errori (04/11/2026)
- [x] Pannello riscritto in GJS dentro `prefs.js` + `bluehub-core.js`; `bluehub.py` eliminato (04/11/2026)
- [x] Pacchetto zip in `dist/` (04/11/2026): `gnome-extensions pack bluehub-extension --extra-source=bluehub-core.js --extra-source=bluehub-i18n.js --extra-source=bluehub-panel-model.js --extra-source=bluehub-hub-panel.js --extra-source=bluehub-hub-kit.js --extra-source=icons --extra-source=../LICENSE --out-dir=dist --force`
- [x] Su GitHub `bria-bria/bluehub`, email dei commit resa anonima; campo `url` in metadata.json (04/11/2026)
- [x] Repository reso pubblico, `main` all'ultima versione (04/11/2026)
- [x] Versione 1 caricata su extensions.gnome.org: estensione 11630 (04/11/2026)
- [x] Traduzioni: inglese di base, italiano incluso, file utente per le altre lingue (04/11/2026)
- [ ] Versione 2 (traduzioni) da caricare su extensions.gnome.org
- [ ] Wiki GitHub: installazione e traduzioni (contenuto già nel README)
