// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria

// BlueHub window (extension preferences), used when Smart Calendar Hub is not
// installed. State, rules and texts live in bluehub-panel-model.js, shared with
// the hub page (bluehub-hub-kit.js); this file only draws them with GTK/libadwaita.

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import GLib from 'gi://GLib';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {PanelModel, SCAN_SECONDS} from './bluehub-panel-model.js';
import {_, loadUserTranslations} from './bluehub-i18n.js';

export default class BlueHubPreferences extends ExtensionPreferences {
    // Kept synchronous: GNOME 45/46 do not await an async version and would show
    // "no preferences". User translations are applied right after.
    fillPreferencesWindow(window) {
        window.set_default_size(720, 820);
        window.set_search_enabled(false);

        const panel = new BlueHubWindowPanel(window);
        window.add(panel.page);
        // Cancel pending commands and waits on close
        window.connect('close-request', () => {
            panel.destroy();
            return false;
        });
    }
}

// Group descriptions are markup, and device names may contain & < >
const esc = text => GLib.markup_escape_text(text ?? '', -1);

class BlueHubWindowPanel {
    constructor(window) {
        this._window = window;
        this._rows = new Map();   // group -> rows shown
        this._model = new PanelModel({
            onChange: () => this._render(),
            onToast: text => this._window.add_toast(new Adw.Toast({title: text, timeout: 4, use_markup: false})),
        });

        this.page = new Adw.PreferencesPage();
        this._buildUi();
        this._render();

        // For languages other than Italian/English: load (and append new strings to)
        // the user's translation file, then translate again and refresh
        loadUserTranslations({merge: true})
            .catch(logError)
            .finally(() => {
                if (this._model.alive) {
                    this._applyStaticTexts();
                    this._render();
                    this._model.refresh();
                }
            });
    }

    destroy() {
        this._model.destroy();
    }

    // ------------------------------------------------------------------
    // One-time construction and static texts
    // ------------------------------------------------------------------

    _buildUi() {
        // --- Enable + Search BT + adapters ---
        this._extGroup = new Adw.PreferencesGroup();
        this._refreshBtn = new Gtk.Button({icon_name: 'view-refresh-symbolic', valign: Gtk.Align.CENTER});
        this._refreshBtn.add_css_class('flat');
        this._refreshBtn.connect('clicked', () => this._model.refresh());
        this._extGroup.set_header_suffix(this._refreshBtn);
        this.page.add(this._extGroup);

        this._extRow = new Adw.ActionRow();
        this._extRow.add_prefix(Gtk.Image.new_from_icon_name('bluetooth-active-symbolic'));
        const extBtns = new Gtk.Box({spacing: 8, valign: Gtk.Align.CENTER});
        this._scanBtn = new Gtk.Button({valign: Gtk.Align.CENTER});
        this._scanBtn.connect('clicked', () => this._model.scan().catch(logError));
        extBtns.append(this._scanBtn);
        this._masterBtn = new Gtk.ToggleButton({valign: Gtk.Align.CENTER, active: true});
        this._masterHandler = this._masterBtn.connect('toggled', () => this._model.setEnabled(this._masterBtn.get_active()));
        extBtns.append(this._masterBtn);
        this._extRow.add_suffix(extBtns);
        this._extGroup.add(this._extRow);

        this._antennaRow = new Adw.ActionRow({use_markup: false});
        this._antennaRow.add_prefix(Gtk.Image.new_from_icon_name('network-wireless-hotspot-symbolic'));
        this._antennaBox = new Gtk.Box({spacing: 6, valign: Gtk.Align.CENTER});
        this._antennaRow.add_suffix(this._antennaBox);
        this._extGroup.add(this._antennaRow);

        // --- Channels and the two [ − / + ] cards ---
        this._radioGroup = new Adw.PreferencesGroup();
        this.page.add(this._radioGroup);
        this._radioRow = new Adw.ActionRow({use_markup: false});
        this._radioGroup.add(this._radioRow);
        this._capHintRow = new Adw.ActionRow({use_markup: false});
        this._radioGroup.add(this._capHintRow);
        const cards = new Gtk.Box({spacing: 16, homogeneous: true, margin_top: 12, margin_bottom: 8});
        this._gpCard = this._makeQuotaCard(d => this._model.changeQuota('gamepad', d));
        this._auCard = this._makeQuotaCard(d => this._model.changeQuota('audio', d));
        cards.append(this._gpCard.box);
        cards.append(this._auCard.box);
        this._radioGroup.add(cards);

        // --- Device lists ---
        this._groups = {};
        for (const category of ['gamepad', 'audio', 'system']) {
            this._groups[category] = new Adw.PreferencesGroup();
            this.page.add(this._groups[category]);
            this._rows.set(category, []);
        }
        this._applyStaticTexts();
    }

