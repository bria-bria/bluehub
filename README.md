# BlueHub

Gestione di più connessioni Bluetooth contemporanee su GNOME:
2+ gamepad, 2+ cuffie/casse, audio condiviso automatico tra più cuffie.

È un'estensione GNOME Shell scritta interamente in GJS (`bluehub-extension/`):

- **Pulsante nel menu rapido** (`extension.js`): attiva/disattiva BlueHub e mostra
  i canali Bluetooth in uso.
- **Pannello di controllo** (`prefs.js`, la finestra Preferenze dell'estensione):
  distribuisce i canali tra gamepad e cuffie, cerca nuovi dispositivi, gestisce
  i microfoni delle cuffie e l'audio condiviso.
- **Logica comune** (`bluehub-core.js`): Bluetooth (BlueZ via D-Bus), audio
  (PipeWire via `pactl`) e configurazione, usata da entrambi.

## Requisiti

- GNOME Shell 45 o successivo
- BlueZ e PipeWire con `pipewire-pulse` (`pactl`)

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

Su Wayland le modifiche al pulsante nel menu rapido si vedono solo dopo
logout/login; il pannello invece si aggiorna alla riapertura.

## Licenza

GPL-2.0-or-later: vedi il file [LICENSE](LICENSE).

## Stato

In preparazione per la pubblicazione su extensions.gnome.org.
