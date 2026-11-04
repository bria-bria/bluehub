import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {QuickMenuToggle, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';

const COMBINED_SINK_NAME = 'bluehub_combined_sink';
const APP_SCRIPT = 'bluehub.py';
const CONFIG_FILE = GLib.build_filenamev([GLib.get_home_dir(), '.config', 'bluehub.json']);

// Apre il pannello BlueHub (bluehub.py si trova dentro la cartella dell'estensione)
function launchApp(extensionPath) {
    const appPath = GLib.build_filenamev([extensionPath, APP_SCRIPT]);
    try {
        Gio.Subprocess.new(['python3', appPath], Gio.SubprocessFlags.NONE);
    } catch (e) {
        console.error(`[BlueHub] Impossibile aprire ${appPath}: ${e}`);
    }
}

function runCommand(argv) {
    try {
        const proc = Gio.Subprocess.new(
            argv,
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
        );
        const [, stdout] = proc.communicate_utf8(null, null);
        return stdout || '';
    } catch (e) {
        console.error(`[BlueHub] Errore comando ${argv.join(' ')}: ${e}`);
        return '';
    }
}

function loadConfig() {
    try {
        const [ok, contents] = GLib.file_get_contents(CONFIG_FILE);
        if (ok) {
            return JSON.parse(new TextDecoder().decode(contents));
        }
    } catch (_e) {}
    return {enabled: true};
}

function saveConfig(cfg) {
    try {
        const dir = GLib.path_get_dirname(CONFIG_FILE);
        GLib.mkdir_with_parents(dir, 0o755);
        GLib.file_set_contents(CONFIG_FILE, JSON.stringify(cfg, null, 2));
    } catch (e) {
        console.error(`[BlueHub] Errore salvataggio config: ${e}`);
    }
}

function getHardwareChannelStats() {
    let hosts = 0;
    let links = 0;
    try {
        const dir = Gio.File.new_for_path('/sys/class/bluetooth');
        const enumerator = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = enumerator.next_file(null)) !== null) {
            const name = info.get_name();
            if (/^hci\d+$/.test(name)) {
                hosts++;
            } else if (/^hci\d+:\d+$/.test(name)) {
                links++;
            }
        }
    } catch (_e) {}
    const totalChannels = Math.max(1, hosts) * 7;
    const freeChannels = Math.max(0, totalChannels - links);
    return {totalChannels, activeLinks: links, freeChannels};
}

function applySharedAudioState(enabled) {
    // Rimuove eventuali vecchi combine-sink
    const modulesOut = runCommand(['pactl', 'list', 'short', 'modules']);
    for (const line of modulesOut.split('\n')) {
        if (line.includes('module-combine-sink') &&
            (line.includes(COMBINED_SINK_NAME) || line.includes('multy_bt_sink') || line.includes('audio_condiviso_scelto'))) {
            const id = line.trim().split(/\s+/)[0];
            if (id) {
                runCommand(['pactl', 'unload-module', id]);
            }
        }
    }

    if (!enabled) {
        runCommand(['pactl', 'set-default-sink', 'effect_input.xps17_eq']);
        return 0;
    }

    const out = runCommand(['pactl', '-f', 'json', 'list', 'sinks']);
    if (!out) return 0;
    const btSinks = [];
    try {
        const sinks = JSON.parse(out);
        for (const s of sinks) {
            const name = s.name || '';
            if (name.startsWith('bluez_output.')) {
                btSinks.push(name);
            }
        }
    } catch (_e) {
        return 0;
    }

    if (btSinks.length >= 2) {
        runCommand([
            'pactl',
            'load-module',
            'module-combine-sink',
            `sink_name=${COMBINED_SINK_NAME}`,
            `slaves=${btSinks.join(',')}`,
            'sink_properties=device.description="BlueHub_Audio_Condiviso_Automatico"',
        ]);
        runCommand(['pactl', 'set-default-sink', COMBINED_SINK_NAME]);
    } else if (btSinks.length === 1) {
        runCommand(['pactl', 'set-default-sink', btSinks[0]]);
    } else {
        runCommand(['pactl', 'set-default-sink', 'effect_input.xps17_eq']);
    }
    return btSinks.length;
}

