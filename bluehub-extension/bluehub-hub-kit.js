// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria

// Pannello BlueHub dentro Smart Calendar Hub, costruito con il kit di pezzi
// standard dell'hub (stateObj.pageKit) secondo il suo "Page model":
// - intestazioni disegnate dall'hub (title della colonna, sideTitle del riquadro)
// - titoli di sezione piccoli, righe uguali in schede (icona, titolo, una riga
//   di dettaglio, a destra UNA cosa: interruttore, valore o freccia)
// - pulsanti a pillola, un solo pulsante principale per pagina
// - nessun colore o fondo proprio, scorrimento dell'hub
// Colonna: BlueHub, audio condiviso, antenne, canali [− / +], Cerca BT.
// Riquadro affiancato: gamepad, cuffie (con microfono), altri dispositivi.
// Stessa logica della finestra: bluehub-panel-model.js.

import St from 'gi://St';

import {PanelModel} from './bluehub-panel-model.js';
import {_} from './bluehub-i18n.js';

// Pezzo del kit reso non attivo (niente clic né tastiera), con l'aspetto del tema.
// Kit versione 2+: kit.setSensitive; prima: a mano.
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

// Mette la pagina nuova e distrugge subito quella vecchia (con i suoi segnali)
function replaceChild(bin, child) {
    const old = bin.get_child();
    bin.set_child(child);
    old?.destroy();
}

export class KitHubPanel {
    // kit: stateObj.pageKit dell'hub; icon: Gio.Icon di BlueHub
    // withSidePage: l'hub mostra il riquadro affiancato
    // onClosed(): fine visita (l'hub ha distrutto la colonna)
    // notify(testo): messaggio di esito dell'hub; setCount(n): numero nell'intestazione del riquadro
    constructor({kit, icon, withSidePage, onClosed = null, notify = null, setCount = null}) {
        this._kit = kit;
        kitSetSensitive = typeof kit.setSensitive === 'function' ? kit.setSensitive : null;
        this._notify = notify;
        this._setCount = setCount;
        this._lastCount = null;
        this._icon = icon;
        this._withSide = withSidePage;
        this._onClosed = onClosed;
        this._confirmMac = null;      // mouse/tastiera in attesa di conferma
        this._closing = false;

        // Contenitori stabili (dati all'hub); dentro, la pagina del kit ricostruita
        this.mainPage = new St.Bin({x_expand: true});
        this.sidePage = this._withSide ? new St.Bin({x_expand: true}) : null;
        this.sidePage?.connect('destroy', () => {
            this.sidePage = null;
            this._withSide = false;
            if (this.mainPage && !this._closing) {
                this._render();   // riquadro chiuso prima della colonna: liste nella colonna
            }
        });

        this._model = new PanelModel({onChange: () => this._render(), onToast: text => this._notify?.(text)});
        this.mainPage.connect('destroy', () => this._destroy());
        this._render();
        this._model.refresh();
    }

    // Per i pulsanti tondi dell'intestazione del riquadro (disegnata dall'hub)
    refresh() {
        this._model?.refresh();
    }

    scan() {
        this._model?.scan();
    }

    // Dopo l'apertura: se l'hub non ha messo a schermo il riquadro, liste nella colonna
    checkSidePage() {
        if (this.sidePage && !this.sidePage.get_parent()) {
            const side = this.sidePage;
            this.sidePage = null;
            this._withSide = false;
            side.destroy();   // mai preso dall'hub: è nostro
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
        // Il riquadro lo distrugge l'hub; se non l'ha mai preso è nostro
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
    // Disegno: a ogni cambiamento del modello si ricostruiscono le pagine del kit
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
            // numero di dispositivi nell'intestazione del riquadro (solo quando cambia)
            if (s.loaded && this._setCount && this._lastCount !== s.deviceCount) {
                this._lastCount = s.deviceCount;
                this._setCount(s.deviceCount);
            }
        }
    }

    _columnPieces(s) {
        const k = this._kit;
        const pieces = [];

        // BlueHub acceso/spento e stato dell'audio condiviso
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

        // Antenne
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
                    trailing: a.active ? k.value('✓') : null,
                    onActivate: () => this._model?.selectScanAdapter(a.key),
                });
                return setSensitive(r, s.enabled);
            })));
        }

        // Canali: una riga con il valore, sotto i pulsanti − / +
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

        // Cerca BT (l'unico pulsante principale della pagina) e Aggiorna
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
            // Conferma per scollegare mouse/tastiera: riga di avviso + due pulsanti
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

    // Dispositivo: a destra l'interruttore "connesso" (o un valore se non si può)
    _deviceRow(d) {
        const k = this._kit;
        if (d.trailing.kind === 'value') {
            return k.row({icon: d.icon, title: d.title, subtitle: d.subtitle, trailing: k.value(d.trailing.text)});
        }
        const sw = k.toggle({
            active: d.trailing.active,
            onToggle: on => {
                if (!on && d.needsConfirm) {
                    sw.state = true;   // resta connesso finché non si conferma
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
