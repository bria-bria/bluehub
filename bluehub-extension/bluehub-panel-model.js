// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria

// BlueHub panel model: state, rules and texts, with no widgets.
// Shared by two front ends so the logic lives in one place:
// - prefs.js: the GTK/libadwaita window, used when Smart Calendar Hub is missing
// - bluehub-hub-kit.js: the page inside Smart Calendar Hub
// Every change calls onChange(); the front end redraws from view() or short().

import Gio from 'gi://Gio';

import * as Core from './bluehub-core.js';
import {_} from './bluehub-i18n.js';

export const SCAN_SECONDS = 8;
const CH = Core.CHANNELS_PER_ADAPTER;

export class PanelModel {
    // onChange(): redraw needed; onToast(text): short message for the user
    constructor({onChange, onToast}) {
        this._onChange = onChange;
        this._onToast = onToast;
        this._cancellable = new Gio.Cancellable();
        this._refreshing = false;
        this._refreshAgain = false;
        this._lastBtSinks = null;      // BT sinks seen at the last refresh
        this._sharedMsg = '';
        this._audioShort = '';         // one-line audio status for the hub page
        this._scanning = false;
        this._busy = new Set();        // MACs of devices being (dis)connected

        // Placeholders: the real values come from the config on the first refresh
        this._loaded = false;
        this._enabled = true;
        this._preferredScanHci = 'auto';
        this._micMacs = new Set();

        // Quotas set with [+ / −]; never below the devices already connected
        this._quotaGamepads = 0;
        this._quotaHeadphones = 0;
        this._quotasSet = false;      // initial quotas chosen at the first reading
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
    // Refresh (audio + Bluetooth), non-blocking
    // ------------------------------------------------------------------

    refresh() {
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

        // Sync audio first so the Bluetooth state read below reflects it
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
        // First reading: one channel already reserved for each kind of known device
        // (a gamepad, headphones), so they can connect without pressing [ + ]
        if (!this._quotasSet) {
            this._quotasSet = true;
            const known = cat => devices.some(d => d.category === cat);
            this._quotaGamepads = Math.max(this._connGamepads, known('gamepad') ? 1 : 0);
            this._quotaHeadphones = Math.max(this._connAudio, known('audio') ? 1 : 0);
        }
        this._clampQuotas();
        this._changed();
    }

    // BT microphones + shared audio. Returns the status text for the headphones group.
    async _syncAudio() {
        const c = this._cancellable;
        if (!this._enabled) {
            await Core.applySharedAudioState(false, this._lastBtSinks, c);
            await Core.unloadCombinedMics(c);
            this._lastBtSinks = null;
            this._audioShort = _('Off');
            return _('BlueHub off — shared audio stopped');
        }

        const mics = await Core.syncBtMicrophones(this._micMacs, c);
        let micMsg;
        if (mics.length >= 2) {
            micMsg = _(' • {count} Bluetooth mics joined ({names})', {count: mics.length, names: mics.map(m => m.desc).join(', ')});
        } else if (mics.length === 1) {
            micMsg = _(' • Bluetooth mic on: {name}', {name: mics[0].desc});
        } else {
            micMsg = _(' • Headphones kept in HD stereo (Bluetooth mics off)');
        }
        const audio = await Core.applySharedAudioState(true, this._lastBtSinks, c);
        this._lastBtSinks = audio.btSinks;

        const infos = audio.btSinkInfos;
        const micShort = mics.length >= 2 ? _(' · {count} microphones joined', {count: mics.length})
            : mics.length === 1 ? _(' · microphone on') : '';
        if (infos.length >= 2) {
            this._audioShort = _('On {count} headphones: {names}', {count: infos.length, names: infos.map(i => i.desc).join(', ')}) + micShort;
        } else if (infos.length === 1) {
            this._audioShort = _('On {name}', {name: infos[0].desc}) + micShort;
        } else {
            this._audioShort = audio.fallbackDesc
                ? _('No Bluetooth headphones · audio on {name}', {name: audio.fallbackDesc})
                : _('No Bluetooth headphones');
        }
        if (infos.length >= 2) {
            return _('Automatic shared listening on {count} headphones ({names}){mic}',
                {count: infos.length, names: infos.map(s => s.desc).join(', '), mic: micMsg});
        }
        if (infos.length === 1) {
            return _('Audio on: {name}{mic}', {name: infos[0].desc, mic: micMsg});
        }
        return audio.fallbackDesc
            ? _('No Bluetooth headphones connected — audio on: {name}', {name: audio.fallbackDesc})
            : _('No Bluetooth headphones connected — audio on the output chosen in the system');
    }

    // ------------------------------------------------------------------
    // User actions
    // ------------------------------------------------------------------

    setEnabled(on) {
        if (!this._loaded || on === this._enabled) {
            return;
        }
        this._enabled = on;
        this._toast(on ? _('BlueHub on') : _('BlueHub off'));
        this._changed();
        // Save first: the refresh re-reads the config to apply the audio state
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

    // Connect or disconnect; the front end asks for confirmation on mouse/keyboard
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
        // Disconnecting also gives back the assigned channel
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
            target = bestHci;   // chosen adapter is gone
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
    // Everything the front ends show: translated texts and states
    // ------------------------------------------------------------------

    view() {
        const hw = this._hw;
        const on = this._enabled;
        const allocated = this._quotaGamepads + this._quotaHeadphones;
        const unassigned = Math.max(0, this._usablePool - allocated);
        const capReached = allocated >= this._usablePool;

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
            masterLabel: on ? _('On') : _('Off'),
            masterSubtitle: on
                ? _('BlueHub on — channel management and shared audio running')
                : _("BlueHub off — press 'Off' to turn it back on"),
            scanLabel: this._scanning ? _('Searching...') : _('Search BT'),
            antenna,
            channelsSummary: _('{total} total channels ({adapters}) − {reserved} already in use = {pool} free channels to assign',
                {total: hw.totalChannels, adapters: antLabel, reserved: this._reserved, pool: this._usablePool}),
            channelsTitle: _('{total} total channels − {reserved} used by peripherals{devices} = {pool} available channels',
                {total: hw.totalChannels, reserved: this._reserved, devices: sysDesc, pool: this._usablePool}),
            channelsSubtitle: _('No channel is reserved in advance: you can assign all available channels as you like.'),
            capTitle: capReached
                ? _('All {pool} available channels are assigned ({gamepads} gamepads + {headphones} headphones)',
                    {pool: this._usablePool, gamepads: this._quotaGamepads, headphones: this._quotaHeadphones})
                : unassigned === 1
                    ? _('You still have 1 channel to assign ({assigned}/{pool} assigned)', {assigned: allocated, pool: this._usablePool})
                    : _('You still have {free} channels to assign ({assigned}/{pool} assigned)',
                        {free: unassigned, assigned: allocated, pool: this._usablePool}),
            capSubtitle: capReached
                ? _('No channels left. To move a channel to the other box, first press [ − ] on the one that has it.')
                : _('You can put them all on gamepads, all on headphones, or split them as you like.'),
            gamepadCard: {
                title: _('Gamepads'),
                value: this._quotaGamepads,
                sub: _('Gamepads connected: {connected} / {quota}', {connected: this._connGamepads, quota: this._quotaGamepads}),
                canMinus: on && this._quotaGamepads > this._connGamepads,
                canPlus: on && !capReached,
            },
            audioCard: {
                title: _('Headphones / Speakers'),
                value: this._quotaHeadphones,
                sub: _('Headphones connected: {connected} / {quota}', {connected: this._connAudio, quota: this._quotaHeadphones}),
                canMinus: on && this._quotaHeadphones > this._connAudio,
                canPlus: on && !capReached,
            },
            groups: [
                {
                    category: 'gamepad',
                    title: _('Bluetooth gamepads (connected: {connected} / channels assigned: {quota})',
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
                    title: _('Bluetooth headphones and speakers (connected: {connected} / channels assigned: {quota})',
                        {connected: this._connAudio, quota: this._quotaHeadphones}),
                    description: this._sharedMsg,
                    empty: {title: _('No Bluetooth headphones or speakers known'),
                        subtitle: _("Use 'Search BT' above to look for new devices.")},
                    rows: byCat('audio').map(d => this._row(d)),
                    sensitive: on,
                },
                {
                    category: 'system',
                    title: _('Mouse, keyboard and other devices ({count} connected)', {count: sysConnected.length}),
                    description: _("Protected from accidental disconnection: pressing 'Disconnect' asks for confirmation."),
                    empty: null,
                    rows: byCat('system').map(d => this._row(d)),
                    sensitive: true,
                },
            ],
        };
    }

    // Short version for the Smart Calendar Hub page: its "Page model" rows have
    // a title, one detail line and a single trailing widget
    short() {
        const hw = this._hw;
        const on = this._enabled;
        const allocated = this._quotaGamepads + this._quotaHeadphones;
        const capReached = allocated >= this._usablePool;
        const adapters = hw.controllers.map(h => {
            const a = hw.adapters[h] ?? {activeLinks: 0, freeChannels: CH, busKind: 'Internal'};
            return {
                key: h,
                title: _('{hci} · {bus}', {hci: h, bus: _(a.busKind ?? 'Internal')}),
                subtitle: _('{used}/{total} channels used · {free} free', {used: a.activeLinks ?? 0, total: CH, free: a.freeChannels ?? CH}),
            };
        });
        const multi = hw.controllers.length > 1;
        const selected = multi && hw.controllers.includes(this._preferredScanHci) ? this._preferredScanHci : 'auto';

        const device = dev => {
            const busy = this._busy.has(dev.mac);
            const battery = dev.battery ? ` · ${_('battery {pct}', {pct: dev.battery})}` : '';
            let status = dev.connected ? _('Connected on {hci}', {hci: dev.hci}) : _('Not connected');
            // Trailing widget: a connect switch, or a value saying why it cannot connect
            let trailing = {kind: 'toggle', active: dev.connected};
            if (busy) {
                trailing = {kind: 'value', text: '…'};
            } else if (!dev.connected && dev.adapterFree <= 0) {
                trailing = {kind: 'value', text: _('Full')};
                status = _('Adapter {hci} full', {hci: dev.hci});
            } else if (!dev.connected && (dev.category === 'gamepad' || dev.category === 'audio')) {
                const isGp = dev.category === 'gamepad';
                // BlueHub off: plain Bluetooth, no quotas
                const hasSlot = hw.freeChannels > 0 && (!on ||
                    (isGp ? this._connGamepads < this._quotaGamepads : this._connAudio < this._quotaHeadphones));
                if (!hasSlot) {
                    trailing = {kind: 'value', text: _('Locked')};
                    status = isGp ? _('Give +1 to Gamepads to connect') : _('Give +1 to Headphones to connect');
                }
            } else if (!dev.connected && hw.freeChannels <= 0) {
                trailing = {kind: 'value', text: _('Full')};
            }
            let mic = null;
            if (dev.category === 'audio' && dev.connected) {
                const micOn = this._micMacs.has(dev.mac) || dev.isMicActive;
                mic = {
                    active: micOn,
                    title: _('Microphone of {device}', {device: dev.name}),
                    subtitle: micOn ? _('On: voice (HFP)') : _('Off: HD audio (A2DP)'),
                };
            }
            return {
                dev,
                icon: dev.iconName,
                title: dev.name,
                subtitle: status + battery,
                trailing,
                mic,
                needsConfirm: dev.connected && dev.category === 'system',
                confirmTitle: _('Disconnect {device}?', {device: dev.name}),
                confirmSubtitle: _('You could lose your mouse or keyboard'),
            };
        };
        const byCat = cat => this._devices.filter(d => d.category === cat).map(device);

        return {
            loaded: this._loaded,
            enabled: on,
            scanning: this._scanning,
            enableSubtitle: on ? _('Channels and shared audio active') : _('Off'),
            audioShort: on ? this._audioShort : _('Off'),
            adapters,
            adapterChoice: multi
                ? [{key: 'auto', title: _('Auto ({hci})', {hci: hw.bestHci}), subtitle: _('The least busy adapter'), active: selected === 'auto'},
                    ...adapters.map(a => ({...a, active: selected === a.key}))]
                : null,
            gamepads: {
                value: String(this._quotaGamepads),
                subtitle: _('Connected: {connected} of {quota} channels', {connected: this._connGamepads, quota: this._quotaGamepads}),
                canMinus: on && this._quotaGamepads > this._connGamepads,
                canPlus: on && !capReached,
            },
            headphones: {
                value: String(this._quotaHeadphones),
                subtitle: _('Connected: {connected} of {quota} channels', {connected: this._connAudio, quota: this._quotaHeadphones}),
                canMinus: on && this._quotaHeadphones > this._connAudio,
                canPlus: on && !capReached,
            },
            freeChannels: {
                value: String(Math.max(0, this._usablePool - allocated)),
                subtitle: _('{assigned}/{pool} assigned · {reserved} used by other devices',
                    {assigned: allocated, pool: this._usablePool, reserved: this._reserved}),
            },
            deviceCount: this._devices.length,
            gamepadList: byCat('gamepad'),
            audioList: byCat('audio'),
            otherList: byCat('system'),
        };
    }

    // One device row: texts, button and, for connected headphones, the mic switch
    _row(dev) {
        const hciTag = dev.knownHcis.length > 1 ? dev.knownHcis.join('/') : dev.hci;
        const status = dev.connected
            ? _('Connected on {hci} (1 channel)', {hci: dev.hci})
            : _('Not connected ({adapters})', {adapters: hciTag});
        const battery = dev.battery ? ` • ${_('battery {pct}', {pct: dev.battery})}` : '';

        let mic = null;
        if (dev.category === 'audio' && dev.connected) {
            const micOn = this._micMacs.has(dev.mac) || dev.isMicActive;
            mic = {
                active: micOn,
                label: micOn ? _('Mic: on (voice)') : _('Mic: off (HD audio)'),
                tooltip: _('Off = headphones kept in high-quality stereo (A2DP)\nOn = turns on the built-in microphone of these Bluetooth headphones (HFP)'),
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
            // BlueHub off: plain Bluetooth, no quotas
            const hasSlot = this._hw.freeChannels > 0 && (!this._enabled ||
                (isGp ? this._connGamepads < this._quotaGamepads : this._connAudio < this._quotaHeadphones));
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
            needsConfirm: dev.connected && dev.category === 'system',
            confirmTitle: _('Disconnect {device}?', {device: dev.name}),
            confirmBody: _("You are about to disconnect '{device}' from adapter {hci}.\nIf it is your main mouse or keyboard you could lose control! Do you want to continue?",
                {device: dev.name, hci: dev.hci}),
        };
    }
}
