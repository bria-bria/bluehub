// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria

// BlueHub page inside Smart Calendar Hub, built only from the hub's own widget
// kit (stateObj.pageKit) so it follows the hub's "Page model":
// - headers are drawn by the hub (column title, side pane sideTitle)
// - small section titles, uniform rows in cards (icon, title, one detail line,
//   a single trailing widget: switch, value or arrow)
// - pill buttons, only one primary button per page
// - no colors or backgrounds of our own; the hub handles scrolling
// Column: BlueHub, shared audio, adapters, channels [− / +], Search BT.
// Side pane: gamepads, headphones (with mic), other devices.
// Same logic as the window: bluehub-panel-model.js.

import St from 'gi://St';

import {PanelModel} from './bluehub-panel-model.js';
import {_} from './bluehub-i18n.js';

// Make a kit widget insensitive with the theme's look. Kit version 2+ provides
// kit.setSensitive; older kits need it done by hand.
let kitSetSensitive = null;
function setSensitive(btn, sensitive) {
    if (kitSetSensitive) {
        kitSetSensitive(btn, sensitive);
        return btn;
    }
    btn.reactive = sensitive;
    btn.can_focus = sensitive;
    if (sensitive) {
        btn.remove_style_pseudo_class('insensitive');
    } else {
        btn.add_style_pseudo_class('insensitive');
    }
    return btn;
}

// Destroy the old page right away so its signal handlers go with it
function replaceChild(bin, child) {
    const old = bin.get_child();
    bin.set_child(child);
    old?.destroy();
}

export class KitHubPanel {
    // kit: the hub's stateObj.pageKit; icon: BlueHub's Gio.Icon
    // withSidePage: the hub shows the side pane
    // onClosed(): the hub destroyed the column
    // notify(text): hub result message; setCount(n): number in the side pane header
    constructor({kit, icon, withSidePage, onClosed = null, notify = null, setCount = null}) {
        this._kit = kit;
        kitSetSensitive = typeof kit.setSensitive === 'function' ? kit.setSensitive : null;
        this._notify = notify;
        this._setCount = setCount;
        this._lastCount = null;
        this._icon = icon;
        this._withSide = withSidePage;
        this._onClosed = onClosed;
        this._confirmMac = null;      // mouse/keyboard waiting for confirmation
        this._closing = false;

        // Stable containers handed to the hub; the kit page inside is rebuilt
        this.mainPage = new St.Bin({x_expand: true});
        this.sidePage = this._withSide ? new St.Bin({x_expand: true}) : null;
        this.sidePage?.connect('destroy', () => {
            this.sidePage = null;
            this._withSide = false;
            if (this.mainPage && !this._closing) {
                this._render();   // side pane closed before the column: move the lists into the column
            }
        });

        this._model = new PanelModel({onChange: () => this._render(), onToast: text => this._notify?.(text)});
        this.mainPage.connect('destroy', () => this._destroy());
        this._render();
        this._model.refresh();
    }

    // Called by the round buttons in the side pane header (drawn by the hub)
    refresh() {
        this._model?.refresh();
    }

    scan() {
        this._model?.scan();
    }

    // After opening: if the hub did not show the side pane, put the lists in the column
    checkSidePage() {
        if (this.sidePage && !this.sidePage.get_parent()) {
            const side = this.sidePage;
            this.sidePage = null;
            this._withSide = false;
            side.destroy();   // never adopted by the hub, so we own it
            this._render();
        }
    }

    _destroy() {
        this._closing = true;
        this._model?.destroy();
        this._model = null;
        this._notify = null;
        this._setCount = null;
        kitSetSensitive = null;
        // The hub destroys the side pane, unless it never adopted it
        if (this.sidePage && !this.sidePage.get_parent()) {
            this.sidePage.destroy();
        }
        this.sidePage = null;
        this.mainPage = null;
        const onClosed = this._onClosed;
        this._onClosed = null;
        onClosed?.();
    }

    // ------------------------------------------------------------------
    // Drawing: kit pages are rebuilt on every model change
    // ------------------------------------------------------------------

    _render() {
        if (!this._model || !this.mainPage) {
            return;
        }
        const s = this._model.short();
        const lists = this._deviceSections(s);
        replaceChild(this.mainPage, this._kit.page(...this._columnPieces(s), ...(this._withSide ? [] : lists)));
        if (this._withSide && this.sidePage) {
            replaceChild(this.sidePage, this._kit.page(...lists));
            // Only push the device count to the hub when it changes
            if (s.loaded && this._setCount && this._lastCount !== s.deviceCount) {
                this._lastCount = s.deviceCount;
                this._setCount(s.deviceCount);
            }
        }
    }

