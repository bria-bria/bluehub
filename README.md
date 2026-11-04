# BlueHub

Gestione di più connessioni Bluetooth contemporanee su GNOME:
2+ gamepad, 2+ cuffie/casse, audio condiviso automatico tra più cuffie.

È composto da due parti:

- **Estensione GNOME Shell** (`bluehub-extension/`): un pulsante nel menu rapido
  per attivare/disattivare BlueHub e vedere i canali Bluetooth in uso.
- **Pannello di controllo** (`bluehub-extension/bluehub.py`): finestra GTK4/libadwaita per
  distribuire i canali tra gamepad e cuffie, gestire i microfoni e l'audio condiviso.

## Requisiti

- GNOME Shell 45 o successivo
- Python 3 con PyGObject, GTK 4 e libadwaita
- BlueZ (`bluetoothctl`) e PipeWire con `pipewire-pulse` (`pactl`)

## Configurazione

Le impostazioni stanno in `~/.config/bluehub.json`. Facoltativo:

```json
{ "fallback_sink": "nome-dell-uscita" }
```

`fallback_sink` è l'uscita audio da usare quando non ci sono cuffie Bluetooth
o BlueHub è spento (i nomi si vedono con `pactl list short sinks`).
Se non è impostata, BlueHub lascia scegliere al sistema.

## Installazione (sviluppo)

```bash
./installa-bluehub.sh
```

Su Wayland le modifiche all'estensione si vedono solo dopo logout/login.

## Licenza

GPL-2.0-or-later: vedi il file [LICENSE](LICENSE).

## Stato

In preparazione per la pubblicazione su extensions.gnome.org.
