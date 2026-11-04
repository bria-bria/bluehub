// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria

// Pulsante BlueHub nel menu rapido di GNOME: attiva/disattiva BlueHub, mostra i
// canali Bluetooth in uso e apre il pannello (finestra Preferenze, prefs.js).
// La logica (audio condiviso, configurazione) sta in bluehub-core.js.

import GObject from 'gi://GObject';
import Gio from 'gi://Gio';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {QuickMenuToggle, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';

import * as Core from './bluehub-core.js';
import {_, loadUserTranslations, unloadUserTranslations} from './bluehub-i18n.js';

const BlueHubQuickToggle = GObject.registerClass(
class BlueHubQuickToggle extends QuickMenuToggle {
    _init(extension) {
        // Lo stato vero (attivo/disattivato) arriva dalla configurazione, letta
        // in modo asincrono dal primo aggiornamento qui sotto
        super._init({
            title: 'BlueHub',
            subtitle: _('Loading...'),
            iconName: 'bluetooth-active-symbolic',
            toggleMode: true,
            checked: false,
        });

        // Per annullare i comandi in corso quando l'estensione viene disattivata
        this._cancellable = new Gio.Cancellable();
        this._refreshing = false;
        this._refreshAgain = false;
        this._lastBtSinks = null;   // cuffie BT viste all'ultimo aggiornamento
        this._configLoaded = false; // diventa true dopo la prima lettura della configurazione
        // Annulla anche se il pulsante viene distrutto senza passare da destroy() JS
        this.connect('destroy', () => this._cancellable.cancel());


        this._statusItem = new PopupMenu.PopupMenuItem(_('📡 Reading channels...'), {reactive: false});
        this.menu.addMenuItem(this._statusItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._openItem = new PopupMenu.PopupMenuItem('');
        this._openItem.connect('activate', () => {
            Main.panel.statusArea.quickSettings.menu.close();
            // Il pannello è la finestra Preferenze dell'estensione (prefs.js)
            extension.openPreferences();
        });
        this.menu.addMenuItem(this._openItem);
        this._applyStaticTexts();

        // Quando si clicca sul tasto principale: attiva/disattiva BlueHub
        // (prima salva, poi aggiorna: così l'aggiornamento legge il valore nuovo)
        this.connect('clicked', () => {
            // Configurazione non ancora letta: lo stato mostrato non è quello vero,
            // quindi il clic non salva nulla e si rilegge lo stato reale
            if (!this._configLoaded) {
                this._refreshState();
                return;
            }
            Core.updateConfig({enabled: this.checked})
                .then(() => this._refreshState())
                .catch(e => Core.logBlueHubError(`Errore salvataggio: ${e}`));
        });

        this._menuOpenId = this.menu.connect('open-state-changed', (_menu, isOpen) => {
            if (isOpen) {
                this._refreshState();
            }
        });

        // Lingue diverse da italiano/inglese: carica il file dell'utente, poi ritraduce
        loadUserTranslations()
            .then(() => {
                if (!this._cancellable.is_cancelled()) {
                    this._applyStaticTexts();
                    this._refreshState();
                }
            })
            .catch(e => Core.logBlueHubError(`Translations: ${e}`));
        this._refreshState();
    }

    // Testi che non cambiano con lo stato (intestazione e voce del pannello)
    _applyStaticTexts() {
        this.menu.setHeader('bluetooth-active-symbolic', 'BlueHub', _('Bluetooth channels & shared audio'));
        this._openItem.label.text = _('🚀 Open BlueHub channel panel (+ / −)');
    }

    // Chiamato da disable(): ferma i comandi in corso, scollega i segnali e
    // libera le righe del menu prima di distruggere il pulsante
    destroy() {
        this._cancellable.cancel();
        if (this._menuOpenId) {
            this.menu.disconnect(this._menuOpenId);
            this._menuOpenId = 0;
        }
        this._statusItem?.destroy();
        this._statusItem = null;
        this._openItem?.destroy();
        this._openItem = null;
        super.destroy();
    }

    // Avvia un aggiornamento senza bloccare GNOME
    _refreshState() {
        this._doRefresh().catch(e => Core.logBlueHubError(`Errore aggiornamento: ${e}`));
    }

    async _doRefresh() {
        // Se un aggiornamento è già in corso, ne chiede solo un altro alla fine
        if (this._refreshing) {
            this._refreshAgain = true;
            return;
        }
        this._refreshing = true;
        try {
            do {
                this._refreshAgain = false;

                const cfg = await Core.loadConfig();
                if (this._cancellable.is_cancelled()) {
                    return;
                }
                const isEnabled = cfg.enabled !== false;
                if (this.checked !== isEnabled) {
                    this.checked = isEnabled;
                }
                this._configLoaded = true;

                const hw = Core.getHardwareChannelStats();
                const audio = await Core.applySharedAudioState(isEnabled, this._lastBtSinks, this._cancellable);

                // Estensione disattivata mentre i comandi giravano: non toccare più il pulsante
                if (this._cancellable.is_cancelled()) {
                    return;
                }
                this._lastBtSinks = audio.btSinks;
                const btAudioCount = audio.count;

                if (!isEnabled) {
                    this.subtitle = _('Off');
                    this._statusItem.label.text = _('⚪ BlueHub off');
                } else if (btAudioCount >= 2) {
                    this.subtitle = _('Shared ({count} headphones)', {count: btAudioCount});
                    this._statusItem.label.text = _('🟢 {used}/{total} channels used • 🎶 {count} headphones joined',
                        {used: hw.activeLinks, total: hw.totalChannels, count: btAudioCount});
                } else {
                    this.subtitle = _('{free}/{total} channels free', {free: hw.freeChannels, total: hw.totalChannels});
                    this._statusItem.label.text = _('🟢 {used}/{total} channels in use ({free} free)',
                        {used: hw.activeLinks, total: hw.totalChannels, free: hw.freeChannels});
                }
            } while (this._refreshAgain);
        } finally {
            this._refreshing = false;
        }
    }
});

const BlueHubSystemIndicator = GObject.registerClass(
class BlueHubSystemIndicator extends SystemIndicator {
    _init(extension) {
        super._init();

        // Nessuna seconda icona nella barra in alto (Opzione 3):
        // solo il pulsante grande nel menu rapido di GNOME!
        this._toggle = new BlueHubQuickToggle(extension);
        this.quickSettingsItems.push(this._toggle);
        // Quando GNOME si chiude smonta il menu rapido e distrugge il pulsante:
        // da quel momento non va più usato (evita errori "already disposed")
        this._toggle.connect('destroy', () => {
            this._toggle = null;
        });
    }
});

export default class BlueHubExtension extends Extension {
    enable() {
        this._indicator = new BlueHubSystemIndicator(this);
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
        unloadUserTranslations();
    }
}
