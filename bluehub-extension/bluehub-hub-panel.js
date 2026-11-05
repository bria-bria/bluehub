// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria

// Pannello BlueHub dentro Smart Calendar Hub (GNOME Shell, widget St).
// Stessa logica della finestra (bluehub-panel-model.js), disegnata in due parti:
// - mainPage: nella colonna dell'hub (attivazione, Cerca BT, antenne, canali + / −)
// - sidePage: nel riquadro accanto al pannello (gamepad, cuffie, mouse/tastiera);
//   se l'hub non lo supporta, le liste vanno in fondo a mainPage
// L'hub distrugge le due parti a fine visita: con mainPage finisce tutto.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {PanelModel} from './bluehub-panel-model.js';
import {_} from './bluehub-i18n.js';

const TOAST_SECONDS = 4;

// Scatola verticale/orizzontale: GNOME 48+ usa 'orientation', 45-47 'vertical'
function box(vertical, params = {}) {
    const b = new St.BoxLayout(params);
    if ('orientation' in b) {
        b.orientation = vertical ? Clutter.Orientation.VERTICAL : Clutter.Orientation.HORIZONTAL;
    } else {
        b.vertical = vertical;
    }
    return b;
}

function label(text, styleClass = '', wrap = true) {
    const l = new St.Label({text, style_class: styleClass, x_expand: true});
    if (wrap) {
        l.clutter_text.line_wrap = true;
    }
    return l;
}

function button(text, onClick, {sensitive = true, style = null, expand = false} = {}) {
    const b = new St.Button({
        label: text,
        style_class: `button bluehub-button${style ? ` bluehub-${style}` : ''}`,
        can_focus: sensitive,   // disattivato: niente clic e niente tastiera
        reactive: sensitive,
        x_expand: expand,
    });
    if (!sensitive) {
        b.add_style_pseudo_class('insensitive');
    }
    b.connect('clicked', () => {
        if (sensitive) {
            onClick();
        }
    });
    return b;
}

function destroyChildren(actor) {
    for (const child of actor.get_children()) {
        child.destroy();
    }
}

export class HubPanel {
    // onOpenWindow(): apre la finestra BlueHub completa (pulsante in fondo)
    // onClosed(): la visita è finita (l'hub ha distrutto la pagina)
    constructor({withSidePage, onOpenWindow, onClosed = null}) {
        this._withSide = withSidePage;
        this._onOpenWindow = onOpenWindow;
        this._onClosed = onClosed;
        this._confirmMac = null;      // mouse/tastiera in attesa di conferma
        this._toastId = 0;

        this.mainPage = box(true, {style_class: 'bluehub-page', x_expand: true});
        this._toastLabel = label('', 'bluehub-toast');
        this._toastLabel.visible = false;
        this.mainPage.add_child(this._toastLabel);
        this._mainBody = box(true, {style_class: 'bluehub-body', x_expand: true});
        this.mainPage.add_child(this._mainBody);

        if (this._withSide) {
            this.sidePage = box(true, {style_class: 'bluehub-page bluehub-side', x_expand: true});
            this._sideBody = box(true, {style_class: 'bluehub-body', x_expand: true});
            this.sidePage.add_child(this._sideBody);
            this.sidePage.connect('destroy', () => {
                this.sidePage = null;
                this._sideBody = null;
                this._withSide = false;
                // riquadro chiuso prima della pagina (ancora viva): liste nella colonna
                if (this.mainPage && !this._closing) {
                    this._render();
                }
            });
        } else {
            this.sidePage = null;
        }

        this._model = new PanelModel({
            onChange: () => this._render(),
            onToast: text => this._toast(text),
        });
        // Fine visita: si ferma tutto (comandi in corso, timer)
        this.mainPage.connect('destroy', () => this._destroy());

        this._render();
        this._model?.refresh();
    }

    // Dopo l'apertura: se l'hub non ha messo a schermo il riquadro affiancato
    // (errore o versione dell'hub senza 'side'), le liste tornano nella colonna
    checkSidePage() {
        if (this.sidePage && !this.sidePage.get_parent()) {
            const side = this.sidePage;
            this.sidePage = null;
            this._sideBody = null;
            this._withSide = false;
            side.destroy();   // mai preso dall'hub: è nostro
            this._render();
        }
    }

    _destroy() {
        this._closing = true;
        this._model?.destroy();
        this._model = null;
        if (this._toastId) {
            GLib.source_remove(this._toastId);
            this._toastId = 0;
        }
        // Il riquadro affiancato lo distrugge l'hub: qui solo si dimentica
        this.sidePage = null;
        this._sideBody = null;
        this._toastLabel = null;
        this.mainPage = null;
        const onClosed = this._onClosed;
        this._onClosed = null;
        onClosed?.();
    }

