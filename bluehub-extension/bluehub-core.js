// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria

// Logica comune di BlueHub, usata sia da extension.js (pulsante nel menu rapido)
// sia da prefs.js (pannello di controllo). Usa solo GLib/Gio: niente GTK né
// GNOME Shell, così può essere importato in entrambi i processi.
// Tutte le operazioni lente (pactl, bluetoothctl, D-Bus) sono asincrone.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async');
Gio._promisify(Gio.DBusConnection.prototype, 'call');
Gio._promisify(Gio.File.prototype, 'load_contents_async');
Gio._promisify(Gio.File.prototype, 'replace_contents_async');
Gio._promisify(Gio.File.prototype, 'make_directory_async');

export const COMBINED_SINK_NAME = 'bluehub_combined_sink';
const COMBINED_MIC_SINK = 'bluehub_combined_mic_mix';
const COMBINED_MIC_SOURCE = 'bluehub_combined_mic';
// Nomi usati dalle versioni precedenti: vengono comunque riconosciuti e rimossi
const OLD_COMBINED_NAMES = ['multy_bt_sink', 'audio_condiviso_scelto'];

export const CHANNELS_PER_ADAPTER = 7;

const CONFIG_FILE = GLib.build_filenamev([GLib.get_home_dir(), '.config', 'bluehub.json']);
const DEFAULT_CONFIG = {enabled: true, preferred_scan_hci: 'auto', mic_enabled_macs: []};

// Unico punto in cui BlueHub scrive errori nel log di sistema
export function logBlueHubError(message) {
    console.error(`[BlueHub] ${message}`);
}

// ------------------------------------------------------------------
// Configurazione (~/.config/bluehub.json)
// ------------------------------------------------------------------

// Lettura e scrittura sono asincrone: GNOME Shell non resta mai fermo ad aspettare il disco.
// Legge il file. File mancante = valori predefiniti; file illeggibile o JSON non
// valido = errore (così chi salva non lo sovrascrive cancellando le impostazioni).
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
        logBlueHubError(`Configurazione non leggibile (${CONFIG_FILE}), uso i valori predefiniti: ${e}`);
        return {...DEFAULT_CONFIG};
    }
}

async function saveConfig(cfg) {
    const file = Gio.File.new_for_path(CONFIG_FILE);
    const data = new TextEncoder().encode(JSON.stringify(cfg, null, 2));
    // replace_contents scrive su un file temporaneo e poi lo sostituisce (atomico)
    const write = () => file.replace_contents_async(data, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    try {
        await write();
    } catch (e) {
        if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)) {
            logBlueHubError(`Errore salvataggio config: ${e}`);
            return;
        }
        // Manca la cartella ~/.config: la crea e riprova
        try {
            await file.get_parent().make_directory_async(GLib.PRIORITY_DEFAULT, null);
            await write();
        } catch (e2) {
            logBlueHubError(`Errore salvataggio config: ${e2}`);
        }
    }
}

// Accoda le scritture: due modifiche ravvicinate non si sovrascrivono a vicenda
let configWriteQueue = Promise.resolve();

// Rilegge il file, cambia solo le chiavi indicate e salva: non cancella le
// modifiche fatte nel frattempo dall'altro processo (pannello o estensione).
// Se il file esiste ma non è valido NON lo sovrascrive (non perde le impostazioni).
export function updateConfig(changes) {
    const job = configWriteQueue.then(async () => {
        let cfg;
        try {
            cfg = await readConfigStrict();
        } catch (e) {
            logBlueHubError(`Configurazione non valida, modifica non salvata (correggi ${CONFIG_FILE}): ${e}`);
            return {...DEFAULT_CONFIG, ...changes};
        }
        Object.assign(cfg, changes);
        await saveConfig(cfg);
        return cfg;
    });
    // La coda non trattiene la configurazione: resta solo una promessa vuota
    configWriteQueue = job.then(() => undefined, () => undefined);
    return job;
}

// ------------------------------------------------------------------
// Comandi esterni e D-Bus
// ------------------------------------------------------------------

// Esegue un comando senza bloccare: restituisce lo stdout (o '' se fallisce).
// Dopo timeoutMs il comando viene terminato.
export async function runCommand(argv, {cancellable = null, input = null, timeoutMs = 8000} = {}) {
    // Già annullato (estensione disattivata, pannello chiuso): non avvia nulla
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
        logBlueHubError(`Impossibile eseguire ${argv[0]}: ${e}`);
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
            proc.force_exit();   // annullato: non lascia il comando in esecuzione
        } else {
            logBlueHubError(`Errore comando ${argv.join(' ')}: ${e}`);
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

// Attende `ms` millisecondi; termina prima se cancellable viene annullato.
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
// Antenne Bluetooth (hci0, hci1...) e canali
// ------------------------------------------------------------------

function listSysBluetooth() {
    const names = [];
    try {
        const dir = Gio.File.new_for_path('/sys/class/bluetooth');
        const enumerator = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = enumerator.next_file(null)) !== null) {
            names.push(info.get_name());
        }
        enumerator.close(null);
    } catch (_e) {}
    return names;
}

