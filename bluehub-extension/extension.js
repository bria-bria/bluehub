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
import {QuickMenuToggle, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';


import * as Core from './bluehub-core.js';
import {KitHubPanel} from './bluehub-hub-kit.js';
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
            // Click: turn BlueHub on/off, like Wi-Fi and Bluetooth. Arrow: open BlueHub.
            toggleMode: true,
            checked: false,
        });

        // Cancels running commands when the extension is disabled
        this._cancellable = new Gio.Cancellable();
        this._refreshing = false;
        this._refreshAgain = false;
        this._lastBtSinks = null;   // Bluetooth headphones seen at the previous refresh
        this._wasEnabled = null;    // state at the previous refresh (null = not read yet)
        this._configLoaded = false;
        this._extension = extension;
        this._icon = icon;
        // Also cancel when the button is destroyed without our destroy() (from C)
        this.connect('destroy', () => this._cancellable.cancel());

        // Click (the toggle has already switched): save the new state and apply it
        this.connect('clicked', () => {
            if (!this._configLoaded) {
                // real state not known yet: read it instead of saving a guess
                this._refreshState();
                return;
            }
            Core.updateConfig({enabled: this.checked})
                .then(() => this._refreshState())
                .catch(e => Core.logBlueHubError(`Save: ${e}`));
        });

        // The arrow opens BlueHub itself (hub panel or window) instead of a submenu
        this.menu.setHeader(icon, 'BlueHub');
        this._menuOpenId = this.menu.connect('open-state-changed', (_menu, isOpen) => {
            if (!isOpen) {
                return;
            }
            this.menu.close();
            Main.panel.statusArea.quickSettings.menu.close();
            this._openPanel();
        });

        // Languages other than Italian/English: load the user's file, then translate again
        loadUserTranslations()
            .then(() => {
                if (!this._cancellable.is_cancelled()) {
                    this._refreshState();
                }
            })
            .catch(e => Core.logBlueHubError(`Translations: ${e}`));
        this._refreshState();
    }

    // Called by disable(): stops running commands, disconnects the menu signal
    // and closes the BlueHub page in the hub before destroying the button
    destroy() {
        this._cancellable.cancel();
        if (this._menuOpenId) {
            this.menu.disconnect(this._menuOpenId);
            this._menuOpenId = 0;
        }
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
            const features = Array.isArray(api.externalPageFeatures) ? api.externalPageFeatures : [];
            const withSide = features.includes('side');
            const kit = features.includes('kit') ? api.pageKit : null;
            if (!kit) {
                // hub senza il kit delle pagine (versione vecchia): finestra BlueHub
                this._extension.openPreferences();
                return;
            }
            const onClosed = () => {
                this._hubPanel = null;
                this._refreshState();   // lo stato può essere cambiato nell'hub
            };
            // Intestazione del riquadro disegnata dall'hub: titolo e due pulsanti tondi
            const header = withSide && features.includes('side-header') ? {
                sideTitle: _('Bluetooth devices'),
                sideActions: [
                    {icon: 'view-refresh-symbolic', label: _('Refresh'), onClick: () => this._hubPanel?.refresh()},
                    {icon: 'system-search-symbolic', label: _('Search BT'), onClick: () => this._hubPanel?.scan()},
                ],
            } : {};
            try {
                shown = api.showExternalPage({
                    id: this._extension.uuid,
                    title: 'BlueHub',
                    // Il pannello si crea solo quando l'hub lo chiede (se BlueHub è già
                    // aperto nell'hub, non lo chiede e resta quello che c'è)
                    buildPage: () => {
                        this._hubPanel = new KitHubPanel({
                            kit, icon: this._icon, withSidePage: withSide, onClosed,
                            // messaggi di esito e contatore: solo se l'hub li offre
                            notify: features.includes('message')
                                ? text => api.showPageMessage(this._extension.uuid, text) : null,
                            setCount: withSide && features.includes('side-count')
                                ? n => api.setSideCount(this._extension.uuid, n) : null,
                        });
                        return this._hubPanel.mainPage;
                    },
                    buildSidePage: withSide ? () => this._hubPanel?.sidePage ?? null : null,
                    keepStyle: false,
                    ...header,
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

                if (!isEnabled) {
                    // Off: no checks at all. Only once, right after switching off,
                    // undo what BlueHub was doing (shared audio, joined microphones).
                    if (this._wasEnabled !== false) {
                        const audio = await Core.applySharedAudioState(false, this._lastBtSinks, this._cancellable);
                        await Core.unloadCombinedMics(this._cancellable);
                        if (this._cancellable.is_cancelled()) {
                            return;
                        }
                        this._lastBtSinks = audio.btSinks;
                    }
                    this._wasEnabled = false;
                    this.subtitle = _('Off');
                    continue;
                }
                this._wasEnabled = true;

                const hw = await Core.getHardwareChannelStats();
                const audio = await Core.applySharedAudioState(true, this._lastBtSinks, this._cancellable);
                // Extension disabled while the commands were running: leave the button alone
                if (this._cancellable.is_cancelled()) {
                    return;
                }
                this._lastBtSinks = audio.btSinks;
                this.subtitle = audio.count >= 2
                    ? _('Shared ({count} headphones)', {count: audio.count})
                    : _('{free}/{total} channels free', {free: hw.freeChannels, total: hw.totalChannels});
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
        Core.cancelBackgroundWork();
        unloadUserTranslations();
    }
}
