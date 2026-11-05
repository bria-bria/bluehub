// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria

// Pulsante BlueHub nel menu rapido di GNOME: attiva/disattiva BlueHub, mostra i
// canali Bluetooth in uso e apre il pannello: dentro Smart Calendar Hub se c'è,
// altrimenti la finestra Preferenze (prefs.js).
// La logica (audio condiviso, configurazione) sta in bluehub-core.js.

import GObject from 'gi://GObject';
import Gio from 'gi://Gio';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {QuickMenuToggle, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';


import * as Core from './bluehub-core.js';
import {HubPanel} from './bluehub-hub-panel.js';
import {_, loadUserTranslations, unloadUserTranslations} from './bluehub-i18n.js';

const SMART_CALENDAR_HUB_UUID = 'smart-calendar-hub@bria-bria.github.io';

// Icona "hub a raggi" di BlueHub (icons/bluehub-symbolic.svg)
function blueHubIcon(extension) {
    return new Gio.FileIcon({file: extension.dir.get_child('icons').get_child('bluehub-symbolic.svg')});
}

// Smart Calendar Hub, se è installato e attivo e offre la "via preferenziale"
// per mostrare la pagina di un'altra estensione senza icona; altrimenti null
function smartCalendarHub() {
    const hub = Main.extensionManager.lookup(SMART_CALENDAR_HUB_UUID);
    const api = hub?.stateObj;
    return typeof api?.showExternalPage === 'function' ? api : null;
}

const BlueHubQuickToggle = GObject.registerClass(
class BlueHubQuickToggle extends QuickMenuToggle {
    _init(extension) {
        // Lo stato vero (attivo/disattivato) arriva dalla configurazione, letta
        // in modo asincrono dal primo aggiornamento qui sotto
        const icon = blueHubIcon(extension);
        super._init({
            title: 'BlueHub',
            subtitle: _('Loading...'),
            gicon: icon,
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
        this._extension = extension;
        this._icon = icon;   // creata una volta, riusata nell'intestazione
        this._openItem.connect('activate', () => {
            Main.panel.statusArea.quickSettings.menu.close();
            this._openPanel();
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
        this.menu.setHeader(this._icon, 'BlueHub', _('Bluetooth channels & shared audio'));
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
        // Il pannello nell'hub va chiuso insieme al pulsante
        this._hubPanel?.mainPage?.destroy();
        this._hubPanel = null;
        super.destroy();
    }

    // "Apri pannello": con Smart Calendar Hub apre il suo pannello laterale con
    // BlueHub completo (colonna dell'hub + riquadro affiancato per le liste);
    // senza l'hub (o se non riesce) apre la finestra BlueHub
    _openPanel() {
        const api = smartCalendarHub();
        let shown = false;
        if (api) {
            const withSide = Array.isArray(api.externalPageFeatures) && api.externalPageFeatures.includes('side');
            try {
                shown = api.showExternalPage({
                    id: this._extension.uuid,
                    title: 'BlueHub',
                    buildPage: () => {
                        this._hubPanel = new HubPanel({
                            withSidePage: withSide,
                            onOpenWindow: () => this._extension.openPreferences(),
                            onClosed: () => {
                                this._hubPanel = null;
                                this._refreshState();   // lo stato può essere cambiato nell'hub
                            },
                        });
                        return this._hubPanel.mainPage;
                    },
                    buildSidePage: withSide ? () => this._hubPanel?.sidePage ?? null : null,
                    keepStyle: false,
                }) === true;
                if (shown) {
                    this._hubPanel?.checkSidePage();
                }
            } catch (e) {
                Core.logBlueHubError(`Smart Calendar Hub: ${e}`);
            }
        }
        if (!shown) {
            this._extension.openPreferences();
        }
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

                let statusText;
                if (!isEnabled) {
                    this.subtitle = _('Off');
                    statusText = _('⚪ BlueHub off');
                } else if (btAudioCount >= 2) {
                    this.subtitle = _('Shared ({count} headphones)', {count: btAudioCount});
                    statusText = _('🟢 {used}/{total} channels used • 🎶 {count} headphones joined',
                        {used: hw.activeLinks, total: hw.totalChannels, count: btAudioCount});
                } else {
                    this.subtitle = _('{free}/{total} channels free', {free: hw.freeChannels, total: hw.totalChannels});
                    statusText = _('🟢 {used}/{total} channels in use ({free} free)',
                        {used: hw.activeLinks, total: hw.totalChannels, free: hw.freeChannels});
                }
                this._statusItem.label.text = statusText;
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

        // Nessuna icona nella barra in alto: solo il pulsante nel menu rapido
        this._toggle = new BlueHubQuickToggle(extension);
        this.quickSettingsItems.push(this._toggle);
    }
});

export default class BlueHubExtension extends Extension {
    enable() {
        this._indicator = new BlueHubSystemIndicator(this);
        this._gridSignals = [];

        const qs = Main.panel.statusArea.quickSettings;
        // Pulsante sempre piccolo (una colonna)
        qs.addExternalIndicator(this._indicator);

        // Tiene BlueHub in fondo ai pulsanti quando GNOME ne aggiunge altri
        const grid = qs.menu?._grid;
        if (grid) {
            this._gridSignals.push(
                grid.connect('child-added', () => this._keepLast()),
                grid.connect('child-removed', (_g, child) => {
                    // Quando GNOME si chiude smonta il menu rapido e distrugge il
                    // pulsante: da quel momento non va più usato ("already disposed")
                    if (this._indicator && child === this._indicator._toggle) {
                        this._indicator._toggle = null;
                    }
                })
            );
        }
        this._keepLast();
    }

    // BlueHub ultimo tra i pulsanti (subito prima di "applicazioni in background")
    _keepLast() {
        const qs = Main.panel.statusArea.quickSettings;
        const grid = qs?.menu?._grid;
        const toggle = this._indicator?._toggle;
        if (!grid || !toggle || toggle.get_parent() !== grid) {
            return;
        }
        const bgAppsItem = qs._backgroundApps?.quickSettingsItems?.at(-1) ?? null;
        if (bgAppsItem && bgAppsItem.get_parent() === grid) {
            grid.set_child_below_sibling(toggle, bgAppsItem);
        } else {
            grid.set_child_above_sibling(toggle, null);
        }
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

        if (this._indicator) {
            this._indicator.quickSettingsItems.forEach(item => item.destroy());
            this._indicator.destroy();
            this._indicator = null;
        }
        unloadUserTranslations();
    }
}
