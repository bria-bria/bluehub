// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria

// BlueHub shared logic, used by extension.js (Quick Settings button) and by
// prefs.js (panel). Only GLib/Gio, no GTK or GNOME Shell imports, so it can be
// loaded in both processes. All slow operations (pactl, bluetoothctl, D-Bus)
// are asynchronous.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async');
Gio._promisify(Gio.DBusConnection.prototype, 'call');
Gio._promisify(Gio.File.prototype, 'load_contents_async');
Gio._promisify(Gio.File.prototype, 'replace_contents_async');
Gio._promisify(Gio.File.prototype, 'make_directory_async');
Gio._promisify(Gio.File.prototype, 'enumerate_children_async');
Gio._promisify(Gio.FileEnumerator.prototype, 'next_files_async');
Gio._promisify(Gio.FileEnumerator.prototype, 'close_async');

const COMBINED_SINK_NAME = 'bluehub_combined_sink';
const COMBINED_MIC_SINK = 'bluehub_combined_mic_mix';
const COMBINED_MIC_SOURCE = 'bluehub_combined_mic';
// Names used by older versions: still recognised so they can be removed
const OLD_COMBINED_NAMES = ['multy_bt_sink', 'audio_condiviso_scelto'];

export const CHANNELS_PER_ADAPTER = 7;

const CONFIG_FILE = GLib.build_filenamev([GLib.get_home_dir(), '.config', 'bluehub.json']);
const DEFAULT_CONFIG = {enabled: true, preferred_scan_hci: 'auto', mic_enabled_macs: []};

export function logBlueHubError(message) {
    console.error(`[BlueHub] ${message}`);
}

// ------------------------------------------------------------------
// Configuration (~/.config/bluehub.json)
// ------------------------------------------------------------------

// Missing file = defaults; unreadable file or invalid JSON = throw, so that
// updateConfig() never overwrites the user's settings with defaults.
async function readConfigStrict() {
    let contents;
    try {
        [contents] = await Gio.File.new_for_path(CONFIG_FILE).load_contents_async(null);
    } catch (e) {
        if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)) {
            return {...DEFAULT_CONFIG};
        }
        throw e;
    }
    return {...DEFAULT_CONFIG, ...JSON.parse(new TextDecoder().decode(contents))};
}

export async function loadConfig() {
    try {
        return await readConfigStrict();
    } catch (e) {
        logBlueHubError(`Config file ${CONFIG_FILE} not readable, using defaults: ${e}`);
        return {...DEFAULT_CONFIG};
    }
}

async function saveConfig(cfg) {
    const file = Gio.File.new_for_path(CONFIG_FILE);
    const data = new TextEncoder().encode(JSON.stringify(cfg, null, 2));
    // replace_contents writes a temporary file and renames it (atomic)
    const write = () => file.replace_contents_async(data, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    try {
        await write();
    } catch (e) {
        if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)) {
            logBlueHubError(`Cannot save config: ${e}`);
            return;
        }
        // ~/.config is missing: create it and retry
        try {
            await file.get_parent().make_directory_async(GLib.PRIORITY_DEFAULT, null);
            await write();
        } catch (e2) {
            logBlueHubError(`Cannot save config: ${e2}`);
        }
    }
}

// Serialise writes so two quick changes do not overwrite each other
let configWriteQueue = Promise.resolve();

// Re-read the file and change only the given keys, so changes made meanwhile by
// the other process (panel or extension) are kept. An invalid file is never
// overwritten, so the user's settings are not lost.
export function updateConfig(changes) {
    const job = configWriteQueue.then(async () => {
        let cfg;
        try {
            cfg = await readConfigStrict();
        } catch (e) {
            logBlueHubError(`Config file ${CONFIG_FILE} not valid, change not saved (please fix it): ${e}`);
            return {...DEFAULT_CONFIG, ...changes};
        }
        Object.assign(cfg, changes);
        await saveConfig(cfg);
        return cfg;
    });
    // Keep only an empty promise in the queue, not the config object
    configWriteQueue = job.then(() => undefined, () => undefined);
    return job;
}

// ------------------------------------------------------------------
// External commands and D-Bus
// ------------------------------------------------------------------

