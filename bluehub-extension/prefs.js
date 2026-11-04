// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria

// Pannello di controllo BlueHub (finestra Preferenze dell'estensione):
// - più antenne Bluetooth (hci0, hci1...) con 7 canali ciascuna
// - quote [+ / −] di canali per Gamepad e Cuffie (nessun canale riservato)
// - "Cerca BT" sull'antenna scelta o su quella più libera
// - microfono delle cuffie BT (🎙️ Mic) e unione di più microfoni
// - audio condiviso automatico con 2+ cuffie
// - conferma prima di scollegare mouse e tastiera
// Tutta la logica sta in bluehub-core.js (condiviso con extension.js).

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import * as Core from './bluehub-core.js';
import {_, loadUserTranslations} from './bluehub-i18n.js';

const SCAN_SECONDS = 8;
const CH = Core.CHANNELS_PER_ADAPTER;

export default class BlueHubPreferences extends ExtensionPreferences {
    // Sincrona: GNOME 45/46 non attendono una funzione async e mostrerebbero
    // "nessuna interfaccia". Le traduzioni dell'utente arrivano subito dopo.
    fillPreferencesWindow(window) {
        window.set_default_size(720, 820);
        window.set_search_enabled(false);

        const panel = new BlueHubPanel(window);
        window.add(panel.page);
        // Alla chiusura annulla comandi e attese in corso
        window.connect('close-request', () => {
            panel.destroy();
            return false;
        });
    }
}

class BlueHubPanel {
    constructor(window) {
        this._window = window;
        this._cancellable = new Gio.Cancellable();
        this._refreshing = false;
        this._refreshAgain = false;
        this._lastBtSinks = null;      // cuffie BT viste all'ultimo aggiornamento
        this._lastSharedMsg = '';
        this._scanning = false;

        // Valori iniziali: quelli veri arrivano dalla configurazione al primo aggiornamento
        this._enabled = true;
        this._preferredScanHci = 'auto';
        this._micMacs = new Set();

        // Quote assegnate con [+ / −] (partono da 0 o dai dispositivi già connessi)
        this._quotaGamepads = 0;
        this._quotaHeadphones = 0;
        this._usablePool = 0;
        this._connGamepads = 0;
        this._connAudio = 0;
        this._freeHwChannels = 0;
        this._hw = {controllers: ['hci0'], adapters: {}, bestHci: 'hci0'};
        this._devices = [];
        this._gamepadRows = [];
        this._audioRows = [];
        this._systemRows = [];

        this.page = new Adw.PreferencesPage();
        this._buildUi();

        // Lingue diverse da italiano/inglese: carica (e completa con le frasi nuove)
        // il file di traduzione dell'utente, poi ritraduce e aggiorna
        loadUserTranslations({merge: true})
            .catch(logError)
            .finally(() => {
                if (this._alive) {
                    this._applyStaticTexts();
                    this.refresh();
                }
            });
    }

    destroy() {
        this._cancellable.cancel();
    }

    get _alive() {
        return !this._cancellable.is_cancelled();
    }

    _toast(text) {
        this._window.add_toast(new Adw.Toast({title: text, timeout: 4, use_markup: false}));
    }

    // ------------------------------------------------------------------
    // Costruzione dell'interfaccia
    // ------------------------------------------------------------------

