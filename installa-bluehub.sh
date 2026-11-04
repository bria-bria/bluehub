#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
# SPDX-FileCopyrightText: 2026 bria-bria
# ============================================================
#  installa-bluehub.sh
#  1. Chiude eventuali finestre precedenti di BlueHub
#  2. Aggiorna l'estensione GNOME Shell "BlueHub" (UUID letto da metadata.json)
#     e rimuove la vecchia versione con UUID bluehub@michele.local
#  3. Aggiorna la scorciatoia nel menu Applicazioni
#  4. Apre la finestra aggiornata di BlueHub
#
#  Nota: su Wayland (GNOME 45+) il codice nuovo dell'estensione viene
#  caricato solo dopo logout/login. Lo script lo segnala quando serve.
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
APP_ID="io.github.bria_bria.BlueHub"      # deve coincidere con application_id in bluehub.py
DESKTOP_DIR="$HOME/.local/share/applications"
LOG_FILE="$HOME/.cache/bluehub.log"
EXT_FILES=(metadata.json extension.js prefs.js bluehub.py)

# --- Controllo che ci siano tutti i file PRIMA di toccare qualcosa ---
for f in "${EXT_FILES[@]/#/$EXT_SRC/}"; do
    if [[ ! -f "$f" ]]; then
        echo "ERRORE: file mancante: $f" >&2
        exit 1
    fi
done

# UUID: unica fonte è metadata.json
EXT_UUID="$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["uuid"])' "$EXT_SRC/metadata.json")"
EXT_DEST="$EXT_ROOT/$EXT_UUID"
APP="$EXT_DEST/bluehub.py"                # il pannello gira dalla copia installata

# --- 1. Chiude solo i processi Python di BlueHub (non l'editor) e aspetta che escano ---
# Solo comandi che INIZIANO con python3 e hanno come argomento .../bluehub.py
# (non shell o terminali che contengono quelle parole nella loro riga di comando)
PATTERN="^(/usr/bin/)?python3? [^ ]*bluehub\.py( |$)"
if pgrep -f "$PATTERN" >/dev/null; then
    pkill -f "$PATTERN" || true
    for _ in {1..50}; do                       # max 5 secondi
        pgrep -f "$PATTERN" >/dev/null || break
        sleep 0.1
    done
    if pgrep -f "$PATTERN" >/dev/null; then    # ancora vivo: chiusura forzata
        pkill -9 -f "$PATTERN" || true
        sleep 0.3
    fi
fi

# --- 2. Aggiorna l'estensione (unica fonte: cartella bluehub-extension/) ---
mkdir -p "$EXT_DEST"
EXT_CHANGED=0
for f in "${EXT_FILES[@]}"; do
    if ! cmp -s "$EXT_SRC/$f" "$EXT_DEST/$f"; then
        # Solo i file dell'estensione richiedono logout; bluehub.py no
        [[ $f != bluehub.py ]] && EXT_CHANGED=1
        cp -f "$EXT_SRC/$f" "$EXT_DEST/$f"
    fi
done

# Toglie la vecchia versione (altrimenti al login comparirebbero due pulsanti BlueHub)
if [[ "$OLD_UUID" != "$EXT_UUID" && -d "$EXT_ROOT/$OLD_UUID" ]]; then
    gnome-extensions disable "$OLD_UUID" 2>/dev/null || true
    rm -rf -- "${EXT_ROOT:?}/$OLD_UUID"
    echo "Rimossa la vecchia estensione $OLD_UUID."
    EXT_CHANGED=1
fi

# Attiva la nuova. Se GNOME non la conosce ancora (estensione appena installata,
# su Wayland serve il login), la aggiunge alla lista così parte al prossimo login.
if ! gnome-extensions enable "$EXT_UUID" 2>/dev/null; then
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

# --- 3. Scorciatoia nel menu Applicazioni ---
mkdir -p "$DESKTOP_DIR"
cat > "$DESKTOP_DIR/bluehub.desktop" <<EOF
[Desktop Entry]
Name=BlueHub
Comment=Connessioni Bluetooth Multiple (Gamepad e Audio Condiviso)
Exec=/usr/bin/python3 "$APP"
Icon=bluetooth-active
Terminal=false
Type=Application
Categories=AudioVideo;Audio;Settings;Game;
StartupWMClass=$APP_ID
EOF

# --- 4. Apre BlueHub, con log degli errori ---
mkdir -p "$(dirname "$LOG_FILE")"
nohup /usr/bin/python3 "$APP" >"$LOG_FILE" 2>&1 &
APP_PID=$!
sleep 2
if ! kill -0 "$APP_PID" 2>/dev/null; then
    echo "ERRORE: BlueHub si è chiuso subito. Ultime righe del log ($LOG_FILE):" >&2
    tail -n 20 "$LOG_FILE" >&2
    exit 1
fi

echo "============================================================"
echo " BlueHub aggiornato e aperto."
if [[ $EXT_CHANGED -eq 1 ]]; then
    echo ""
    echo " ⚠  L'estensione del pannello è cambiata: per vederla aggiornata"
    echo "    fai LOGOUT e poi LOGIN (su Wayland è obbligatorio)."
fi
echo "============================================================"