    _toast(text) {
        if (!this._toastLabel) {
            return;
        }
        this._toastLabel.text = text;
        this._toastLabel.visible = true;
        if (this._toastId) {
            GLib.source_remove(this._toastId);
        }
        this._toastId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, TOAST_SECONDS, () => {
            this._toastId = 0;
            if (this._toastLabel) {
                this._toastLabel.visible = false;
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    // ------------------------------------------------------------------
    // Disegno (ricostruito a ogni cambiamento del modello)
    // ------------------------------------------------------------------

    _render() {
        if (!this._model || !this.mainPage) {
            return;
        }
        const v = this._model.view();
        destroyChildren(this._mainBody);
        this._renderMain(v, this._mainBody);

        const listsHost = this._withSide && this._sideBody ? this._sideBody : this._mainBody;
        if (listsHost === this._sideBody) {
            destroyChildren(this._sideBody);
        }
        for (const group of v.groups) {
            this._renderGroup(group, listsHost);
        }
        // In fondo: la finestra completa (per chi la preferisce)
        this._mainBody.add_child(button(_('Open the full BlueHub panel'), () => this._onOpenWindow(), {expand: true}));
    }

    _renderMain(v, host) {
        // Attivazione + Cerca BT
        const top = box(false, {style_class: 'bluehub-buttons', x_expand: true});
        top.add_child(button(v.masterLabel, () => this._model?.setEnabled(!v.enabled),
            {sensitive: v.loaded, style: v.enabled ? 'suggested' : null, expand: true}));
        top.add_child(button(v.scanLabel, () => this._model?.scan(),
            {sensitive: v.enabled && !v.scanning, expand: true}));
        top.add_child(button('⟳', () => this._model?.refresh()));
        host.add_child(top);
        host.add_child(label(v.masterSubtitle, 'bluehub-dim'));

        // Antenne
        host.add_child(label(v.antenna.title, 'bluehub-section'));
        host.add_child(label(v.antenna.subtitle, 'bluehub-dim'));
        if (v.antenna.options) {
            const opts = box(false, {style_class: 'bluehub-buttons', x_expand: true});
            for (const o of v.antenna.options) {
                opts.add_child(button(o.label, () => this._model?.selectScanAdapter(o.key),
                    {style: o.active ? 'suggested' : null, sensitive: v.enabled}));
            }
            host.add_child(opts);
        }

        // Canali e quote [ − / + ]
        host.add_child(label(_('📡 Bluetooth Channel Allocation'), 'bluehub-title'));
        host.add_child(label(v.channelsSummary, 'bluehub-dim'));
        const cards = box(false, {style_class: 'bluehub-cards', x_expand: true});
        cards.add_child(this._quotaCard(v.gamepadCard, d => this._model?.changeQuota('gamepad', d)));
        cards.add_child(this._quotaCard(v.audioCard, d => this._model?.changeQuota('audio', d)));
        host.add_child(cards);
        host.add_child(label(v.capTitle, 'bluehub-section'));
        host.add_child(label(v.capSubtitle, 'bluehub-dim'));
    }

    _quotaCard(card, onChange) {
        const c = box(true, {style_class: 'bluehub-card', x_expand: true});
        c.add_child(label(card.title, 'bluehub-section'));
        c.add_child(label(card.sub, 'bluehub-dim'));
        const ctrl = box(false, {style_class: 'bluehub-quota', x_align: Clutter.ActorAlign.CENTER});
        ctrl.add_child(button('−', () => onChange(-1), {sensitive: card.canMinus}));
        ctrl.add_child(new St.Label({text: String(card.value), style_class: 'bluehub-value', y_align: Clutter.ActorAlign.CENTER}));
        ctrl.add_child(button('+', () => onChange(+1), {sensitive: card.canPlus, style: card.canPlus ? 'suggested' : null}));
        c.add_child(ctrl);
        return c;
    }

    _renderGroup(group, host) {
        host.add_child(label(group.title, 'bluehub-title'));
        if (group.description) {
            host.add_child(label(group.description, 'bluehub-dim'));
        }
        if (group.rows.length === 0 && group.empty) {
            host.add_child(label(group.empty.title, 'bluehub-section'));
            host.add_child(label(group.empty.subtitle, 'bluehub-dim'));
            return;
        }
        for (const row of group.rows) {
            host.add_child(this._deviceRow(row, group.sensitive));
        }
    }

    _deviceRow(row, groupSensitive) {
        const r = box(true, {style_class: 'bluehub-row', x_expand: true});
        const head = box(false, {x_expand: true});
        head.add_child(new St.Icon({icon_name: row.iconName, style_class: 'bluehub-row-icon', y_align: Clutter.ActorAlign.START}));
        const texts = box(true, {x_expand: true});
        texts.add_child(label(row.title, 'bluehub-section'));
        texts.add_child(label(row.subtitle, 'bluehub-dim'));
        head.add_child(texts);
        r.add_child(head);

        // Conferma per mouse/tastiera (al posto della finestra di dialogo)
        if (this._confirmMac === row.dev.mac) {
            r.add_child(label(row.confirmBody, 'bluehub-warning'));
            const ask = box(false, {style_class: 'bluehub-buttons', x_expand: true});
            ask.add_child(button(_('Cancel'), () => {
                this._confirmMac = null;
                this._render();
            }, {expand: true}));
            ask.add_child(button(_('Yes, disconnect'), () => {
                this._confirmMac = null;
                this._model?.deviceAction(row.dev);
            }, {style: 'destructive', expand: true}));
            r.add_child(ask);
            return r;
        }

        const actions = box(false, {style_class: 'bluehub-buttons', x_expand: true});
        if (row.mic) {
            actions.add_child(button(row.mic.label, () => this._model?.toggleMic(row.dev, !row.mic.active),
                {style: row.mic.active ? 'suggested' : null, sensitive: groupSensitive, expand: true}));
        }
        actions.add_child(button(row.button.label, () => {
            if (row.needsConfirm) {
                this._confirmMac = row.dev.mac;
                this._render();
            } else {
                this._model?.deviceAction(row.dev);
            }
        }, {sensitive: row.button.sensitive && (groupSensitive || row.dev.connected), style: row.button.style, expand: true}));
        r.add_child(actions);
        return r;
    }
}