    _buildUi() {
        // --- Scheda estensione: attivazione + Cerca BT + antenne ---
        const extGroup = new Adw.PreferencesGroup();
        this._extGroup = extGroup;
        const refreshBtn = new Gtk.Button({
            icon_name: 'view-refresh-symbolic',
            valign: Gtk.Align.CENTER,
        });
        this._refreshBtn = refreshBtn;
        refreshBtn.add_css_class('flat');
        refreshBtn.connect('clicked', () => this.refresh());
        extGroup.set_header_suffix(refreshBtn);
        this.page.add(extGroup);

        this._extRow = new Adw.ActionRow({
            subtitle: _('Controls Bluetooth channel management and automatic shared audio'),
        });
        this._extRow.add_prefix(Gtk.Image.new_from_icon_name('bluetooth-active-symbolic'));

        const extBtns = new Gtk.Box({spacing: 8, valign: Gtk.Align.CENTER});
        this._scanBtn = new Gtk.Button({valign: Gtk.Align.CENTER});
        this._scanBtn.connect('clicked', () => this._onScan().catch(logError));
        extBtns.append(this._scanBtn);

        this._masterBtn = new Gtk.ToggleButton({valign: Gtk.Align.CENTER, active: this._enabled});
        this._masterHandler = this._masterBtn.connect('toggled', () => this._onMasterToggle());
        extBtns.append(this._masterBtn);
        this._extRow.add_suffix(extBtns);
        extGroup.add(this._extRow);

        this._antennaRow = new Adw.ActionRow({use_markup: false});
        this._antennaRow.add_prefix(Gtk.Image.new_from_icon_name('network-wireless-hotspot-symbolic'));
        this._antennaBox = new Gtk.Box({spacing: 6, valign: Gtk.Align.CENTER});
        this._antennaRow.add_suffix(this._antennaBox);
        extGroup.add(this._antennaRow);

        // --- Ripartizione canali e due riquadri [ − / + ] ---
        this._radioGroup = new Adw.PreferencesGroup();
        this.page.add(this._radioGroup);

        this._radioRow = new Adw.ActionRow({use_markup: false});
        this._radioGroup.add(this._radioRow);
        this._capHintRow = new Adw.ActionRow({use_markup: false});
        this._radioGroup.add(this._capHintRow);

        const cards = new Gtk.Box({spacing: 16, homogeneous: true, margin_top: 12, margin_bottom: 8});
        this._gpCard = this._makeQuotaCard(d => this._onChangeQuota('gamepad', d));
        this._auCard = this._makeQuotaCard(d => this._onChangeQuota('audio', d));
        cards.append(this._gpCard.box);
        cards.append(this._auCard.box);
        this._radioGroup.add(cards);

        // --- Liste dispositivi ---
        this._gamepadGroup = new Adw.PreferencesGroup();
        this.page.add(this._gamepadGroup);
        this._audioGroup = new Adw.PreferencesGroup();
        this.page.add(this._audioGroup);
        this._systemGroup = new Adw.PreferencesGroup();
        this.page.add(this._systemGroup);

        this._applyStaticTexts();
    }