// Returns stdout, or '' on failure. The command is killed after timeoutMs.
async function runCommand(argv, {cancellable = null, input = null, timeoutMs = 8000} = {}) {
    // Already cancelled (extension disabled, panel closed): start nothing
    if (cancellable?.is_cancelled()) {
        return '';
    }
    let proc;
    try {
        let flags = Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE;
        if (input !== null) {
            flags |= Gio.SubprocessFlags.STDIN_PIPE;
        }
        proc = Gio.Subprocess.new(argv, flags);
    } catch (e) {
        logBlueHubError(`Cannot run ${argv[0]}: ${e}`);
        return '';
    }

    let timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, timeoutMs, () => {
        timerId = 0;
        proc.force_exit();
        return GLib.SOURCE_REMOVE;
    });
    try {
        const [stdout] = await proc.communicate_utf8_async(input, cancellable);
        return (stdout ?? '').trim();
    } catch (e) {
        if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
            proc.force_exit();   // do not leave the command running
        } else {
            logBlueHubError(`Command failed ${argv.join(' ')}: ${e}`);
        }
        return '';
    } finally {
        if (timerId) {
            GLib.source_remove(timerId);
        }
    }
}

function bluezCall(path, iface, method, params = null, {replyType = null, timeoutMs = 5000, cancellable = null} = {}) {
    return Gio.DBus.system.call(
        'org.bluez', path, iface, method, params,
        replyType ? new GLib.VariantType(replyType) : null,
        Gio.DBusCallFlags.NONE, timeoutMs, cancellable);
}

// Resolves after `ms` milliseconds, or earlier if cancellable is cancelled.
function sleep(ms, cancellable = null) {
    return new Promise(resolve => {
        let cancelId = 0;
        const sourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            if (cancelId) {
                cancellable.disconnect(cancelId);
            }
            resolve();
            return GLib.SOURCE_REMOVE;
        });
        if (cancellable) {
            cancelId = cancellable.connect(() => {
                GLib.source_remove(sourceId);
                resolve();
            });
        }
    });
}

// ------------------------------------------------------------------
// Bluetooth adapters (hci0, hci1...) and channels
// ------------------------------------------------------------------

// /sys/class/bluetooth entries (hci0, hci0:1...) with their symlink target,
// which contains "usb" for USB dongles.
async function listSysBluetooth() {
    const entries = new Map();
    try {
        const dir = Gio.File.new_for_path('/sys/class/bluetooth');
        const enumerator = await dir.enumerate_children_async('standard::name,standard::symlink-target',
            Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, GLib.PRIORITY_DEFAULT, null);
        let infos;
        while ((infos = await enumerator.next_files_async(32, GLib.PRIORITY_DEFAULT, null)).length > 0) {
            for (const info of infos) {
                entries.set(info.get_name(), info.get_symlink_target() ?? '');
            }
        }
        await enumerator.close_async(GLib.PRIORITY_DEFAULT, null);
    } catch (_e) {}
    return entries;
}

// Fast channel count for Quick Settings: reads /sys only, no D-Bus.
export async function getHardwareChannelStats() {
    let hosts = 0;
    let links = 0;
    for (const name of (await listSysBluetooth()).keys()) {
        if (/^hci\d+$/.test(name)) {
            hosts++;
        } else if (/^hci\d+:\d+$/.test(name)) {
            links++;
        }
    }
    const totalChannels = Math.max(1, hosts) * CHANNELS_PER_ADAPTER;
    const freeChannels = Math.max(0, totalChannels - links);
    return {totalChannels, activeLinks: links, freeChannels};
}


async function getManagedObjects(cancellable) {
    try {
        const reply = await bluezCall('/', 'org.freedesktop.DBus.ObjectManager', 'GetManagedObjects', null,
            {replyType: '(a{oa{sa{sv}}})', timeoutMs: 3000, cancellable});
        return reply.recursiveUnpack()[0] ?? {};
    } catch (_e) {
        return {};
    }
}

