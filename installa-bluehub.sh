#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
# SPDX-FileCopyrightText: 2026 bria-bria
# ============================================================
#  installa-bluehub.sh  (installazione di sviluppo)
#  1. Chiude l'eventuale vecchio pannello Python (versioni precedenti)
#  2. Aggiorna l'estensione GNOME Shell "BlueHub" (UUID letto da metadata.json)
#     e rimuove la vecchia versione con UUID bluehub@michele.local
#  3. Aggiorna la scorciatoia nel menu Applicazioni
#  4. Apre il pannello BlueHub (finestra Preferenze dell'estensione)
#
#  Nota: su Wayland (GNOME 45+) il codice nuovo del pulsante nel menu rapido
#  (extension.js, bluehub-core.js) viene caricato solo dopo logout/login.
#  Il pannello (prefs.js) invece si aggiorna subito. Lo script lo segnala.
# ============================================================
set -euo pipefail

# --- Non va lanciato con sudo: lavora tutto nella tua home ---
if [[ $EUID -eq 0 ]]; then
    echo "ERRORE: non lanciare questo script con sudo. Lancialo come utente normale." >&2
    exit 1
fi

# --- Percorsi (ricavati, non scritti a mano) ---
PROJ_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
EXT_SRC="$PROJ_DIR/bluehub-extension"
EXT_ROOT="$HOME/.local/share/gnome-shell/extensions"
OLD_UUID="bluehub@michele.local"          # vecchia versione, da togliere
DESKTOP_DIR="$HOME/.local/share/applications"
EXT_FILES=(metadata.json extension.js prefs.js bluehub-core.js)
# File che il menu rapido carica solo al login (prefs.js invece si ricarica da solo)
SHELL_FILES=(metadata.json extension.js bluehub-core.js)

# --- Controllo che ci siano tutti i file PRIMA di toccare qualcosa ---
for f in "${EXT_FILES[@]/#/$EXT_SRC/}"; do
    if [[ ! -f "$f" ]]; then
        echo "ERRORE: file mancante: $f" >&2
        exit 1
    fi
done

# UUID: unica fonte è metadata.json
EXT_UUID="$(sed -n 's/.*"uuid"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$EXT_SRC/metadata.json")"
if [[ -z "$EXT_UUID" ]]; then
    echo "ERRORE: UUID non trovato in metadata.json" >&2
    exit 1
fi
EXT_DEST="$EXT_ROOT/$EXT_UUID"

# --- 1. Chiude il vecchio pannello Python, se ancora aperto (versioni precedenti) ---
# Solo comandi che INIZIANO con python3 e hanno come argomento .../bluehub.py
PATTERN="^(/usr/bin/)?python3? [^ ]*bluehub\.py( |$)"
pkill -f "$PATTERN" 2>/dev/null || true

# --- 2. Aggiorna l'estensione (unica fonte: cartella bluehub-extension/) ---
mkdir -p "$EXT_DEST"
EXT_CHANGED=0
for f in "${EXT_FILES[@]}"; do
    if ! cmp -s "$EXT_SRC/$f" "$EXT_DEST/$f"; then
        for s in "${SHELL_FILES[@]}"; do
            [[ $f == "$s" ]] && EXT_CHANGED=1
        done
        cp -f "$EXT_SRC/$f" "$EXT_DEST/$f"
    fi
done
# Il vecchio pannello Python non fa più parte dell'estensione
rm -f -- "$EXT_DEST/bluehub.py"

# Toglie la vecchia versione (altrimenti al login comparirebbero due pulsanti BlueHub)
if [[ "$OLD_UUID" != "$EXT_UUID" && -d "$EXT_ROOT/$OLD_UUID" ]]; then
    gnome-extensions disable "$OLD_UUID" 2>/dev/null || true
    rm -rf -- "${EXT_ROOT:?}/$OLD_UUID"
    echo "Rimossa la vecchia estensione $OLD_UUID."
    EXT_CHANGED=1
fi

# Attiva la nuova. Se GNOME non la conosce ancora (estensione appena installata,
# su Wayland serve il login), la aggiunge alla lista così parte al prossimo login.
EXT_KNOWN=1
if ! gnome-extensions enable "$EXT_UUID" 2>/dev/null; then
    EXT_KNOWN=0
    CURRENT="$(gsettings get org.gnome.shell enabled-extensions)"
    if [[ "$CURRENT" != *"'$EXT_UUID'"* ]]; then
        if [[ "$CURRENT" == "@as []" || "$CURRENT" == "[]" ]]; then
            gsettings set org.gnome.shell enabled-extensions "['$EXT_UUID']"
        else
            gsettings set org.gnome.shell enabled-extensions "${CURRENT%]}, '$EXT_UUID']"
        fi
    fi
    echo "La nuova estensione $EXT_UUID verrà attivata al prossimo login."
    EXT_CHANGED=1
fi

# --- 3. Scorciatoia nel menu Applicazioni: apre il pannello (Preferenze) ---
mkdir -p "$DESKTOP_DIR"
cat > "$DESKTOP_DIR/bluehub.desktop" <<EOF
[Desktop Entry]
Name=BlueHub
Comment=Connessioni Bluetooth Multiple (Gamepad e Audio Condiviso)
Exec=gnome-extensions prefs $EXT_UUID
Icon=bluetooth-active
Terminal=false
Type=Application
Categories=AudioVideo;Audio;Settings;Game;
EOF

# --- 4. Apre il pannello ---
if [[ $EXT_KNOWN -eq 1 ]]; then
    gnome-extensions prefs "$EXT_UUID" || echo "ATTENZIONE: impossibile aprire il pannello BlueHub." >&2
fi

echo "============================================================"
echo " BlueHub aggiornato."
if [[ $EXT_CHANGED -eq 1 ]]; then
    echo ""
    echo " ⚠  Il pulsante nel menu rapido è cambiato: per vederlo aggiornato"
    echo "    fai LOGOUT e poi LOGIN (su Wayland è obbligatorio)."
fi
echo "============================================================"