// Conteggio veloce dei canali (per il menu rapido): legge solo /sys.
export function getHardwareChannelStats() {
    let hosts = 0;
    let links = 0;
    for (const name of listSysBluetooth()) {
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

function detectBusType(hci) {
    try {
        // /sys/class/bluetooth/hciN è un collegamento verso il dispositivo reale
        const target = GLib.file_read_link(`/sys/class/bluetooth/${hci}`);
        if (target.toLowerCase().includes('usb')) {
            return 'USB';
        }
    } catch (_e) {}
    return 'Interna';
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

function computeHardwareStats(managed) {
    const entries = listSysBluetooth();
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
            busKind: idx > 0 ? detectBusType(hci) : 'Interna',
            activeLinks: used,
            freeChannels: Math.max(0, CHANNELS_PER_ADAPTER - used),
        };
        totalChannels += CHANNELS_PER_ADAPTER;
        activeLinks += used;
    });

    // Antenna migliore per cercare: quella con più canali liberi (a parità, non hci0)
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
// Dispositivi Bluetooth
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
        return {iconName: 'audio-headphones-symbolic', kindLabel: 'Cuffie / Cassa Audio', category: 'audio'};
    }
    if (isInput) {
        const keyboard = name.toLowerCase().includes('keyboard') || iconType.includes('keyboard');
        return {
            iconName: keyboard ? 'input-keyboard-symbolic' : 'input-mouse-symbolic',
            kindLabel: 'Mouse / Tastiera (Conferma richiesta per scollegare)',
            category: 'system',
        };
    }
    if (iconType.includes('phone')) {
        return {iconName: 'phone-symbolic', kindLabel: 'Smartphone', category: 'system'};
    }
    return {iconName: 'bluetooth-active-symbolic', kindLabel: 'Dispositivo Bluetooth', category: 'system'};
}

// Per ogni MAC: profili PipeWire (A2DP = stereo HD, HFP = microfono attivo)
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
            // Preferisce mSBC (voce wideband) se presente
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

        // Lo stesso dispositivo può essere noto a più antenne: tiene quella connessa
        // (o, se nessuna lo è, quella con più canali liberi)
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

// Stato completo per il pannello: antenne, canali e dispositivi
export async function readBluetoothState(cancellable = null) {
    const [managed, cardMap] = await Promise.all([
        getManagedObjects(cancellable),
        getBtCardsProfileMap(cancellable),
    ]);
    const hw = computeHardwareStats(managed);
    return {hw, devices: buildDeviceList(managed, hw, cardMap)};
}

// Connette o disconnette un dispositivo (D-Bus; se fallisce, bluetoothctl)
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

// Accende l'antenna, la rende accoppiabile e cerca dispositivi per `seconds` secondi.
// La ricerca di BlueZ resta attiva solo finché è vivo chi l'ha avviata: per questo
// la si avvia via D-Bus da questo processo (non con "bluetoothctl scan on" + quit).
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
            return false;   // pannello chiuso: nessuna ricerca di riserva
        }
        // BlueZ non risponde via D-Bus: riserva con bluetoothctl (antenna predefinita)
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

// Elenco uscite/ingressi audio, oppure null se pactl non ha risposto (errore o
// annullamento): null NON significa "nessuna uscita", così non si cambia l'audio a caso.
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

// Uscita audio da usare quando non c'è audio Bluetooth. Si sceglie con
// "fallback_sink" in ~/.config/bluehub.json; se non è impostata (o non esiste
// su questo PC) BlueHub non tocca nulla. Restituisce la descrizione o null.
async function applyFallbackSink(sinks, cancellable) {
    const fallback = (await loadConfig()).fallback_sink;
    const sink = fallback ? sinks.find(s => s.name === fallback) : null;
    if (!sink) {
        return null;
    }
    await runCommand(['pactl', 'set-default-sink', fallback], {cancellable});
    return nodeDesc(sink);
}

