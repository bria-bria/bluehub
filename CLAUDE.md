# BlueHub — istruzioni per Claude

Rispondere sempre in italiano. Guidare Michele un passo alla volta.

## Cos'è
Estensione GNOME Shell, tutta in GJS, per gestire più dispositivi Bluetooth
insieme (gamepad, cuffie) e l'audio condiviso. Il pannello è la finestra
Preferenze (`prefs.js`); la logica comune sta in `bluehub-core.js`.
Il vecchio pannello Python `bluehub.py` è stato eliminato il 04/11/2026
(regola di extensions.gnome.org: gli script devono essere in GJS).
Repository git in questa cartella, collegato a GitHub `bria-bria/bluehub`, reso **pubblico**
il 04/11/2026 perché extensions.gnome.org richiede il campo `url`.
I commit usano l'email anonima 301696067+bria-bria@users.noreply.github.com
(configurata in questo repository): non usare l'email personale.

## Origine
Copiato il 04/11/2026 da `Projects/Mio Portatile Linux/` (la copia là è vecchia,
non più usata). Dal 04/11/2026 l'installazione si fa da qui con
`./installa-bluehub.sh`, che copia i file in
`~/.local/share/gnome-shell/extensions/<uuid>/` e apre il pannello con
`gnome-extensions prefs <uuid>`.

**Alla fine di ogni modifica importante fare sempre la revisione con la skill
code-review** (richiesta di Michele, 04/11/2026).

## Traduzioni (dal 04/11/2026)
Testi del codice in **inglese**, passati a `_()` di `bluehub-i18n.js`; l'italiano è
nella tabella `IT` dello stesso file, che è anche l'elenco completo delle frasi.
**Ogni frase nuova va aggiunta alla tabella `IT`** (altrimenti in italiano resta
inglese e non arriva ai file degli utenti). Le altre lingue le traducono gli
utenti in `~/.config/bluehub/translations/<lingua>.json`: il pannello aggiunge in
fondo le frasi nuove senza toccare quelle tradotte. Documentato nel README.

## Smart Calendar Hub (dal 05/11/2026)
Con l'hub installato BlueHub sta **tutto dentro l'hub** (decisione di Michele):
"Apri pannello" chiama `stateObj.showExternalPage({id, title, buildPage, buildSidePage, keepStyle})`
di `smart-calendar-hub@bria-bria.github.io` (API creata apposta dalla sessione "Smart Calendar
Hub refactor"; `externalPageFeatures` contiene `'side'` se c'è il riquadro affiancato).
Colonna dell'hub: attivazione, Cerca BT, antenne, canali + / −; riquadro affiancato (come il
calendario): liste dispositivi. Senza l'hub: la finestra Preferenze.
Architettura: `bluehub-panel-model.js` = stato/regole/testi senza grafica (`view()` testi lunghi,
`short()` righe brevi); facce: `prefs.js` (GTK), `bluehub-hub-kit.js` (kit dell'hub, "Page model":
README di Smart Calendar Hub) e `bluehub-hub-panel.js` (St, ripiego se l'hub non ha il kit). **Le modifiche alla logica vanno nel
modello**, non nelle facce. Pulsante nel menu rapido = scorciatoia, sempre a una colonna,
icona `icons/bluehub-symbolic.svg` ("hub a raggi"). Nessuna icona in barra o nel vassoio.

## Obiettivo: pubblicare su extensions.gnome.org
Cose da sistemare prima (vedi `00_INDICE.md`):
1. ~~`bluehub.py` dentro l'estensione, aperto con percorso relativo (`this.path`)~~ fatto
2. ~~comandi `pactl` asincroni~~ fatto
3. ~~togliere `effect_input.xps17_eq`~~ fatto: ora è "fallback_sink" nel `~/.config/bluehub.json` di Michele
4. ~~UUID `bluehub@bria-bria.github.io`~~ fatto (il vecchio `bluehub@michele.local` viene rimosso da `installa-bluehub.sh`; NON usare più lo script vecchio in `Mio Portatile Linux`, reinstallerebbe la versione vecchia)
5. ~~licenza GPL-2.0-or-later~~ fatto (`LICENSE` + SPDX, autore "bria-bria"); campo `url` = https://github.com/bria-bria/bluehub
   (obbligatorio per extensions.gnome.org)

Pubblicare su GitHub e caricare su extensions.gnome.org: **solo con il sì di
Michele**. L'account e il caricamento su extensions.gnome.org li fa lui.