function computeHardwareStats(managed, sysEntries) {
    const entries = [...sysEntries.keys()];
    let hosts = entries.filter(n => /^hci\d+$/.test(n)).sort();
    const linksByHci = {};
    for (const h of hosts) {
        linksByHci[h] = 0;
    }
    for (const n of entries) {
        const m = n.match(/^(hci\d+):\d+$/);
        if (m) {
            linksByHci[m[1]] = (linksByHci[m[1]] ?? 0) + 1;
        }
    }
    if (hosts.length === 0) {
        hosts = ['hci0'];
        linksByHci.hci0 = 0;
    }

    const adapterMeta = {};
    for (const [objPath, ifaces] of Object.entries(managed)) {
        const adp = ifaces['org.bluez.Adapter1'];
        if (adp) {
            const hci = GLib.path_get_basename(objPath);
            adapterMeta[hci] = {
                mac: adp.Address ?? '',
                alias: adp.Alias || adp.Name || hci,
                powered: adp.Powered ?? true,
            };
        }
    }

    const adapters = {};
    let totalChannels = 0;
    let activeLinks = 0;
    hosts.forEach((hci, idx) => {
        const meta = adapterMeta[hci] ?? {};
        const used = linksByHci[hci] ?? 0;
        adapters[hci] = {
            hci,
            mac: meta.mac ?? '',
            alias: meta.alias ?? hci,
            powered: meta.powered ?? true,
            // /sys/class/bluetooth/hciN links to the real device: "usb" means a USB dongle
            busKind: idx > 0 && (sysEntries.get(hci) ?? '').toLowerCase().includes('usb') ? 'USB' : 'Internal',
            activeLinks: used,
            freeChannels: Math.max(0, CHANNELS_PER_ADAPTER - used),
        };
        totalChannels += CHANNELS_PER_ADAPTER;
        activeLinks += used;
    });

    // Best adapter for scanning: most free channels; on a tie, prefer a dongle over hci0
    let bestHci = hosts[0];
    for (const h of hosts) {
        const a = adapters[h];
        const b = adapters[bestHci];
        if (a.freeChannels > b.freeChannels ||
            (a.freeChannels === b.freeChannels && bestHci === 'hci0' && h !== 'hci0')) {
            bestHci = h;
        }
    }

    return {
        controllers: hosts,
        adapters,
        bestHci,
        numControllers: hosts.length,
        totalChannels,
        activeLinks,
        freeChannels: Math.max(0, totalChannels - activeLinks),
    };
}

// ------------------------------------------------------------------
// Bluetooth devices
// ------------------------------------------------------------------

function isUnnamedMac(name) {
    return /^([0-9A-F]{2}[-:]){5}[0-9A-F]{2}$/i.test(name.trim());
}

function classifyDevice(name, iconType) {
    iconType = (iconType || '').toLowerCase();
    const isGamepad = iconType.includes('gaming') || iconType.includes('joy') ||
        /gamepad|controller|joy|xbox|dualsense|dualshock|8bitdo|pro controller/i.test(name);
    const isAudio = iconType.includes('audio') || iconType.includes('headset') || iconType.includes('headphone') ||
        /headphone|headset|earbud|buds|airpods|speaker|jbl|sony|bose|cuffie|marshall|soundcore|nothing ear/i.test(name);
    const isInput = iconType.includes('mouse') || iconType.includes('keyboard') ||
        /mouse|keyboard|tastiera|bk10|mx master|logi|keychron/i.test(name);

    if (isGamepad) {
        return {iconName: 'input-gaming-symbolic', kindLabel: 'Gamepad / Controller', category: 'gamepad'};
    }
    if (isAudio) {
        return {iconName: 'audio-headphones-symbolic', kindLabel: 'Headphones / Speaker', category: 'audio'};
    }
    if (isInput) {
        const keyboard = name.toLowerCase().includes('keyboard') || iconType.includes('keyboard');
        return {
            iconName: keyboard ? 'input-keyboard-symbolic' : 'input-mouse-symbolic',
            kindLabel: 'Mouse / Keyboard (confirmation required to disconnect)',
            category: 'system',
        };
    }
    if (iconType.includes('phone')) {
        return {iconName: 'phone-symbolic', kindLabel: 'Smartphone', category: 'system'};
    }
    return {iconName: 'bluetooth-active-symbolic', kindLabel: 'Bluetooth device', category: 'system'};
}