// Audio condiviso: con 2+ cuffie BT crea un'uscita unica che suona su tutte.
// prevBtSinks = cuffie viste all'aggiornamento precedente (null = non note):
// l'uscita predefinita si cambia SOLO quando le cuffie cambiano, così non si
// sovrascrive l'uscita scelta a mano dall'utente.
// Restituisce {count, btSinks, btSinkInfos, fallbackDesc}.
export async function applySharedAudioState(enabled, prevBtSinks, cancellable = null) {
    const [modulesOut, sinks] = await Promise.all([
        runCommand(['pactl', 'list', 'short', 'modules'], {cancellable}),
        listNodes('sinks', cancellable),
    ]);
    if (sinks === null) {
        return {count: 0, btSinks: prevBtSinks, btSinkInfos: [], fallbackDesc: null};
    }

    // Ordinate per nome: la stessa coppia di cuffie dà sempre la stessa riga "slaves="
    const btSinkInfos = sinks
        .filter(s => (s.name ?? '').startsWith('bluez_output.'))
        .map(s => ({name: s.name, desc: nodeDesc(s)}))
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const btSinks = btSinkInfos.map(s => s.name);

    const wantCombined = enabled && btSinks.length >= 2;
    const wantedSlaves = `slaves=${btSinks.join(',')}`;

    // Combine-sink di BlueHub già presenti: se uno ha già esattamente queste
    // cuffie lo tiene (la musica non si interrompe), gli altri li rimuove.
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
        // Riporta l'audio sull'uscita di riserva solo se BlueHub stava usando l'audio condiviso
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
                'sink_properties=device.description="BlueHub_Audio_Condiviso_Automatico"',
            ], {cancellable});
            await runCommand(['pactl', 'set-default-sink', COMBINED_SINK_NAME], {cancellable});
        }
    } else if (btSinks.length === 1) {
        // Passa alla cuffia solo se è appena arrivata o se finiva l'audio condiviso
        if (removed > 0 || (prevBtSinks !== null && !prevBtSinks.includes(btSinks[0]))) {
            await runCommand(['pactl', 'set-default-sink', btSinks[0]], {cancellable});
        }
    } else if (removed > 0 || prevBtSinks?.length > 0) {
        // Nessuna cuffia: torna all'uscita di riserva solo se le cuffie si sono appena scollegate
        fallbackDesc = await applyFallbackSink(sinks, cancellable);
    }
    return {count: btSinks.length, btSinks, btSinkInfos, fallbackDesc};
}

// Rimuove il mix dei microfoni BT creato da BlueHub
export async function unloadCombinedMics(cancellable = null) {
    const out = await runCommand(['pactl', 'list', 'short', 'modules'], {cancellable});
    // Prima i loopback/remap, poi il null-sink: si scorre al contrario
    for (const line of out.split('\n').reverse()) {
        if (line.includes(COMBINED_MIC_SINK) || line.includes(COMBINED_MIC_SOURCE)) {
            const id = line.trim().split(/\s+/)[0];
            if (id) {
                await runCommand(['pactl', 'unload-module', id], {cancellable});
            }
        }
    }
}

// Microfoni delle cuffie BT: di default le cuffie restano in A2DP (stereo HD);
// quelle indicate in micMacs passano in HFP (microfono attivo). Con 2+ microfoni
// BT attivi li unisce in un unico microfono. Restituisce il testo di stato.
export async function syncBtMicrophones(micMacs, cancellable = null) {
    await unloadCombinedMics(cancellable);

    const cardMap = await getBtCardsProfileMap(cancellable);
    for (const [mac, card] of Object.entries(cardMap)) {
        const wantMic = micMacs.has(mac);
        if (wantMic && card.bestHfp && !card.isMicActive) {
            await runCommand(['pactl', 'set-card-profile', card.cardName, card.bestHfp], {cancellable});
        } else if (!wantMic && card.isMicActive && card.bestA2dp) {
            await runCommand(['pactl', 'set-card-profile', card.cardName, card.bestA2dp], {cancellable});
        }
    }

    const sources = (await listNodes('sources', cancellable) ?? [])
        .filter(s => (s.name ?? '').startsWith('bluez_input.'))
        .map(s => ({name: s.name, desc: nodeDesc(s)}));

    if (sources.length >= 2) {
        await runCommand(['pactl', 'load-module', 'module-null-sink',
            `sink_name=${COMBINED_MIC_SINK}`,
            'sink_properties=device.description="BlueHub_Mix_Microfoni_BT"'], {cancellable});
        for (const src of sources) {
            await runCommand(['pactl', 'load-module', 'module-loopback',
                `source=${src.name}`, `sink=${COMBINED_MIC_SINK}`, 'latency_msec=20'], {cancellable});
        }
        await runCommand(['pactl', 'load-module', 'module-remap-source',
            `master=${COMBINED_MIC_SINK}.monitor`,
            `source_name=${COMBINED_MIC_SOURCE}`,
            'source_properties=device.description="BlueHub_Microfoni_BT_Condivisi"'], {cancellable});
        await runCommand(['pactl', 'set-default-source', COMBINED_MIC_SOURCE], {cancellable});
        return ` • 🎙️ ${sources.length} Microfoni BT uniti (${sources.map(s => s.desc).join(', ')})`;
    }
    if (sources.length === 1) {
        await runCommand(['pactl', 'set-default-source', sources[0].name], {cancellable});
        return ` • 🎙️ Mic BT attivo: ${sources[0].desc}`;
    }
    return ' • 🔒 Cuffie protette in Stereo HD (Mic BT spenti)';
}