const BlueHubQuickToggle = GObject.registerClass(
class BlueHubQuickToggle extends QuickMenuToggle {
    _init(extensionPath) {
        const cfg = loadConfig();
        const isEnabled = cfg.enabled !== false;

        super._init({
            title: 'BlueHub',
            subtitle: isEnabled ? 'Attivo' : 'Disattivato',
            iconName: 'bluetooth-active-symbolic',
            toggleMode: true,
            checked: isEnabled,
        });

        this.menu.setHeader('bluetooth-active-symbolic', 'BlueHub', 'Gestione Canali Bluetooth & Audio Condiviso');

        this._statusItem = new PopupMenu.PopupMenuItem('📡 Lettura canali...', {reactive: false});
        this.menu.addMenuItem(this._statusItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const openAppItem = new PopupMenu.PopupMenuItem('🚀 Apri Pannello Canali BlueHub (+ / −)');
        openAppItem.connect('activate', () => {
            Main.panel.statusArea.quickSettings.menu.close();
            launchApp(extensionPath);
        });
        this.menu.addMenuItem(openAppItem);

        // Quando si clicca sul tasto principale: attiva/disattiva BlueHub
        this.connect('clicked', () => {
            const currentCfg = loadConfig();
            currentCfg.enabled = this.checked;
            saveConfig(currentCfg);
            this._refreshState();
        });

        this.menu.connect('open-state-changed', (_menu, isOpen) => {
            if (isOpen) {
                this._refreshState();
            }
        });

        this._refreshState();
    }

    _refreshState() {
        const cfg = loadConfig();
        const isEnabled = cfg.enabled !== false;
        if (this.checked !== isEnabled) {
            this.checked = isEnabled;
        }

        const hw = getHardwareChannelStats();
        const btAudioCount = applySharedAudioState(isEnabled);

        if (!isEnabled) {
            this.subtitle = 'Disattivato';
            this._statusItem.label.text = '⚪ Estensione disattivata';
        } else if (btAudioCount >= 2) {
            this.subtitle = `Condiviso (${btAudioCount} cuffie)`;
            this._statusItem.label.text = `🟢 ${hw.activeLinks}/${hw.totalChannels} canali usati • 🎶 ${btAudioCount} cuffie unite`;
        } else {
            this.subtitle = `${hw.freeChannels}/${hw.totalChannels} canali liberi`;
            this._statusItem.label.text = `🟢 ${hw.activeLinks}/${hw.totalChannels} canali in uso (${hw.freeChannels} liberi)`;
        }
    }
});

const BlueHubSystemIndicator = GObject.registerClass(
class BlueHubSystemIndicator extends SystemIndicator {
    _init(extensionPath) {
        super._init();

        // Nessuna seconda icona nella barra in alto (Opzione 3):
        // solo il pulsante grande nel menu rapido di GNOME!
        this._toggle = new BlueHubQuickToggle(extensionPath);
        this.quickSettingsItems.push(this._toggle);
    }
});

export default class BlueHubExtension extends Extension {
    enable() {
        this._indicator = new BlueHubSystemIndicator(this.path);
        this._gridSignals = [];
        this._childVisSignals = new Map();

        const qs = Main.panel.statusArea.quickSettings;
        qs.addExternalIndicator(this._indicator, 2);

        const grid = qs.menu?._grid;
        if (grid) {
            this._gridSignals.push(
                grid.connect('child-added', (_g, child) => {
                    this._trackChild(child);
                    this._updateGridPositionAndSpan();
                }),
                grid.connect('child-removed', (_g, child) => {
                    this._untrackChild(child);
                    this._updateGridPositionAndSpan();
                })
            );
            for (const child of grid.get_children()) {
                this._trackChild(child);
            }
        }

        // Assicura che resti sempre ultimo e ricalcola se deve essere doppio (col-span 2) o singolo (col-span 1)
        this._updateGridPositionAndSpan();
    }

    _trackChild(child) {
        if (!child || this._childVisSignals.has(child)) return;
        const id = child.connect('notify::visible', () => {
            this._updateGridPositionAndSpan();
        });
        this._childVisSignals.set(child, id);
    }

    _untrackChild(child) {
        const id = this._childVisSignals.get(child);
        if (id) {
            try {
                child.disconnect(id);
            } catch (_e) {}
            this._childVisSignals.delete(child);
        }
    }

    _updateGridPositionAndSpan() {
        const qs = Main.panel.statusArea.quickSettings;
        const grid = qs?.menu?._grid;
        const toggle = this._indicator?._toggle;
        if (!grid || !toggle || toggle.get_parent() !== grid) return;

        // 1. Mantieni BlueHub SEMPRE ULTIMO tra i tasti (subito prima di "applicazioni in background")
        const bgAppsItem = qs._backgroundApps?.quickSettingsItems?.at(-1) ?? null;
        if (bgAppsItem && bgAppsItem.get_parent() === grid) {
            grid.set_child_below_sibling(toggle, bgAppsItem);
        } else {
            grid.set_child_above_sibling(toggle, null);
        }

        // 2. Se BlueHub si trova da solo sull'ultima riga (numero pari di tasti a 1 colonna prima di lui),
        //    diventa automaticamente TASTO DOPPIO GRANDE (column-span = 2); altrimenti 1 colonna!
        const layout = grid.layout_manager;
        let singleColCount = 0;
        for (const child of grid.get_children()) {
            if (child === toggle || child === bgAppsItem) continue;
            if (!child.visible) continue;
            let span = 1;
            try {
                span = layout.child_get_property(grid, child, 'column-span') || 1;
            } catch (_e) {}
            if (span === 1) {
                singleColCount++;
            } else {
                singleColCount = 0;
            }
        }

        const desiredSpan = (singleColCount % 2 === 0) ? 2 : 1;
        try {
            layout.child_set_property(grid, toggle, 'column-span', desiredSpan);
        } catch (_e) {}
    }

    disable() {
        const qs = Main.panel.statusArea.quickSettings;
        const grid = qs?.menu?._grid;
        if (grid && this._gridSignals) {
            for (const id of this._gridSignals) {
                try {
                    grid.disconnect(id);
                } catch (_e) {}
            }
        }
        this._gridSignals = [];

        if (this._childVisSignals) {
            for (const [child, id] of this._childVisSignals.entries()) {
                try {
                    child.disconnect(id);
                } catch (_e) {}
            }
            this._childVisSignals.clear();
        }

        if (this._indicator) {
            this._indicator.quickSettingsItems.forEach(item => item.destroy());
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}
