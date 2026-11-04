# BlueHub

GNOME Shell extension to use several Bluetooth devices at the same time:
2+ gamepads, 2+ headphones/speakers, automatic shared audio across headphones,
headphone microphones and multiple Bluetooth adapters.

*Estensione GNOME Shell per usare più dispositivi Bluetooth insieme. L'italiano è incluso.*

## Features

- **Quick Settings button**: turn BlueHub on/off and see the Bluetooth channels in use.
- **Control panel** (the extension's Preferences window):
  - every Bluetooth adapter has 7 channels; assign them to gamepads or headphones with [ + ] / [ − ];
  - *Search BT* on the adapter you choose, or automatically on the least busy one;
  - turn on the microphone of each Bluetooth headset; 2+ microphones are joined into one;
  - confirmation before disconnecting your mouse or keyboard.
- **Shared audio**: with 2 or more Bluetooth headphones connected, the same audio plays on all of them.

## Requirements

- GNOME Shell 45 or later
- BlueZ and PipeWire with `pipewire-pulse` (`pactl`)

## Installation

From [extensions.gnome.org](https://extensions.gnome.org/extension/11630/bluehub/)
(recommended), or for development:

```bash
git clone https://github.com/bria-bria/bluehub.git
cd bluehub
./installa-bluehub.sh
```

On Wayland, changes to the Quick Settings button are loaded after you log out and back in.

## Settings

Settings are stored in `~/.config/bluehub.json`. Optional:

```json
{ "fallback_sink": "output-name" }
```

`fallback_sink` is the audio output used when no Bluetooth headphones are connected
or BlueHub is turned off (see the names with `pactl list short sinks`).
If it is not set, BlueHub leaves the choice to the system.

## Translations

BlueHub is written in **English** and includes **Italian**.
Any other language can be translated by you, without programming:

1. Open the BlueHub panel once. BlueHub creates the file
   `~/.config/bluehub/translations/<language>.json`
   for your system language (for example `fr.json`, `de.json`, `es.json`).
2. Open the file with a text editor. Each line is
   `"English sentence": "your translation"`. Write your translation between the
   second pair of quotes:

   ```json
   "Search BT": "Rechercher BT",
   "Connect": "Connecter",
   "Disconnect": ""
   ```

   - Sentences left empty (`""`) are shown in English.
   - Keep the words in braces, such as `{hci}` or `{count}`, exactly as they are:
     BlueHub replaces them with real values.
3. Save the file and open the panel again.

**Updates never delete your work.** When a new BlueHub version adds new sentences,
they are appended at the end of your file with an empty translation; everything you
have already translated stays as it is.

If the file contains a mistake (for example a missing comma), BlueHub does not touch
it, shows English and writes the error in the system log (`journalctl --user -f`).

**Please share your translation**: open an
[issue](https://github.com/bria-bria/bluehub/issues) and attach your file,
so it can be included for everyone in the next version.

## License

GPL-2.0-or-later: see [LICENSE](LICENSE).