    _columnPieces(s) {
        const k = this._kit;
        const pieces = [];

        const enableRow = k.row({
            icon: this._icon,
            title: _('Enable BlueHub'),
            subtitle: s.enableSubtitle,
            trailing: k.toggle({active: s.enabled, onToggle: on => this._model?.setEnabled(on)}),
        });
        setSensitive(enableRow, s.loaded);
        pieces.push(k.card(
            enableRow,
            k.row({icon: 'audio-speakers-symbolic', title: _('Shared audio'), subtitle: s.audioShort}),
        ));

        pieces.push(k.section(_('Adapters')));
        pieces.push(k.card(...s.adapters.map(a =>
            k.row({icon: 'network-wireless-hotspot-symbolic', title: a.title, subtitle: a.subtitle}))));
        if (s.adapterChoice) {
            pieces.push(k.section(_('Adapter for new pairings')));
            pieces.push(k.card(...s.adapterChoice.map(a => {
                const r = k.row({
                    icon: 'emblem-system-symbolic',
                    title: a.title,
                    subtitle: a.subtitle,
                    trailing: a.active ? k.value(_('Selected')) : null,
                    onActivate: () => this._model?.selectScanAdapter(a.key),
                });
                return setSensitive(r, s.enabled);
            })));
        }

        pieces.push(k.section(_('Channels')));
        for (const [kind, icon, title, data] of [
            ['gamepad', 'input-gaming-symbolic', _('Gamepads'), s.gamepads],
            ['audio', 'audio-headphones-symbolic', _('Headphones and speakers'), s.headphones],
        ]) {
            pieces.push(k.card(k.row({icon, title, subtitle: data.subtitle, trailing: k.value(data.value)})));
            pieces.push(k.buttons(
                setSensitive(k.button({label: '−', onClick: () => this._model?.changeQuota(kind, -1)}), data.canMinus),
                setSensitive(k.button({label: '+', onClick: () => this._model?.changeQuota(kind, +1)}), data.canPlus),
            ));
        }
        pieces.push(k.card(k.row({
            icon: 'network-cellular-signal-good-symbolic',
            title: _('Free channels'),
            subtitle: s.freeChannels.subtitle,
            trailing: k.value(s.freeChannels.value),
        })));

        // Search BT is the page's only primary button
        pieces.push(k.buttons(
            setSensitive(k.button({
                label: s.scanning ? _('Searching...') : _('Search BT'),
                primary: true,
                onClick: () => this._model?.scan(),
            }), s.enabled && !s.scanning),
            k.button({label: _('Refresh'), onClick: () => this._model?.refresh()}),
        ));
        return pieces;
    }

    _deviceSections(s) {
        const k = this._kit;
        const pieces = [];
        for (const [title, list, emptyIcon, emptyText] of [
            [_('Gamepads'), s.gamepadList, 'input-gaming-symbolic', _('No Bluetooth gamepads known')],
            [_('Headphones and speakers'), s.audioList, 'audio-headphones-symbolic', _('No Bluetooth headphones or speakers known')],
            [_('Other devices'), s.otherList, 'bluetooth-active-symbolic', _('No other Bluetooth devices')],
        ]) {
            pieces.push(k.section(title));
            if (list.length === 0) {
                pieces.push(k.empty({icon: emptyIcon, text: emptyText}));
                continue;
            }
            const rows = [];
            let confirm = null;
            for (const d of list) {
                rows.push(this._deviceRow(d));
                if (d.mic) {
                    rows.push(k.row({
                        icon: 'audio-input-microphone-symbolic',
                        title: d.mic.title,
                        subtitle: d.mic.subtitle,
                        trailing: k.toggle({active: d.mic.active, onToggle: on => this._model?.toggleMic(d.dev, on)}),
                    }));
                }
                if (this._confirmMac === d.dev.mac) {
                    confirm = d;
                }
            }
            pieces.push(k.card(...rows));
            // Inline confirmation before disconnecting a mouse/keyboard
            if (confirm) {
                pieces.push(k.card(k.row({icon: 'dialog-warning-symbolic', title: confirm.confirmTitle, subtitle: confirm.confirmSubtitle})));
                pieces.push(k.buttons(
                    k.button({label: _('Cancel'), onClick: () => {
                        this._confirmMac = null;
                        this._render();
                    }}),
                    k.button({label: _('Yes, disconnect'), onClick: () => {
                        this._confirmMac = null;
                        this._model?.deviceAction(confirm.dev);
                    }}),
                ));
            }
        }
        return pieces;
    }

    _deviceRow(d) {
        const k = this._kit;
        if (d.trailing.kind === 'value') {
            return k.row({icon: d.icon, title: d.title, subtitle: d.subtitle, trailing: k.value(d.trailing.text)});
        }
        const sw = k.toggle({
            active: d.trailing.active,
            onToggle: on => {
                if (!on && d.needsConfirm) {
                    sw.state = true;   // stay connected until confirmed
                    this._confirmMac = d.dev.mac;
                    this._render();
                    return;
                }
                this._model?.deviceAction(d.dev);
            },
        });
        return k.row({icon: d.icon, title: d.title, subtitle: d.subtitle, trailing: sw});
    }
}
