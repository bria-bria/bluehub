#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
# SPDX-FileCopyrightText: 2026 bria-bria
# ============================================================
#  installa-bluehub.sh  (development install)
#  1. Closes the old Python panel, if running (older versions)
#  2. Updates the "BlueHub" GNOME Shell extension (UUID read from metadata.json)
#     and removes the old version with UUID bluehub@michele.local
#  3. Updates the Applications menu launcher
#  4. Opens the BlueHub panel (extension preferences window)
#
#  Note: on Wayland (GNOME 45+) new Quick Settings code (extension.js,
#  bluehub-core.js) is only loaded after logout/login, while the panel
#  (prefs.js) updates right away. The script says when a re-login is needed.
# ============================================================
set -euo pipefail

# --- Must not run with sudo: everything happens in your home directory ---
if [[ $EUID -eq 0 ]]; then
    echo "ERROR: do not run this script with sudo. Run it as a normal user." >&2
    exit 1
fi

# --- Paths (derived, not hard-coded) ---
PROJ_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
EXT_SRC="$PROJ_DIR/bluehub-extension"
EXT_ROOT="$HOME/.local/share/gnome-shell/extensions"
OLD_UUID="bluehub@michele.local"          # old version, to be removed
DESKTOP_DIR="$HOME/.local/share/applications"
EXT_FILES=(metadata.json extension.js prefs.js bluehub-core.js bluehub-i18n.js bluehub-panel-model.js bluehub-hub-kit.js)
# Files GNOME Shell only reloads at login (prefs.js reloads by itself)
SHELL_FILES=(metadata.json extension.js bluehub-core.js bluehub-i18n.js bluehub-panel-model.js bluehub-hub-kit.js)

# --- Check that every file exists BEFORE touching anything ---
for f in "${EXT_FILES[@]/#/$EXT_SRC/}"; do
    if [[ ! -f "$f" ]]; then
        echo "ERROR: missing file: $f" >&2
        exit 1
    fi
done

# metadata.json is the only source of the UUID
EXT_UUID="$(sed -n 's/.*"uuid"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$EXT_SRC/metadata.json")"
if [[ -z "$EXT_UUID" ]]; then
    echo "ERROR: UUID not found in metadata.json" >&2
    exit 1
fi
EXT_DEST="$EXT_ROOT/$EXT_UUID"

# --- 1. Close the old Python panel, if still open (older versions) ---
# Match only commands that START with python3 and take .../bluehub.py as argument
PATTERN="^(/usr/bin/)?python3? [^ ]*bluehub\.py( |$)"
pkill -f "$PATTERN" 2>/dev/null || true

# --- 2. Update the extension (single source: bluehub-extension/) ---
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
# Icons are used by the Quick Settings button, so they need a re-login too
mkdir -p "$EXT_DEST/icons"
for icon in "$EXT_SRC"/icons/*.svg; do
    [[ -f "$icon" ]] || continue
    if ! cmp -s "$icon" "$EXT_DEST/icons/$(basename "$icon")"; then
        EXT_CHANGED=1
        cp -f "$icon" "$EXT_DEST/icons/"
    fi
done
# The old Python panel is no longer part of the extension
rm -f -- "$EXT_DEST/bluehub.py"

# Remove the old version, otherwise two BlueHub buttons would appear after login
if [[ "$OLD_UUID" != "$EXT_UUID" && -d "$EXT_ROOT/$OLD_UUID" ]]; then
    gnome-extensions disable "$OLD_UUID" 2>/dev/null || true
    rm -rf -- "${EXT_ROOT:?}/$OLD_UUID"
    echo "Removed the old extension $OLD_UUID."
    EXT_CHANGED=1
fi

# Enable the new one. If GNOME does not know it yet (freshly installed; Wayland
# needs a login), add it to the list so it starts at the next login.
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
    echo "The new extension $EXT_UUID will be enabled at the next login."
    EXT_CHANGED=1
fi

# --- 3. Applications menu launcher: opens the panel (preferences) ---
mkdir -p "$DESKTOP_DIR"
cat > "$DESKTOP_DIR/bluehub.desktop" <<EOF
[Desktop Entry]
Name=BlueHub
Comment=Multiple Bluetooth connections (gamepads and shared audio)
Exec=gnome-extensions prefs $EXT_UUID
Icon=bluetooth-active
Terminal=false
Type=Application
Categories=AudioVideo;Audio;Settings;Game;
EOF

# --- 4. Open the panel ---
if [[ $EXT_KNOWN -eq 1 ]]; then
    gnome-extensions prefs "$EXT_UUID" || echo "WARNING: could not open the BlueHub panel." >&2
fi

echo "============================================================"
echo " BlueHub updated."
if [[ $EXT_CHANGED -eq 1 ]]; then
    echo ""
    echo " The Quick Settings button has changed: to load the new version,"
    echo " log out and log back in (required on Wayland)."
fi
echo "============================================================"
