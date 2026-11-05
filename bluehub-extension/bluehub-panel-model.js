// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria

// "Modello" del pannello BlueHub: stato, regole e testi, senza grafica.
// Lo usano due "facce":
// - prefs.js: la finestra BlueHub (GTK/libadwaita), quando Smart Calendar Hub non c'è
// - bluehub-hub-panel.js: il pannello dentro Smart Calendar Hub (St, GNOME Shell)
// Ogni cambiamento chiama onChange(); la faccia ridisegna leggendo view().

import Gio from 'gi://Gio';

import * as Core from './bluehub-core.js';
import {_} from './bluehub-i18n.js';

export const SCAN_SECONDS = 8;
const CH = Core.CHANNELS_PER_ADAPTER;

export class PanelModel {
    // onChange(): da ridisegnare; onToast(testo): breve messaggio per l'utente
    constructor({onChange, onToast}) {
        this._onChange = onChange;
        this._onToast = onToast;
        this._cancellable = new Gio.Cancellable();
        this._refreshing = false;
        this._refreshAgain = false;
        this._lastBtSinks = null;      // cuffie BT viste all'ultimo aggiornamento
        this._sharedMsg = '';
        this._scanning = false;
        this._busy = new Set();        // MAC dei dispositivi in connessione/disconnessione

        // Valori iniziali: quelli veri arrivano dalla configurazione al primo aggiornamento
        this._loaded = false;
        this._enabled = true;
        this._preferredScanHci = 'auto';
        this._micMacs = new Set();

        // Quote assegnate con [+ / −] (partono da 0 o dai dispositivi già connessi)
        this._quotaGamepads = 0;
        this._quotaHeadphones = 0;
        this._usablePool = 0;
        this._reserved = 0;
        this._connGamepads = 0;
        this._connAudio = 0;
        this._hw = {controllers: ['hci0'], adapters: {}, bestHci: 'hci0', numControllers: 1,
            totalChannels: CH, activeLinks: 0, freeChannels: CH};
        this._devices = [];
    }

    destroy() {
        this._cancellable.cancel();
        this._onChange = null;
        this._onToast = null;
    }

    get alive() {
        return !this._cancellable.is_cancelled();
    }

    get enabled() {
        return this._enabled;
    }

    get scanning() {
        return this._scanning;
    }

    _changed() {
        if (this.alive) {
            this._onChange?.();
        }
    }

    _toast(text) {
        if (this.alive) {
            this._onToast?.(text);
        }
    }

    // ------------------------------------------------------------------
    // Aggiornamento (audio + Bluetooth), senza bloccare
    // ------------------------------------------------------------------

