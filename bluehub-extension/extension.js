// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria

// BlueHub button in GNOME Quick Settings: turns BlueHub on/off, shows the
// Bluetooth channels in use and opens the panel, inside Smart Calendar Hub when
// available, otherwise the preferences window (prefs.js).
// The logic (shared audio, configuration) lives in bluehub-core.js.

import GObject from 'gi://GObject';
import Gio from 'gi://Gio';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {PopupAnimation} from 'resource:///org/gnome/shell/ui/boxpointer.js';
import {QuickMenuToggle, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';


import * as Core from './bluehub-core.js';
import {KitHubPanel} from './bluehub-hub-kit.js';
import {_, loadUserTranslations, unloadUserTranslations} from './bluehub-i18n.js';

const SMART_CALENDAR_HUB_UUID = 'smart-calendar-hub@bria-bria.github.io';

function blueHubIcon(extension) {
    return new Gio.FileIcon({file: extension.dir.get_child('icons').get_child('bluehub-symbolic.svg')});
}

// Smart Calendar Hub's API if it is installed, enabled and can show another
// extension's page; otherwise null
function smartCalendarHub() {
    const hub = Main.extensionManager.lookup(SMART_CALENDAR_HUB_UUID);
    const api = hub?.stateObj;
    return typeof api?.showExternalPage === 'function' ? api : null;
}

const BlueHubQuickToggle = GObject.registerClass(
class BlueHubQuickToggle extends QuickMenuToggle {
    _init(extension) {
        // The real on/off state comes from the config, read asynchronously by
        // the first refresh below
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

        // The arrow opens BlueHub itself (hub panel or window): our submenu never
        // opens, so its empty card is never shown, not even for an instant
        this.menu.open = () => {
            Main.panel.statusArea.quickSettings.menu.close(PopupAnimation.NONE);
            this._openPanel();
        };

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

    // Called by disable(): stops running commands
    // and closes the BlueHub page in the hub before destroying the button
    destroy() {
        this._cancellable.cancel();
        this._hubPanel?.mainPage?.destroy();
        this._hubPanel = null;
        super.destroy();
    }

    // With Smart Calendar Hub, open the full BlueHub page there (hub column plus
    // side pane for the lists); without it, or if that fails, open the window
    _openPanel() {
        const api = smartCalendarHub();
        let shown = false;
        if (api) {
            const features = Array.isArray(api.externalPageFeatures) ? api.externalPageFeatures : [];
            const withSide = features.includes('side');
            const kit = features.includes('kit') ? api.pageKit : null;
            if (!kit) {
                // Older hub without the page kit
                this._extension.openPreferences();
                return;
            }
            const onClosed = () => {
                this._hubPanel = null;
                this._refreshState();   // the state may have changed in the hub
            };
            // Side pane header drawn by the hub: title and two round buttons
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
                    // Only called when the hub needs a new page; if BlueHub is
                    // already open there, the existing page is kept
                    buildPage: () => {
                        this._hubPanel = new KitHubPanel({
                            kit, icon: this._icon, withSidePage: withSide, onClosed,
                            // Result messages and counter only if the hub supports them
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

    _refreshState() {
        this._doRefresh().catch(e => Core.logBlueHubError(`Refresh: ${e}`));
    }

    async _doRefresh() {
        // Coalesce: if a refresh is running, just ask for one more at the end
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

        // No top bar icon: only the Quick Settings button
        this._toggle = new BlueHubQuickToggle(extension);
        this.quickSettingsItems.push(this._toggle);
    }
});

export default class BlueHubExtension extends Extension {
    enable() {
        this._indicator = new BlueHubSystemIndicator(this);
        this._gridSignals = [];

        const qs = Main.panel.statusArea.quickSettings;
        qs.addExternalIndicator(this._indicator);

        // Keep BlueHub last when GNOME adds more buttons
        const grid = qs.menu?._grid;
        if (grid) {
            this._gridSignals.push(
                grid.connect('child-added', () => this._keepLast()),
                grid.connect('child-removed', (_g, child) => {
                    // On shutdown GNOME tears down Quick Settings and destroys the
                    // button; touching it afterwards fails with "already disposed"
                    if (this._indicator && child === this._indicator._toggle) {
                        this._indicator._toggle = null;
                    }
                })
            );
        }
        this._keepLast();
    }

    // Place BlueHub last, just before the "background apps" item
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