    // Called again once user translations are loaded
    _applyStaticTexts() {
        this._extGroup.set_title(_('BlueHub Extension'));
        this._refreshBtn.set_tooltip_text(_('Refresh adapters, channels and devices'));
        this._extRow.set_title(_('Enable BlueHub'));
        this._scanBtn.set_tooltip_text(_('Start a smart Bluetooth scan for {seconds} seconds', {seconds: SCAN_SECONDS}));
        this._radioGroup.set_title(_('Bluetooth Channel Allocation'));
    }

    _makeQuotaCard(onChange) {
        const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 10, margin_start: 4, margin_end: 4});
        box.add_css_class('card');
        const inner = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL, spacing: 8,
            margin_top: 16, margin_bottom: 16, margin_start: 16, margin_end: 16,
        });
        box.append(inner);
        const titleLabel = new Gtk.Label();
        titleLabel.add_css_class('heading');
        inner.append(titleLabel);
        const subLabel = new Gtk.Label();
        subLabel.add_css_class('dim-label');
        inner.append(subLabel);
        const ctrl = new Gtk.Box({spacing: 18, halign: Gtk.Align.CENTER, margin_top: 6});
        inner.append(ctrl);
        const minusBtn = new Gtk.Button({label: '−'});
        minusBtn.add_css_class('circular');
        minusBtn.connect('clicked', () => onChange(-1));
        ctrl.append(minusBtn);
        const valLabel = new Gtk.Label({label: '0'});
        valLabel.add_css_class('title-1');
        ctrl.append(valLabel);
        const plusBtn = new Gtk.Button({label: '+'});
        plusBtn.add_css_class('circular');
        plusBtn.add_css_class('suggested-action');
        plusBtn.connect('clicked', () => onChange(+1));
        ctrl.append(plusBtn);
        return {box, titleLabel, subLabel, valLabel, minusBtn, plusBtn};
    }

    // ------------------------------------------------------------------
    // Redraw on every model change
    // ------------------------------------------------------------------

    _render() {
        const v = this._model.view();

        // Block the handler so syncing the button does not toggle BlueHub
        if (this._masterBtn.get_active() !== v.enabled) {
            this._masterBtn.block_signal_handler(this._masterHandler);
            this._masterBtn.set_active(v.enabled);
            this._masterBtn.unblock_signal_handler(this._masterHandler);
        }
        this._masterBtn.set_label(v.masterLabel);
        this._masterBtn.set_sensitive(v.loaded);
        this._extRow.set_subtitle(v.masterSubtitle);
        this._scanBtn.set_label(v.scanLabel);
        this._scanBtn.set_sensitive(v.enabled && !v.scanning);

        this._antennaRow.set_title(v.antenna.title);
        this._antennaRow.set_subtitle(v.antenna.subtitle);
        this._antennaRow.set_sensitive(v.enabled);
        let child = this._antennaBox.get_first_child();
        while (child) {
            const next = child.get_next_sibling();
            this._antennaBox.remove(child);
            child = next;
        }
        if (v.antenna.options) {
            let head = null;
            for (const o of v.antenna.options) {
                const b = new Gtk.ToggleButton({label: o.label, valign: Gtk.Align.CENTER, active: o.active});
                if (head) {
                    b.set_group(head);
                } else {
                    head = b;
                }
                b.connect('toggled', () => {
                    if (b.get_active()) {
                        this._model.selectScanAdapter(o.key);
                    }
                });
                this._antennaBox.append(b);
            }
        }

        this._radioGroup.set_description(esc(v.channelsSummary));
        this._radioGroup.set_sensitive(v.enabled);
        this._radioRow.set_title(v.channelsTitle);
        this._radioRow.set_subtitle(v.channelsSubtitle);
        this._capHintRow.set_title(v.capTitle);
        this._capHintRow.set_subtitle(v.capSubtitle);
        for (const [card, data] of [[this._gpCard, v.gamepadCard], [this._auCard, v.audioCard]]) {
            card.titleLabel.set_label(data.title);
            card.subLabel.set_label(data.sub);
            card.valLabel.set_label(String(data.value));
            card.minusBtn.set_sensitive(data.canMinus);
            card.plusBtn.set_sensitive(data.canPlus);
        }

        for (const group of v.groups) {
            this._renderGroup(group);
        }
    }

    _renderGroup(group) {
        const widget = this._groups[group.category];
        const rows = this._rows.get(group.category);
        for (const r of rows) {
            widget.remove(r);
        }
        rows.length = 0;

        widget.set_title(group.title);
        widget.set_description(esc(group.description));
        widget.set_sensitive(group.sensitive);

        if (group.rows.length === 0 && group.empty) {
            const empty = new Adw.ActionRow({title: group.empty.title, subtitle: group.empty.subtitle});
            widget.add(empty);
            rows.push(empty);
            return;
        }
        for (const row of group.rows) {
            const r = this._deviceRow(row);
            widget.add(r);
            rows.push(r);
        }
    }

    _deviceRow(row) {
        const r = new Adw.ActionRow({
            title: row.title,
            subtitle: row.subtitle,
            use_markup: false,   // device names may contain & < >
        });
        r.add_prefix(Gtk.Image.new_from_icon_name(row.iconName));
        const suffix = new Gtk.Box({spacing: 8, valign: Gtk.Align.CENTER});

        if (row.mic) {
            const micBtn = new Gtk.ToggleButton({
                label: row.mic.label,
                valign: Gtk.Align.CENTER,
                active: row.mic.active,
                tooltip_text: row.mic.tooltip,
            });
            micBtn.connect('toggled', () => this._model.toggleMic(row.dev, micBtn.get_active()));
            suffix.append(micBtn);
        }

        const btn = new Gtk.Button({label: row.button.label, valign: Gtk.Align.CENTER, sensitive: row.button.sensitive});
        if (row.button.style === 'destructive') {
            btn.add_css_class('destructive-action');
        } else if (row.button.style === 'suggested') {
            btn.add_css_class('suggested-action');
        }
        btn.connect('clicked', () => this._onDeviceButton(row).catch(logError));
        suffix.append(btn);
        r.add_suffix(suffix);
        return r;
    }

    async _onDeviceButton(row) {
        if (row.needsConfirm && !await this._confirm(row.confirmTitle, row.confirmBody, _('Yes, disconnect'))) {
            return;
        }
        if (this._model.alive) {
            await this._model.deviceAction(row.dev);
        }
    }

    _confirm(heading, body, okLabel) {
        return new Promise(resolve => {
            const dialog = Adw.AlertDialog   // libadwaita 1.5+ (GNOME 46+)
                ? new Adw.AlertDialog({heading, body})
                : new Adw.MessageDialog({heading, body, transient_for: this._window, modal: true});
            dialog.add_response('cancel', _('Cancel'));
            dialog.add_response('ok', okLabel);
            dialog.set_response_appearance('ok', Adw.ResponseAppearance.DESTRUCTIVE);
            dialog.set_default_response('cancel');
            dialog.set_close_response('cancel');
            dialog.connect('response', (_d, response) => resolve(response === 'ok'));
            if (Adw.AlertDialog) {
                dialog.present(this._window);
            } else {
                dialog.present();
            }
        });
    }
}
