#!/usr/bin/env bash
# ============================================================
#  installa-bluehub.sh
#  1. Chiude eventuali finestre precedenti di BlueHub
#  2. Aggiorna l'estensione GNOME Shell "BlueHub" (bluehub@michele.local)
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
EXT_UUID="bluehub@michele.local"
EXT_SRC="$PROJ_DIR/bluehub-extension"
EXT_DEST="$HOME/.local/share/gnome-shell/extensions/$EXT_UUID"
APP="$EXT_DEST/bluehub.py"                # il pannello gira dalla copia installata
DESKTOP_DIR="$HOME/.local/share/applications"
APP_ID="local.michele.BlueHub"
LOG_FILE="$HOME/.cache/bluehub.log"
EXT_FILES=(metadata.json extension.js prefs.js bluehub.py)

# --- Controllo che ci siano tutti i file PRIMA di toccare qualcosa ---
for f in "${EXT_FILES[@]/#/$EXT_SRC/}"; do
    if [[ ! -f "$f" ]]; then
        echo "ERRORE: file mancante: $f" >&2
        exit 1
    fi
done

# --- 1. Chiude solo i processi Python di BlueHub (non l'editor) e aspetta che escano ---
PATTERN="python3? .*bluehub\.py"
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

# 'enable' aggiunge da solo l'estensione alla lista di GNOME: niente gsettings a mano
if ! gnome-extensions enable "$EXT_UUID" 2>/dev/null; then
    echo "ATTENZIONE: GNOME non vede ancora l'estensione: verrà attivata al prossimo login." >&2
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