    // Testi fissi: chiamata alla costruzione e di nuovo dopo il caricamento delle traduzioni
    _applyStaticTexts() {
        this._extGroup.set_title(_('⚙️ BlueHub Extension'));
        this._refreshBtn.set_tooltip_text(_('Refresh adapters, channels and devices'));
        this._extRow.set_title(_('Enable BlueHub'));
        this._scanBtn.set_label(this._scanning ? _('Searching...') : _('Search BT'));
        this._scanBtn.set_tooltip_text(_('Start a smart Bluetooth scan for {seconds} seconds', {seconds: SCAN_SECONDS}));
        this._radioGroup.set_title(_('📡 Bluetooth Channel Allocation'));
        this._gpCard.titleLabel.set_label(_('🎮 Gamepads'));
        this._auCard.titleLabel.set_label(_('🎧 Headphones / Speakers'));
        this._gpCard.subLabel.set_label(_('Gamepads connected: {connected} / {quota}',
            {connected: this._connGamepads, quota: this._quotaGamepads}));
        this._auCard.subLabel.set_label(_('Headphones connected: {connected} / {quota}',
            {connected: this._connAudio, quota: this._quotaHeadphones}));
        this._updateMasterStyle();
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

    _rebuildAntennaSelector() {
        let child = this._antennaBox.get_first_child();
        while (child) {
            const next = child.get_next_sibling();
            this._antennaBox.remove(child);
            child = next;
        }

        const {controllers, adapters, bestHci} = this._hw;
        if (controllers.length === 1) {
            const h0 = controllers[0];
            const a0 = adapters[h0] ?? {activeLinks: 0, freeChannels: CH};
            this._antennaRow.set_title(
                _('Adapter detected: {hci} (Internal • {used}/{total} used, {free} free)',
                    {hci: h0, used: a0.activeLinks, total: CH, free: a0.freeChannels}));
            this._antennaRow.set_subtitle(
                _('Multi-adapter ready: plug in a USB Bluetooth dongle (hci1) to get {channels} channels with automatic distribution.',
                    {channels: 2 * CH}));
            return;
        }

        const perAnt = controllers.map(h => {
            const a = adapters[h] ?? {};
            return _('{hci} ({bus}): {used}/{total} used', {hci: h, bus: _(a.busKind ?? 'BT'), used: a.activeLinks ?? 0, total: CH});
        });
        this._antennaRow.set_title(
            _('Multi-adapter active ({count} adapters = {channels} channels): {list}',
                {count: controllers.length, channels: controllers.length * CH, list: perAnt.join(' • ')}));
        this._antennaRow.set_subtitle(
            _("Scan and pairing ('Search BT'): Auto picks the least busy adapter ({hci})", {hci: bestHci}));

        const options = [['auto', _('Auto ({hci})', {hci: bestHci})], ...controllers.map(h => [h, h])];
        if (!options.some(([k]) => k === this._preferredScanHci)) {
            this._preferredScanHci = 'auto';
        }
        let groupHead = null;
        for (const [key, label] of options) {
            const b = new Gtk.ToggleButton({label, valign: Gtk.Align.CENTER});
            if (groupHead) {
                b.set_group(groupHead);
            } else {
                groupHead = b;
            }
            b.set_active(this._preferredScanHci === key);
            b.connect('toggled', () => this._onSelectScanAntenna(b, key));
            this._antennaBox.append(b);
        }
    }

    _onSelectScanAntenna(btn, key) {
        if (!btn.get_active()) {
            return;
        }
        this._preferredScanHci = key;
        Core.updateConfig({preferred_scan_hci: key}).catch(logError);
        this._toast(_('Adapter for new pairings: {adapter}', {adapter: key === 'auto' ? _('Automatic (least busy)') : key}));
    }

    // ------------------------------------------------------------------
    // Attivazione e quote
    // ------------------------------------------------------------------

    _updateMasterStyle() {
        if (this._enabled) {
            this._masterBtn.set_label(_('🟢 On'));
            this._extRow.set_subtitle(_('🟢 BlueHub on — channel management and shared audio running'));
        } else {
            this._masterBtn.set_label(_('⚪ Off'));
            this._extRow.set_subtitle(_("⚪ BlueHub off — press 'Off' to turn it back on"));
        }
        for (const w of [this._antennaRow, this._radioGroup, this._gamepadGroup, this._audioGroup]) {
            w.set_sensitive(this._enabled);
        }
        // Durante una ricerca il pulsante resta disattivato (niente ricerche sovrapposte)
        this._scanBtn.set_sensitive(this._enabled && !this._scanning);
    }

    _onMasterToggle() {
        this._enabled = this._masterBtn.get_active();
        this._toast(this._enabled ? _('BlueHub on') : _('BlueHub off'));
        // Prima salva, poi applica l'audio e ridisegna (l'aggiornamento rilegge la configurazione)
        Core.updateConfig({enabled: this._enabled}).then(() => this.refresh()).catch(logError);
    }

    _clampQuotas() {
        this._quotaGamepads = Math.max(this._connGamepads, Math.min(this._usablePool, this._quotaGamepads));
        this._quotaHeadphones = Math.max(this._connAudio, Math.min(this._usablePool, this._quotaHeadphones));

        while (this._quotaGamepads + this._quotaHeadphones > this._usablePool) {
            if (this._quotaHeadphones > this._connAudio && this._quotaHeadphones >= this._quotaGamepads) {
                this._quotaHeadphones--;
            } else if (this._quotaGamepads > this._connGamepads) {
                this._quotaGamepads--;
            } else {
                break;
            }
        }
    }

    _onChangeQuota(kind, delta) {
        const isGp = kind === 'gamepad';
        const current = isGp ? this._quotaGamepads : this._quotaHeadphones;
        const connected = isGp ? this._connGamepads : this._connAudio;
        const newVal = current + delta;
        if (newVal < connected || newVal < 0) {
            return;
        }
        if (delta > 0 && this._quotaGamepads + this._quotaHeadphones >= this._usablePool) {
            return;
        }
        if (isGp) {
            this._quotaGamepads = newVal;
        } else {
            this._quotaHeadphones = newVal;
        }
        this._updateQuotasAndButtons();
    }

    _updateQuotasAndButtons() {
        this._updateMasterStyle();

        const allocated = this._quotaGamepads + this._quotaHeadphones;
        const unassigned = Math.max(0, this._usablePool - allocated);
        const capReached = allocated >= this._usablePool;

        this._gpCard.valLabel.set_label(String(this._quotaGamepads));
        this._auCard.valLabel.set_label(String(this._quotaHeadphones));
        this._gpCard.subLabel.set_label(_('Gamepads connected: {connected} / {quota}',
            {connected: this._connGamepads, quota: this._quotaGamepads}));
        this._auCard.subLabel.set_label(_('Headphones connected: {connected} / {quota}',
            {connected: this._connAudio, quota: this._quotaHeadphones}));

        this._gpCard.minusBtn.set_sensitive(this._enabled && this._quotaGamepads > this._connGamepads);
        this._gpCard.plusBtn.set_sensitive(this._enabled && !capReached);
        this._auCard.minusBtn.set_sensitive(this._enabled && this._quotaHeadphones > this._connAudio);
        this._auCard.plusBtn.set_sensitive(this._enabled && !capReached);

        if (capReached) {
            this._capHintRow.set_title(
                _('🔒 All {pool} available channels are assigned ({gamepads} gamepads + {headphones} headphones)',
                    {pool: this._usablePool, gamepads: this._quotaGamepads, headphones: this._quotaHeadphones}));
            this._capHintRow.set_subtitle(
                _('No channels left. To move a channel to the other box, first press [ − ] on the one that has it.'));
        } else {
            this._capHintRow.set_title(
                unassigned === 1
                    ? _('🟢 You still have 1 channel to assign ({assigned}/{pool} assigned)', {assigned: allocated, pool: this._usablePool})
                    : _('🟢 You still have {free} channels to assign ({assigned}/{pool} assigned)',
                        {free: unassigned, assigned: allocated, pool: this._usablePool}));
            this._capHintRow.set_subtitle(_('You can put them all on gamepads, all on headphones, or split them as you like.'));
        }

        this._rebuildDeviceLists();
    }

    // ------------------------------------------------------------------
    // Aggiornamento (audio + Bluetooth), senza bloccare la finestra
    // ------------------------------------------------------------------

    refresh() {
        this._doRefresh().catch(logError);
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
                await this._refreshOnce();
            } while (this._refreshAgain && this._alive);
        } finally {
            this._refreshing = false;
        }
    }

    async _refreshOnce() {
        const cfg = await Core.loadConfig();
        if (!this._alive) {
            return;
        }
        this._enabled = cfg.enabled !== false;
        this._preferredScanHci = cfg.preferred_scan_hci ?? 'auto';
        this._micMacs = new Set((cfg.mic_enabled_macs ?? []).map(m => m.toUpperCase()));
        if (this._masterBtn.get_active() !== this._enabled) {
            // Allinea il pulsante alla configurazione senza far scattare _onMasterToggle
            this._masterBtn.block_signal_handler(this._masterHandler);
            this._masterBtn.set_active(this._enabled);
            this._masterBtn.unblock_signal_handler(this._masterHandler);
        }

        // Prima microfoni e audio condiviso, poi si rilegge lo stato aggiornato
        const sharedMsg = await this._syncAudio();
        if (!this._alive) {
            return;
        }
        const {hw, devices} = await Core.readBluetoothState(this._cancellable);
        if (!this._alive) {
            return;
        }

        this._lastSharedMsg = sharedMsg;
        this._hw = hw;
        this._freeHwChannels = hw.freeChannels;
        this._devices = devices;
        this._rebuildAntennaSelector();

        const connected = cat => devices.filter(d => d.category === cat && d.connected);
        this._connGamepads = connected('gamepad').length;
        this._connAudio = connected('audio').length;
        const connSystem = connected('system');

        const reserved = Math.max(connSystem.length, hw.activeLinks - this._connGamepads - this._connAudio);
        this._usablePool = Math.max(0, hw.totalChannels - reserved);
        this._clampQuotas();

        const antLabel = hw.numControllers === 1 ? _('1 adapter') : _('{count} adapters', {count: hw.numControllers});
        this._radioGroup.set_description(GLib.markup_escape_text(
            _('{total} total channels ({adapters}) − {reserved} already in use = {pool} free channels to assign',
                {total: hw.totalChannels, adapters: antLabel, reserved, pool: this._usablePool}), -1));

        const sysDesc = connSystem.length ? ` (${connSystem.map(d => d.name).join(', ')})` : '';
        this._radioRow.set_title(
            _('{total} total channels − {reserved} used by peripherals{devices} = {pool} available channels',
                {total: hw.totalChannels, reserved, devices: sysDesc, pool: this._usablePool}));
        this._radioRow.set_subtitle(_('No channel is reserved in advance: you can assign all available channels as you like.'));

        this._updateQuotasAndButtons();
    }

    // Microfoni BT + audio condiviso. Restituisce il testo di stato per le cuffie.
    async _syncAudio() {
        const c = this._cancellable;
        if (!this._enabled) {
            await Core.applySharedAudioState(false, this._lastBtSinks, c);
            await Core.unloadCombinedMics(c);
            this._lastBtSinks = null;
            return _('⚪ BlueHub off — shared audio stopped');
        }

        const mics = await Core.syncBtMicrophones(this._micMacs, c);
        let micMsg;
        if (mics.length >= 2) {
            micMsg = _(' • 🎙️ {count} Bluetooth mics joined ({names})', {count: mics.length, names: mics.map(m => m.desc).join(', ')});
        } else if (mics.length === 1) {
            micMsg = _(' • 🎙️ Bluetooth mic on: {name}', {name: mics[0].desc});
        } else {
            micMsg = _(' • 🔒 Headphones kept in HD stereo (Bluetooth mics off)');
        }
        const audio = await Core.applySharedAudioState(true, this._lastBtSinks, c);
        this._lastBtSinks = audio.btSinks;

        const infos = audio.btSinkInfos;
        if (infos.length >= 2) {
            return _('🎶 AUTOMATIC shared listening on {count} headphones ({names}){mic}',
                {count: infos.length, names: infos.map(s => s.desc).join(', '), mic: micMsg});
        }
        if (infos.length === 1) {
            return _('🎧 Audio on: {name}{mic}', {name: infos[0].desc, mic: micMsg});
        }
        return audio.fallbackDesc
            ? _('🔊 No Bluetooth headphones connected — audio on: {name}', {name: audio.fallbackDesc})
            : _('🔊 No Bluetooth headphones connected — audio on the output chosen in the system');
    }

    // ------------------------------------------------------------------
    // Liste dispositivi
    // ------------------------------------------------------------------

    _fillGroup(group, rows, devices, category, emptyTitle, emptySubtitle) {
        for (const r of rows) {
            group.remove(r);
        }
        rows.length = 0;

        if (devices.length === 0 && emptyTitle) {
            const empty = new Adw.ActionRow({title: emptyTitle, subtitle: emptySubtitle});
            group.add(empty);
            rows.push(empty);
            return;
        }
        for (const dev of devices) {
            const row = this._createBtRow(dev, category);
            group.add(row);
            rows.push(row);
        }
    }

    _rebuildDeviceLists() {
        const byCat = cat => this._devices.filter(d => d.category === cat);

        // 1. Gamepad
        this._gamepadGroup.set_title(
            _('🎮 Bluetooth gamepads (connected: {connected} / channels assigned: {quota})',
                {connected: this._connGamepads, quota: this._quotaGamepads}));
        this._gamepadGroup.set_description(this._quotaGamepads === 0 && this._connGamepads === 0
            ? _('0 channels assigned to gamepads: press [ + ] in the Gamepads box to allow connections.')
            : _('Free gamepad slots: {free} of {quota} assigned.',
                {free: Math.max(0, this._quotaGamepads - this._connGamepads), quota: this._quotaGamepads}));
        this._fillGroup(this._gamepadGroup, this._gamepadRows, byCat('gamepad'), 'gamepad',
            _('No Bluetooth gamepads known'),
            _("Put the controller in pairing mode and press 'Search BT' above."));

        // 2. Cuffie e casse (con audio condiviso e microfoni)
        this._audioGroup.set_title(
            _('🎧 Bluetooth headphones and speakers (connected: {connected} / channels assigned: {quota})',
                {connected: this._connAudio, quota: this._quotaHeadphones}));
        // La descrizione dei gruppi è markup: i nomi delle cuffie possono contenere & < >
        this._audioGroup.set_description(GLib.markup_escape_text(this._lastSharedMsg, -1));
        this._fillGroup(this._audioGroup, this._audioRows, byCat('audio'), 'audio',
            _('No Bluetooth headphones or speakers known'),
            _("Use 'Search BT' above to look for new devices."));

        // 3. Mouse, tastiere e altro (conferma prima di scollegare)
        const system = byCat('system');
        this._systemGroup.set_title(
            _('⌨️ Mouse, keyboard and other devices ({count} connected)', {count: system.filter(d => d.connected).length}));
        this._systemGroup.set_description(GLib.markup_escape_text(
            _("Protected from accidental disconnection: pressing 'Disconnect' asks for confirmation."), -1));
        this._fillGroup(this._systemGroup, this._systemRows, system, 'system', null, null);
    }

    _createBtRow(dev, category) {
        const hciTag = `📡 ${dev.knownHcis.length > 1 ? dev.knownHcis.join('/') : dev.hci}`;
        const status = dev.connected
            ? _('🟢 Connected on {hci} (1 channel)', {hci: dev.hci})
            : _('⚪ Not connected ({adapters})', {adapters: hciTag});
        const battery = dev.battery ? ` • 🔋 ${dev.battery}` : '';
        const row = new Adw.ActionRow({
            title: dev.name,
            subtitle: `${status} • ${_(dev.kindLabel)}${battery}`,
            use_markup: false,   // i nomi dei dispositivi possono contenere & < >
        });
        row.add_prefix(Gtk.Image.new_from_icon_name(dev.iconName));

        const suffix = new Gtk.Box({spacing: 8, valign: Gtk.Align.CENTER});

        // Cuffia connessa: pulsante per il suo microfono
        if (category === 'audio' && dev.connected) {
            const micOn = this._micMacs.has(dev.mac) || dev.isMicActive;
            const micBtn = new Gtk.ToggleButton({
                label: micOn ? _('🎙️ Mic: ON (voice)') : _('🎙️ Mic: OFF (HD audio)'),
                valign: Gtk.Align.CENTER,
                active: micOn,
                tooltip_text: _('OFF = headphones kept in high-quality stereo (A2DP)\nON = turns on the built-in microphone of these Bluetooth headphones (HFP)'),
            });
            micBtn.connect('toggled', () => this._onToggleMic(micBtn, dev));
            suffix.append(micBtn);
        }

        const btn = new Gtk.Button({valign: Gtk.Align.CENTER});
        if (dev.connected) {
            btn.set_label(_('Disconnect'));
            btn.add_css_class('destructive-action');
        } else if (dev.adapterFree <= 0) {
            btn.set_label(_('Adapter {hci} full ({total}/{total})', {hci: dev.hci, total: CH}));
            btn.set_sensitive(false);
        } else if (category === 'gamepad' || category === 'audio') {
            const isGp = category === 'gamepad';
            const hasSlot = this._enabled && this._freeHwChannels > 0 &&
                (isGp ? this._connGamepads < this._quotaGamepads : this._connAudio < this._quotaHeadphones);
            btn.set_label(hasSlot ? _('Connect') : isGp ? _('Locked (give +1 to Gamepads)') : _('Locked (give +1 to Headphones)'));
            btn.set_sensitive(hasSlot);
            if (hasSlot) {
                btn.add_css_class('suggested-action');
            }
        } else {
            const hasSlot = this._freeHwChannels > 0;
            btn.set_label(hasSlot ? _('Connect') : _('Channels full'));
            btn.set_sensitive(hasSlot);
            if (hasSlot) {
                btn.add_css_class('suggested-action');
            }
        }
        btn.connect('clicked', () => this._onDeviceButton(btn, dev, category).catch(logError));
        suffix.append(btn);

        row.add_suffix(suffix);
        return row;
    }

    _onToggleMic(btn, dev) {
        const wantMic = btn.get_active();
        if (wantMic) {
            this._micMacs.add(dev.mac);
        } else {
            this._micMacs.delete(dev.mac);
        }
        this._toast(wantMic
            ? _('{device}: Bluetooth microphone on', {device: dev.name})
            : _('{device}: HD stereo audio restored (mic off)', {device: dev.name}));
        Core.updateConfig({mic_enabled_macs: [...this._micMacs].sort()})
            .then(() => this.refresh()).catch(logError);
    }

    // ------------------------------------------------------------------
    // Connessione, disconnessione, ricerca
    // ------------------------------------------------------------------

    _confirm(heading, body, okLabel) {
        return new Promise(resolve => {
            let dialog;
            if (Adw.AlertDialog) {          // libadwaita 1.5+ (GNOME 46+)
                dialog = new Adw.AlertDialog({heading, body});
            } else {
                dialog = new Adw.MessageDialog({heading, body, transient_for: this._window, modal: true});
            }
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

    async _onDeviceButton(btn, dev, category) {
        if (dev.connected && category === 'system') {
            const ok = await this._confirm(
                _('Disconnect {device}?', {device: dev.name}),
                _("You are about to disconnect '{device}' from adapter {hci}.\nIf it is your main mouse or keyboard you could lose control! Do you want to continue?",
                    {device: dev.name, hci: dev.hci}),
                _('Yes, disconnect'));
            if (!ok || !this._alive) {
                return;
            }
        }

        const wasConnected = dev.connected;
        btn.set_sensitive(false);
        btn.set_label(_('Please wait...'));
        this._toast(wasConnected
            ? _('Disconnecting {device} (adapter {hci})...', {device: dev.name, hci: dev.hci})
            : _('Connecting {device} (adapter {hci})...', {device: dev.name, hci: dev.hci}));

        await Core.setDeviceConnected(dev, !wasConnected, this._cancellable);
        if (!this._alive) {
            return;
        }
        // Disconnettendo si libera anche il canale assegnato
        if (wasConnected) {
            if (dev.category === 'audio' && this._quotaHeadphones > 0) {
                this._quotaHeadphones--;
            } else if (dev.category === 'gamepad' && this._quotaGamepads > 0) {
                this._quotaGamepads--;
            }
        }
        this.refresh();
    }

    async _onScan() {
        if (this._scanning) {
            return;
        }
        this._scanning = true;
        this._scanBtn.set_sensitive(false);
        this._scanBtn.set_label(_('Searching...'));

        const {adapters, bestHci} = this._hw;
        let target = this._preferredScanHci === 'auto' ? bestHci : this._preferredScanHci;
        if (!adapters[target]) {
            target = bestHci;   // antenna scelta non più presente
        }
        if (Object.keys(adapters).length > 1) {
            this._toast(_('Multi-adapter scan on {hci} ({free}/{total} free channels) for {seconds}s...',
                {hci: target, free: adapters[target]?.freeChannels ?? CH, total: CH, seconds: SCAN_SECONDS}));
        } else {
            this._toast(_('Bluetooth scan running for {seconds} seconds...', {seconds: SCAN_SECONDS}));
        }

        try {
            await Core.scanWithAdapter(target, SCAN_SECONDS, this._cancellable);
        } finally {
            this._scanning = false;
        }
        if (!this._alive) {
            return;
        }
        this._scanBtn.set_sensitive(this._enabled);
        this._scanBtn.set_label(_('Search BT'));
        this._toast(_('Scan finished on {hci}!', {hci: target}));
        this.refresh();
    }
}