// Per MAC: PipeWire card profiles (A2DP = HD stereo, HFP = microphone on)
async function getBtCardsProfileMap(cancellable) {
    const out = await runCommand(['pactl', '-f', 'json', 'list', 'cards'], {cancellable});
    const result = {};
    try {
        for (const c of JSON.parse(out || '[]')) {
            const cardName = c.name ?? '';
            if (!cardName.startsWith('bluez_card.')) {
                continue;
            }
            const mac = cardName.replace('bluez_card.', '').replaceAll('_', ':').toUpperCase();
            const activeProfile = c.active_profile ?? '';
            const profNames = c.profiles && typeof c.profiles === 'object' ? Object.keys(c.profiles) : [];

            const a2dp = profNames.filter(p => p.startsWith('a2dp-sink'))
                .sort((x, y) => (x !== 'a2dp-sink') - (y !== 'a2dp-sink') || x.length - y.length);
            // Prefer mSBC (wideband voice) when available
            const hfpRank = p => p.includes('msbc') ? 0 : p === 'headset-head-unit' ? 1 : 2;
            const hfp = profNames.filter(p => p.startsWith('headset-head-unit'))
                .sort((x, y) => hfpRank(x) - hfpRank(y));

            result[mac] = {
                cardName,
                isMicActive: activeProfile.startsWith('headset-head-unit'),
                bestA2dp: a2dp[0] ?? 'a2dp-sink',
                bestHfp: hfp[0] ?? null,
            };
        }
    } catch (_e) {}
    return result;
}