    refresh() {
        this._doRefresh().catch(e => Core.logBlueHubError(`Refresh: ${e}`));
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
            } while (this._refreshAgain && this.alive);
        } finally {
            this._refreshing = false;
        }
    }

    async _refreshOnce() {
        const cfg = await Core.loadConfig();
        if (!this.alive) {
            return;
        }
        this._enabled = cfg.enabled !== false;
        this._preferredScanHci = cfg.preferred_scan_hci ?? 'auto';
        this._micMacs = new Set((cfg.mic_enabled_macs ?? []).map(m => m.toUpperCase()));
        this._loaded = true;

        // Prima microfoni e audio condiviso, poi si rilegge lo stato aggiornato
        const sharedMsg = await this._syncAudio();
        if (!this.alive) {
            return;
        }
        const {hw, devices} = await Core.readBluetoothState(this._cancellable);
        if (!this.alive) {
            return;
        }

        this._sharedMsg = sharedMsg;
        this._hw = hw;
        this._devices = devices;
        const connected = cat => devices.filter(d => d.category === cat && d.connected).length;
        this._connGamepads = connected('gamepad');
        this._connAudio = connected('audio');
        const connSystem = connected('system');
        this._reserved = Math.max(connSystem, hw.activeLinks - this._connGamepads - this._connAudio);
        this._usablePool = Math.max(0, hw.totalChannels - this._reserved);
        this._clampQuotas();
        this._changed();
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
    // Azioni dell'utente
    // ------------------------------------------------------------------

    setEnabled(on) {
        if (!this._loaded || on === this._enabled) {
            return;
        }
        this._enabled = on;
        this._toast(on ? _('BlueHub on') : _('BlueHub off'));
        this._changed();
        // Prima salva, poi applica l'audio e ridisegna (l'aggiornamento rilegge la configurazione)
        Core.updateConfig({enabled: on}).then(() => this.refresh())
            .catch(e => Core.logBlueHubError(`Save: ${e}`));
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

    changeQuota(kind, delta) {
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
        this._changed();
    }

    selectScanAdapter(key) {
        if (key === this._preferredScanHci) {
            return;
        }
        this._preferredScanHci = key;
        Core.updateConfig({preferred_scan_hci: key}).catch(e => Core.logBlueHubError(`Save: ${e}`));
        this._toast(_('Adapter for new pairings: {adapter}', {adapter: key === 'auto' ? _('Automatic (least busy)') : key}));
        this._changed();
    }

    toggleMic(dev, wantMic) {
        if (wantMic) {
            this._micMacs.add(dev.mac);
        } else {
            this._micMacs.delete(dev.mac);
        }
        this._toast(wantMic
            ? _('{device}: Bluetooth microphone on', {device: dev.name})
            : _('{device}: HD stereo audio restored (mic off)', {device: dev.name}));
        Core.updateConfig({mic_enabled_macs: [...this._micMacs].sort()})
            .then(() => this.refresh()).catch(e => Core.logBlueHubError(`Save: ${e}`));
    }

    // Connette o disconnette (la conferma per mouse/tastiera la chiede la faccia)
    async deviceAction(dev) {
        if (this._busy.has(dev.mac)) {
            return;
        }
        const wasConnected = dev.connected;
        this._busy.add(dev.mac);
        this._changed();
        this._toast(wasConnected
            ? _('Disconnecting {device} (adapter {hci})...', {device: dev.name, hci: dev.hci})
            : _('Connecting {device} (adapter {hci})...', {device: dev.name, hci: dev.hci}));
        try {
            await Core.setDeviceConnected(dev, !wasConnected, this._cancellable);
        } finally {
            this._busy.delete(dev.mac);
        }
        if (!this.alive) {
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

    async scan() {
        if (this._scanning) {
            return;
        }
        this._scanning = true;
        this._changed();

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
        if (!this.alive) {
            return;
        }
        this._toast(_('Scan finished on {hci}!', {hci: target}));
        this._changed();
        this.refresh();
    }

    // ------------------------------------------------------------------
    // Tutto ciò che le facce mostrano: testi già tradotti e stati
    // ------------------------------------------------------------------

    view() {
        const hw = this._hw;
        const on = this._enabled;
        const allocated = this._quotaGamepads + this._quotaHeadphones;
        const unassigned = Math.max(0, this._usablePool - allocated);
        const capReached = allocated >= this._usablePool;

        // Antenne
        const {controllers, adapters, bestHci} = hw;
        let antenna;
        if (controllers.length === 1) {
            const h0 = controllers[0];
            const a0 = adapters[h0] ?? {activeLinks: 0, freeChannels: CH};
            antenna = {
                title: _('Adapter detected: {hci} (Internal • {used}/{total} used, {free} free)',
                    {hci: h0, used: a0.activeLinks, total: CH, free: a0.freeChannels}),
                subtitle: _('Multi-adapter ready: plug in a USB Bluetooth dongle (hci1) to get {channels} channels with automatic distribution.',
                    {channels: 2 * CH}),
                options: null,
            };
        } else {
            const perAnt = controllers.map(h => {
                const a = adapters[h] ?? {};
                return _('{hci} ({bus}): {used}/{total} used', {hci: h, bus: _(a.busKind ?? 'BT'), used: a.activeLinks ?? 0, total: CH});
            });
            const options = [['auto', _('Auto ({hci})', {hci: bestHci})], ...controllers.map(h => [h, h])];
            const selected = options.some(([k]) => k === this._preferredScanHci) ? this._preferredScanHci : 'auto';
            antenna = {
                title: _('Multi-adapter active ({count} adapters = {channels} channels): {list}',
                    {count: controllers.length, channels: controllers.length * CH, list: perAnt.join(' • ')}),
                subtitle: _("Scan and pairing ('Search BT'): Auto picks the least busy adapter ({hci})", {hci: bestHci}),
                options: options.map(([key, label]) => ({key, label, active: key === selected})),
            };
        }

        const antLabel = hw.numControllers === 1 ? _('1 adapter') : _('{count} adapters', {count: hw.numControllers});
        const sysConnected = this._devices.filter(d => d.category === 'system' && d.connected);
        const sysDesc = sysConnected.length ? ` (${sysConnected.map(d => d.name).join(', ')})` : '';
        const byCat = cat => this._devices.filter(d => d.category === cat);

        return {
            loaded: this._loaded,
            enabled: on,
            scanning: this._scanning,
            masterLabel: on ? _('🟢 On') : _('⚪ Off'),
            masterSubtitle: on
                ? _('🟢 BlueHub on — channel management and shared audio running')
                : _("⚪ BlueHub off — press 'Off' to turn it back on"),
            scanLabel: this._scanning ? _('Searching...') : _('Search BT'),
            antenna,
            channelsSummary: _('{total} total channels ({adapters}) − {reserved} already in use = {pool} free channels to assign',
                {total: hw.totalChannels, adapters: antLabel, reserved: this._reserved, pool: this._usablePool}),
            channelsTitle: _('{total} total channels − {reserved} used by peripherals{devices} = {pool} available channels',
                {total: hw.totalChannels, reserved: this._reserved, devices: sysDesc, pool: this._usablePool}),
            channelsSubtitle: _('No channel is reserved in advance: you can assign all available channels as you like.'),
            capTitle: capReached
                ? _('🔒 All {pool} available channels are assigned ({gamepads} gamepads + {headphones} headphones)',
                    {pool: this._usablePool, gamepads: this._quotaGamepads, headphones: this._quotaHeadphones})
                : unassigned === 1
                    ? _('🟢 You still have 1 channel to assign ({assigned}/{pool} assigned)', {assigned: allocated, pool: this._usablePool})
                    : _('🟢 You still have {free} channels to assign ({assigned}/{pool} assigned)',
                        {free: unassigned, assigned: allocated, pool: this._usablePool}),
            capSubtitle: capReached
                ? _('No channels left. To move a channel to the other box, first press [ − ] on the one that has it.')
                : _('You can put them all on gamepads, all on headphones, or split them as you like.'),
            gamepadCard: {
                title: _('🎮 Gamepads'),
                value: this._quotaGamepads,
                sub: _('Gamepads connected: {connected} / {quota}', {connected: this._connGamepads, quota: this._quotaGamepads}),
                canMinus: on && this._quotaGamepads > this._connGamepads,
                canPlus: on && !capReached,
            },
            audioCard: {
                title: _('🎧 Headphones / Speakers'),
                value: this._quotaHeadphones,
                sub: _('Headphones connected: {connected} / {quota}', {connected: this._connAudio, quota: this._quotaHeadphones}),
                canMinus: on && this._quotaHeadphones > this._connAudio,
                canPlus: on && !capReached,
            },
            groups: [
                {
                    category: 'gamepad',
                    title: _('🎮 Bluetooth gamepads (connected: {connected} / channels assigned: {quota})',
                        {connected: this._connGamepads, quota: this._quotaGamepads}),
                    description: this._quotaGamepads === 0 && this._connGamepads === 0
                        ? _('0 channels assigned to gamepads: press [ + ] in the Gamepads box to allow connections.')
                        : _('Free gamepad slots: {free} of {quota} assigned.',
                            {free: Math.max(0, this._quotaGamepads - this._connGamepads), quota: this._quotaGamepads}),
                    empty: {title: _('No Bluetooth gamepads known'),
                        subtitle: _("Put the controller in pairing mode and press 'Search BT' above.")},
                    rows: byCat('gamepad').map(d => this._row(d)),
                    sensitive: on,
                },
                {
                    category: 'audio',
                    title: _('🎧 Bluetooth headphones and speakers (connected: {connected} / channels assigned: {quota})',
                        {connected: this._connAudio, quota: this._quotaHeadphones}),
                    description: this._sharedMsg,
                    empty: {title: _('No Bluetooth headphones or speakers known'),
                        subtitle: _("Use 'Search BT' above to look for new devices.")},
                    rows: byCat('audio').map(d => this._row(d)),
                    sensitive: on,
                },
                {
                    category: 'system',
                    title: _('⌨️ Mouse, keyboard and other devices ({count} connected)', {count: sysConnected.length}),
                    description: _("Protected from accidental disconnection: pressing 'Disconnect' asks for confirmation."),
                    empty: null,
                    rows: byCat('system').map(d => this._row(d)),
                    sensitive: true,
                },
            ],
        };
    }

    // Una riga dispositivo: testi, pulsante e (per le cuffie connesse) microfono
    _row(dev) {
        const hciTag = `📡 ${dev.knownHcis.length > 1 ? dev.knownHcis.join('/') : dev.hci}`;
        const status = dev.connected
            ? _('🟢 Connected on {hci} (1 channel)', {hci: dev.hci})
            : _('⚪ Not connected ({adapters})', {adapters: hciTag});
        const battery = dev.battery ? ` • 🔋 ${dev.battery}` : '';

        let mic = null;
        if (dev.category === 'audio' && dev.connected) {
            const micOn = this._micMacs.has(dev.mac) || dev.isMicActive;
            mic = {
                active: micOn,
                label: micOn ? _('🎙️ Mic: ON (voice)') : _('🎙️ Mic: OFF (HD audio)'),
                tooltip: _('OFF = headphones kept in high-quality stereo (A2DP)\nON = turns on the built-in microphone of these Bluetooth headphones (HFP)'),
            };
        }

        let button;
        if (this._busy.has(dev.mac)) {
            button = {label: _('Please wait...'), sensitive: false, style: null};
        } else if (dev.connected) {
            button = {label: _('Disconnect'), sensitive: true, style: 'destructive'};
        } else if (dev.adapterFree <= 0) {
            button = {label: _('Adapter {hci} full ({total}/{total})', {hci: dev.hci, total: CH}), sensitive: false, style: null};
        } else if (dev.category === 'gamepad' || dev.category === 'audio') {
            const isGp = dev.category === 'gamepad';
            const hasSlot = this._enabled && this._hw.freeChannels > 0 &&
                (isGp ? this._connGamepads < this._quotaGamepads : this._connAudio < this._quotaHeadphones);
            button = {
                label: hasSlot ? _('Connect') : isGp ? _('Locked (give +1 to Gamepads)') : _('Locked (give +1 to Headphones)'),
                sensitive: hasSlot,
                style: hasSlot ? 'suggested' : null,
            };
        } else {
            const hasSlot = this._hw.freeChannels > 0;
            button = {label: hasSlot ? _('Connect') : _('Channels full'), sensitive: hasSlot, style: hasSlot ? 'suggested' : null};
        }

        return {
            dev,
            title: dev.name,
            subtitle: `${status} • ${_(dev.kindLabel)}${battery}`,
            iconName: dev.iconName,
            mic,
            button,
            // Mouse/tastiera connessi: chiedere conferma prima di scollegare
            needsConfirm: dev.connected && dev.category === 'system',
            confirmTitle: _('Disconnect {device}?', {device: dev.name}),
            confirmBody: _("You are about to disconnect '{device}' from adapter {hci}.\nIf it is your main mouse or keyboard you could lose control! Do you want to continue?",
                {device: dev.name, hci: dev.hci}),
        };
    }
}
