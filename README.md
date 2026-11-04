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

## Installazione (sviluppo)

```bash
./installa-bluehub.sh
```

Su Wayland le modifiche all'estensione si vedono solo dopo logout/login.

## Stato

In preparazione per la pubblicazione su extensions.gnome.org.