function buildDeviceList(managed, hw, cardMap) {
    const byMac = {};
    for (const [objPath, ifaces] of Object.entries(managed)) {
        const dev = ifaces['org.bluez.Device1'];
        if (!dev) {
            continue;
        }
        const mac = (dev.Address ?? '').toUpperCase();
        if (!mac) {
            continue;
        }
        const name = (dev.Alias || dev.Name || mac).trim();
        const connected = Boolean(dev.Connected);
        const paired = Boolean(dev.Paired);
        if (isUnnamedMac(name) && !connected && !paired) {
            continue;
        }

        const hci = GLib.path_get_basename(dev.Adapter ?? '/org/bluez/hci0');
        const adp = hw.adapters[hci] ?? {mac: '', freeChannels: CHANNELS_PER_ADAPTER};
        const pct = ifaces['org.bluez.Battery1']?.Percentage;
        const card = cardMap[mac] ?? {};

        const entry = {
            mac,
            name,
            connected,
            paired,
            battery: pct !== undefined ? `${pct}%` : null,
            ...classifyDevice(name, dev.Icon),
            hci,
            adapterMac: adp.mac ?? '',
            adapterFree: adp.freeChannels ?? CHANNELS_PER_ADAPTER,
            dbusPath: objPath,
            knownHcis: [hci],
            isMicActive: card.isMicActive ?? false,
        };

        // A device may be known to several adapters: keep the connected one
        // (or, if none is, the one with the most free channels)
        const prev = byMac[mac];
        if (prev) {
            if (!prev.knownHcis.includes(hci)) {
                prev.knownHcis.push(hci);
            }
            if (connected || (!prev.connected && entry.adapterFree > prev.adapterFree)) {
                entry.knownHcis = prev.knownHcis;
                byMac[mac] = entry;
            }
        } else {
            byMac[mac] = entry;
        }
    }
    return Object.values(byMac).sort((a, b) =>
        (b.connected - a.connected) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}

// Full state for the panel: adapters, channels and devices
export async function readBluetoothState(cancellable = null) {
    const [managed, cardMap, sysEntries] = await Promise.all([
        getManagedObjects(cancellable),
        getBtCardsProfileMap(cancellable),
        listSysBluetooth(),
    ]);
    const hw = computeHardwareStats(managed, sysEntries);
    return {hw, devices: buildDeviceList(managed, hw, cardMap)};
}

// D-Bus first; falls back to bluetoothctl if BlueZ does not answer
export async function setDeviceConnected(dev, connect, cancellable = null) {
    try {
        await bluezCall(dev.dbusPath, 'org.bluez.Device1', connect ? 'Connect' : 'Disconnect', null,
            {timeoutMs: 10000, cancellable});
        return true;
    } catch (_e) {
        const cmds = [];
        if (dev.adapterMac) {
            cmds.push(`select ${dev.adapterMac}`);
        }
        cmds.push(`${connect ? 'connect' : 'disconnect'} ${dev.mac}`, 'quit', '');
        await runCommand(['bluetoothctl'], {input: cmds.join('\n'), timeoutMs: 10000, cancellable});
        return false;
    }
}

// Power the adapter on, make it pairable and scan for `seconds` seconds.
// BlueZ stops discovery when the client that started it goes away, so it is
// started over D-Bus from this process (not with "bluetoothctl scan on" + quit).
export async function scanWithAdapter(hci, seconds = 8, cancellable = null) {
    const path = `/org/bluez/${hci}`;
    try {
        for (const prop of ['Powered', 'Pairable']) {
            await bluezCall(path, 'org.freedesktop.DBus.Properties', 'Set',
                new GLib.Variant('(ssv)', ['org.bluez.Adapter1', prop, new GLib.Variant('b', true)]),
                {cancellable});
        }
        await bluezCall(path, 'org.bluez.Adapter1', 'StartDiscovery', null, {cancellable});
    } catch (_e) {
        if (cancellable?.is_cancelled()) {
            return false;   // panel closed: no fallback scan
        }
        // BlueZ did not answer over D-Bus: fall back to bluetoothctl (default adapter)
        await runCommand(['bluetoothctl', '--timeout', String(seconds), 'scan', 'on'],
            {timeoutMs: (seconds + 4) * 1000, cancellable});
        return false;
    }
    await sleep(seconds * 1000, cancellable);
    try {
        await bluezCall(path, 'org.bluez.Adapter1', 'StopDiscovery');
    } catch (_e) {}
    return true;
}

// ------------------------------------------------------------------
// Audio (PipeWire via pactl)
// ------------------------------------------------------------------

function nodeDesc(node) {
    return node.properties?.['device.description'] || node.description || node.name;
}

// Audio sinks/sources, or null if pactl did not answer (error or cancelled).
// null does NOT mean "no outputs", so callers never switch audio by mistake.
async function listNodes(kind, cancellable) {
    const out = await runCommand(['pactl', '-f', 'json', 'list', kind], {cancellable});
    if (!out) {
        return null;
    }
    try {
        return JSON.parse(out);
    } catch (_e) {
        return null;
    }
}

// Output used when no Bluetooth audio is present, set with "fallback_sink" in
// ~/.config/bluehub.json. If unset (or not present on this PC) nothing is
// touched. Returns its description or null.
async function applyFallbackSink(sinks, cancellable) {
    const fallback = (await loadConfig()).fallback_sink;
    const sink = fallback ? sinks.find(s => s.name === fallback) : null;
    if (!sink) {
        return null;
    }
    await runCommand(['pactl', 'set-default-sink', fallback], {cancellable});
    return nodeDesc(sink);
}

// Shared audio: with 2+ BT headphones, create one output that plays on all.
// prevBtSinks = headphones seen at the previous refresh (null = unknown). The
// default output is changed ONLY when the headphones change, so an output the
// user picked by hand is not overridden.
// Returns {count, btSinks, btSinkInfos, fallbackDesc}.
export async function applySharedAudioState(enabled, prevBtSinks, cancellable = null) {
    const [modulesOut, sinks] = await Promise.all([
        runCommand(['pactl', 'list', 'short', 'modules'], {cancellable}),
        listNodes('sinks', cancellable),
    ]);
    if (sinks === null) {
        return {count: 0, btSinks: prevBtSinks, btSinkInfos: [], fallbackDesc: null};
    }

    // Sorted by name so the same headphones always give the same "slaves=" argument
    const btSinkInfos = sinks
        .filter(s => (s.name ?? '').startsWith('bluez_output.'))
        .map(s => ({name: s.name, desc: nodeDesc(s)}))
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const btSinks = btSinkInfos.map(s => s.name);

    const wantCombined = enabled && btSinks.length >= 2;
    const wantedSlaves = `slaves=${btSinks.join(',')}`;

    // Keep an existing BlueHub combine-sink with exactly these headphones (so
    // playback is not interrupted) and remove the others.
    let keepExisting = false;
    let removed = 0;
    for (const line of modulesOut.split('\n')) {
        if (!line.includes('module-combine-sink') ||
            ![COMBINED_SINK_NAME, ...OLD_COMBINED_NAMES].some(n => line.includes(n))) {
            continue;
        }
        const [id, , args = ''] = line.trim().split('\t');
        const argList = args.split(/\s+/);
        if (wantCombined && !keepExisting &&
            argList.includes(`sink_name=${COMBINED_SINK_NAME}`) && argList.includes(wantedSlaves)) {
            keepExisting = true;
            continue;
        }
        if (id) {
            await runCommand(['pactl', 'unload-module', id], {cancellable});
            removed++;
        }
    }

    let fallbackDesc = null;
    if (!enabled) {
        // Restore the fallback output only if BlueHub was running shared audio
        if (removed > 0) {
            fallbackDesc = await applyFallbackSink(sinks, cancellable);
        }
        return {count: 0, btSinks: null, btSinkInfos, fallbackDesc};
    }

    if (wantCombined) {
        if (!keepExisting) {
            await runCommand([
                'pactl', 'load-module', 'module-combine-sink',
                `sink_name=${COMBINED_SINK_NAME}`,
                wantedSlaves,
                'sink_properties=device.description="BlueHub_Shared_Audio"',
            ], {cancellable});
            await runCommand(['pactl', 'set-default-sink', COMBINED_SINK_NAME], {cancellable});
        }
    } else if (btSinks.length === 1) {
        // Switch to the headphones only if they just appeared or shared audio just ended
        if (removed > 0 || (prevBtSinks !== null && !prevBtSinks.includes(btSinks[0]))) {
            await runCommand(['pactl', 'set-default-sink', btSinks[0]], {cancellable});
        }
    } else if (removed > 0 || prevBtSinks?.length > 0) {
        // No headphones: restore the fallback only if they were just disconnected
        fallbackDesc = await applyFallbackSink(sinks, cancellable);
    }
    return {count: btSinks.length, btSinks, btSinkInfos, fallbackDesc};
}

export async function unloadCombinedMics(cancellable = null) {
    const out = await runCommand(['pactl', 'list', 'short', 'modules'], {cancellable});
    // Walk backwards so loopbacks/remap go before the null-sink they use
    for (const line of out.split('\n').reverse()) {
        if (line.includes(COMBINED_MIC_SINK) || line.includes(COMBINED_MIC_SOURCE)) {
            const id = line.trim().split(/\s+/)[0];
            if (id) {
                await runCommand(['pactl', 'unload-module', id], {cancellable});
            }
        }
    }
}

// ------------------------------------------------------------------
// Media players (MPRIS): on a profile switch (mic on/off) many headphones send
// "pause" by themselves, as for a phone call. BlueHub notes which players were
// playing and resumes them if they end up paused after the switch.
// ------------------------------------------------------------------

// Background jobs still running (player resume), cancelled in disable()
const backgroundWork = new Set();

export function cancelBackgroundWork() {
    for (const cancellable of backgroundWork) {
        cancellable.cancel();
    }
    backgroundWork.clear();
}

const MPRIS_PREFIX = 'org.mpris.MediaPlayer2.';
// playerctld proxies the active player: listing it would resume that player twice
const MPRIS_SKIP = new Set(['org.mpris.MediaPlayer2.playerctld']);

async function playbackStatus(name, cancellable) {
    try {
        const reply = await Gio.DBus.session.call(name, '/org/mpris/MediaPlayer2',
            'org.freedesktop.DBus.Properties', 'Get',
            new GLib.Variant('(ss)', ['org.mpris.MediaPlayer2.Player', 'PlaybackStatus']),
            new GLib.VariantType('(v)'), Gio.DBusCallFlags.NONE, 1500, cancellable);
        return reply.recursiveUnpack()[0];
    } catch (_e) {
        return null;
    }
}

async function playingPlayers(cancellable) {
    let names = [];
    try {
        const reply = await Gio.DBus.session.call('org.freedesktop.DBus', '/org/freedesktop/DBus',
            'org.freedesktop.DBus', 'ListNames', null, new GLib.VariantType('(as)'),
            Gio.DBusCallFlags.NONE, 1500, cancellable);
        names = reply.recursiveUnpack()[0].filter(n => n.startsWith(MPRIS_PREFIX) && !MPRIS_SKIP.has(n));
    } catch (_e) {
        return [];
    }
    const playing = [];
    for (const name of names) {
        if (await playbackStatus(name, cancellable) === 'Playing') {
            playing.push(name);
        }
    }
    return playing;
}

// Resume players that were playing and got paused by the headphones.
// Checked after 1.5 and 3 seconds because the pause can arrive late.
async function resumePausedPlayers(players, cancellable) {
    const resumed = new Set();
    for (const wait of [1500, 1500]) {
        await sleep(wait, cancellable);
        if (cancellable?.is_cancelled()) {
            return;
        }
        for (const name of players) {
            if (await playbackStatus(name, cancellable) !== 'Paused') {
                continue;
            }
            try {
                await Gio.DBus.session.call(name, '/org/mpris/MediaPlayer2', 'org.mpris.MediaPlayer2.Player',
                    'Play', null, null, Gio.DBusCallFlags.NONE, 1500, cancellable);
                resumed.add(name);
            } catch (_e) {}
        }
    }
    return resumed.size;
}

// BT headphone microphones: headphones stay in A2DP (HD stereo) by default;
// those in micMacs switch to HFP (mic on). With 2+ BT mics active they are
// joined into one microphone. Returns the active BT mics [{name, desc}]; the
// panel builds the translated status text.
export async function syncBtMicrophones(micMacs, cancellable = null) {
    await unloadCombinedMics(cancellable);

    const cardMap = await getBtCardsProfileMap(cancellable);
    const changes = [];
    for (const [mac, card] of Object.entries(cardMap)) {
        const wantMic = micMacs.has(mac);
        if (wantMic && card.bestHfp && !card.isMicActive) {
            changes.push([card.cardName, card.bestHfp]);
        } else if (!wantMic && card.isMicActive && card.bestA2dp) {
            changes.push([card.cardName, card.bestA2dp]);
        }
    }
    if (changes.length > 0) {
        // Before switching: note what is playing, to resume it if the headphones pause it
        const playing = await playingPlayers(cancellable);
        for (const [cardName, profile] of changes) {
            await runCommand(['pactl', 'set-card-profile', cardName, profile], {cancellable});
        }
        if (playing.length > 0) {
            // Runs in the background even if the panel closes meanwhile;
            // stopped by cancelBackgroundWork() in disable()
            const resumeCancellable = new Gio.Cancellable();
            backgroundWork.add(resumeCancellable);
            resumePausedPlayers(playing, resumeCancellable)
                .catch(e => logBlueHubError(`Resume players: ${e}`))
                .finally(() => backgroundWork.delete(resumeCancellable));
        }
    }

    // Active mics = headphones in voice mode (HFP) after the profile switches.
    // Some headphones ("duplex" codecs, e.g. Nothing Ear) expose an input in HD
    // audio mode too: that does NOT count as a mic that is on.
    const voiceMacs = new Set(Object.entries(changes.length > 0 ? await getBtCardsProfileMap(cancellable) : cardMap)
        .filter(([, card]) => card.isMicActive)
        .map(([mac]) => mac));
    const sourceMac = s => (s.properties?.['api.bluez5.address'] ??
        (s.name ?? '').replace(/^bluez_input\./, '').slice(0, 17).replaceAll('_', ':')).toUpperCase();
    const sources = (await listNodes('sources', cancellable) ?? [])
        .filter(s => (s.name ?? '').startsWith('bluez_input.') && voiceMacs.has(sourceMac(s)))
        .map(s => ({name: s.name, desc: nodeDesc(s)}));

    if (sources.length >= 2) {
        await runCommand(['pactl', 'load-module', 'module-null-sink',
            `sink_name=${COMBINED_MIC_SINK}`,
            'sink_properties=device.description="BlueHub_BT_Mic_Mix"'], {cancellable});
        for (const src of sources) {
            await runCommand(['pactl', 'load-module', 'module-loopback',
                `source=${src.name}`, `sink=${COMBINED_MIC_SINK}`, 'latency_msec=20'], {cancellable});
        }
        await runCommand(['pactl', 'load-module', 'module-remap-source',
            `master=${COMBINED_MIC_SINK}.monitor`,
            `source_name=${COMBINED_MIC_SOURCE}`,
            'source_properties=device.description="BlueHub_Shared_BT_Mics"'], {cancellable});
        await runCommand(['pactl', 'set-default-source', COMBINED_MIC_SOURCE], {cancellable});
    } else if (sources.length === 1) {
        await runCommand(['pactl', 'set-default-source', sources[0].name], {cancellable});
    }
    return sources;
}
