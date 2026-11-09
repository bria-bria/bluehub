// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 bria-bria

// Traduzioni di BlueHub.
// - I testi nel codice sono in inglese (lingua di base).
// - L'italiano è incluso qui sotto (tabella IT).
// - Per tutte le altre lingue l'utente può tradurre da sé il file
//   ~/.config/bluehub/translations/<lingua>.json (es. fr.json, de.json).
//   Il pannello lo crea alla prima apertura e, dopo ogni aggiornamento di
//   BlueHub, AGGIUNGE IN FONDO solo le frasi nuove: le traduzioni già scritte
//   non vengono mai toccate. Le frasi lasciate vuote ("") restano in inglese.
// Le parole tra graffe, es. {hci}, vengono sostituite con i valori reali e
// vanno lasciate così come sono anche nella traduzione.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio._promisify(Gio.File.prototype, 'load_contents_async');
Gio._promisify(Gio.File.prototype, 'replace_contents_async');
Gio._promisify(Gio.File.prototype, 'make_directory_async');

const TRANSLATIONS_DIR = GLib.build_filenamev([GLib.get_user_config_dir(), 'bluehub', 'translations']);

const README_KEY = '_README';
const README_TEXT =
    'BlueHub translation file. Write your translation after each colon, between the quotes. ' +
    'Leave "" to keep the English text. Keep words in braces like {hci} unchanged. ' +
    'New sentences from BlueHub updates are added at the end automatically; ' +
    'your translations are never overwritten. ' +
    'Please share your finished file at https://github.com/bria-bria/bluehub/issues';

// Italiano: è anche l'elenco completo delle frasi (usato per i file degli utenti)
const IT = {
    // --- Menu rapido (extension.js) ---
    'Loading...': 'Lettura...',
    'Off': 'Disattivato',
    'Shared ({count} headphones)': 'Condiviso ({count} cuffie)',
    '{free}/{total} channels free': '{free}/{total} canali liberi',

    // --- Tipi di dispositivo e antenne (bluehub-core.js) ---
    'Gamepad / Controller': 'Gamepad / Controller',
    'Headphones / Speaker': 'Cuffie / Cassa Audio',
    'Mouse / Keyboard (confirmation required to disconnect)': 'Mouse / Tastiera (Conferma richiesta per scollegare)',
    'Smartphone': 'Smartphone',
    'Bluetooth device': 'Dispositivo Bluetooth',
    'Internal': 'Interna',

    // --- Pannello (prefs.js) ---
    '⚙️ BlueHub Extension': '⚙️ Scheda Estensione BlueHub',
    'Refresh adapters, channels and devices': 'Aggiorna antenne, canali e dispositivi',
    'Enable BlueHub': 'Attivazione del programma',
    'Search BT': 'Cerca BT',
    'Start a smart Bluetooth scan for {seconds} seconds': 'Avvia scansione Bluetooth intelligente per {seconds} secondi',
    '📡 Bluetooth Channel Allocation': '📡 Ripartizione Canali Bluetooth',
    '🎮 Gamepads': '🎮 Gamepad',
    '🎧 Headphones / Speakers': '🎧 Cuffie / Casse',
    'Gamepads connected: {connected} / {quota}': 'Connessi ora: {connected} / {quota}',
    'Headphones connected: {connected} / {quota}': 'Connesse ora: {connected} / {quota}',
    'Adapter detected: {hci} (Internal • {used}/{total} used, {free} free)': 'Antenna rilevata: {hci} (Interna • {used}/{total} usati, {free} liberi)',
    'Multi-adapter ready: plug in a USB Bluetooth dongle (hci1) to get {channels} channels with automatic distribution.':
        'Multi-Antenna pronto: se inserisci una chiavetta BT USB (hci1) avrai {channels} canali con smistamento automatico.',
    '{hci} ({bus}): {used}/{total} used': '{hci} ({bus}): {used}/{total} usati',
    'Multi-adapter active ({count} adapters = {channels} channels): {list}': 'Multi-Antenna Attivo ({count} ricevitori = {channels} canali): {list}',
    "Scan and pairing ('Search BT'): Auto picks the least busy adapter ({hci})": "Scansione e accoppiamento ('Cerca BT'): Auto sceglie l'antenna più libera ({hci})",
    'Auto ({hci})': 'Auto ({hci})',
    'Adapter for new pairings: {adapter}': 'Antenna per nuovi accoppiamenti: {adapter}',
    'Automatic (least busy)': 'Automatica (la più scarica)',
    '🟢 On': '🟢 Attivo',
    '⚪ Off': '⚪ Disattivato',
    '🟢 BlueHub on — channel management and shared audio running': '🟢 Estensione attiva — Gestione canali e audio condiviso in funzione',
    "⚪ BlueHub off — press 'Off' to turn it back on": "⚪ Estensione disattivata — Premi 'Disattivato' per riattivarla",
    'BlueHub on': 'BlueHub Attivo',
    'BlueHub off': 'BlueHub Disattivato',
    '🔒 All {pool} available channels are assigned ({gamepads} gamepads + {headphones} headphones)':
        '🔒 Tutti i {pool} canali disponibili sono assegnati ({gamepads} Gamepad + {headphones} Cuffie)',
    'No channels left. To move a channel to the other box, first press [ − ] on the one that has it.':
        "Zero canali rimasti. Per spostare un canale sull'altro riquadro, premi prima [ − ] su quello che ha i canali.",
    '🟢 You still have 1 channel to assign ({assigned}/{pool} assigned)': '🟢 Hai ancora 1 canale disponibile da assegnare ({assigned}/{pool} assegnati)',
    '🟢 You still have {free} channels to assign ({assigned}/{pool} assigned)': '🟢 Hai ancora {free} canali disponibili da assegnare ({assigned}/{pool} assegnati)',
    'You can put them all on gamepads, all on headphones, or split them as you like.':
        'Puoi metterli tutti su Gamepad, tutti su Cuffie, o dividerli come preferisci.',
    '1 adapter': '1 antenna',
    '{count} adapters': '{count} antenne',
    '{total} total channels ({adapters}) − {reserved} already in use = {pool} free channels to assign':
        '{total} Canali Totali ({adapters}) − {reserved} già occupati = {pool} canali liberi da assegnare',
    '{total} total channels − {reserved} used by peripherals{devices} = {pool} available channels':
        '{total} Canali Totali − {reserved} occupati da periferiche{devices} = {pool} Canali Disponibili',
    'No channel is reserved in advance: you can assign all available channels as you like.':
        'Nessun canale è riservato in anticipo: puoi assegnare tutti i canali disponibili come vuoi.',
    '⚪ BlueHub off — shared audio stopped': '⚪ BlueHub Disattivato — Condivisione audio spenta',
    '🎶 AUTOMATIC shared listening on {count} headphones ({names}){mic}': '🎶 Ascolto Condiviso AUTOMATICO su {count} cuffie ({names}){mic}',
    '🎧 Audio on: {name}{mic}': '🎧 Audio su: {name}{mic}',
    '🔊 No Bluetooth headphones connected — audio on: {name}': '🔊 Nessuna cuffia BT connessa — Audio attivo su: {name}',
    '🔊 No Bluetooth headphones connected — audio on the output chosen in the system':
        "🔊 Nessuna cuffia BT connessa — Audio sull'uscita scelta nel sistema",
    ' • 🎙️ {count} Bluetooth mics joined ({names})': ' • 🎙️ {count} Microfoni BT uniti ({names})',
    ' • 🎙️ Bluetooth mic on: {name}': ' • 🎙️ Mic BT attivo: {name}',
    ' • 🔒 Headphones kept in HD stereo (Bluetooth mics off)': ' • 🔒 Cuffie protette in Stereo HD (Mic BT spenti)',
    '🎮 Bluetooth gamepads (connected: {connected} / channels assigned: {quota})': '🎮 Gamepad Bluetooth (Connessi: {connected} / Canali assegnati: {quota})',
    '0 channels assigned to gamepads: press [ + ] in the Gamepads box to allow connections.':
        '0 canali assegnati ai Gamepad: premi [ + ] nel riquadro Gamepad per abilitare la connessione.',
    'Free gamepad slots: {free} of {quota} assigned.': 'Slot Gamepad liberi: {free} su {quota} assegnati.',
    'No Bluetooth gamepads known': 'Nessun Gamepad Bluetooth in memoria',
    "Put the controller in pairing mode and press 'Search BT' above.": "Accendi il controller in modalità pairing e premi 'Cerca BT' in alto.",
    '🎧 Bluetooth headphones and speakers (connected: {connected} / channels assigned: {quota})':
        '🎧 Cuffie e Casse Bluetooth (Connesse: {connected} / Canali assegnati: {quota})',
    'No Bluetooth headphones or speakers known': 'Nessuna cuffia o cassa Bluetooth in memoria',
    "Use 'Search BT' above to look for new devices.": "Usa 'Cerca BT' in alto per cercare nuovi dispositivi.",
    '⌨️ Mouse, keyboard and other devices ({count} connected)': '⌨️ Mouse, Tastiera e Altri Dispositivi ({count} connessi)',
    "Protected from accidental disconnection: pressing 'Disconnect' asks for confirmation.":
        "Protetti da disconnessione accidentale: se premi 'Disconnetti' ti verrà chiesta conferma.",
    '🟢 Connected on {hci} (1 channel)': '🟢 Connesso su {hci} (1 canale)',
    '⚪ Not connected ({adapters})': '⚪ Non connesso ({adapters})',
    '🎙️ Mic: ON (voice)': '🎙️ Mic: ON (Voce)',
    '🎙️ Mic: OFF (HD audio)': '🎙️ Mic: OFF (Audio HD)',
    'OFF = headphones kept in high-quality stereo (A2DP)\nON = turns on the built-in microphone of these Bluetooth headphones (HFP)':
        'OFF = Cuffia bloccata in Alta Qualità Stereo (A2DP)\nON = Attiva il microfono integrato di questa cuffia Bluetooth (HFP)',
    'Disconnect': 'Disconnetti',
    'Adapter {hci} full ({total}/{total})': 'Antenna {hci} piena ({total}/{total})',
    'Connect': 'Connetti',
    'Locked (give +1 to Gamepads)': 'Bloccato (Dai +1 a Gamepad)',
    'Locked (give +1 to Headphones)': 'Bloccato (Dai +1 a Cuffie)',
    'Channels full': 'Canali pieni',
    '{device}: Bluetooth microphone on': '{device}: Microfono BT attivato',
    '{device}: HD stereo audio restored (mic off)': '{device}: Audio Stereo HD ripristinato (Mic spento)',
    'Disconnect {device}?': 'Scollegare {device}?',
    "You are about to disconnect '{device}' from adapter {hci}.\nIf it is your main mouse or keyboard you could lose control! Do you want to continue?":
        "Stai per disconnettere '{device}' dall'antenna {hci}.\nSe è il tuo mouse o la tua tastiera principale potresti rimanere senza controlli! Sei sicuro di voler procedere?",
    'Cancel': 'Annulla',
    'Yes, disconnect': 'Sì, disconnetti',
    'Please wait...': 'Attendere...',
    'Disconnecting {device} (adapter {hci})...': 'Disconnessione da {device} (antenna {hci})...',
    'Connecting {device} (adapter {hci})...': 'Connessione a {device} (antenna {hci})...',
    'Searching...': 'Ricerca...',
    'Multi-adapter scan on {hci} ({free}/{total} free channels) for {seconds}s...': 'Scansione Multi-Antenna su {hci} ({free}/{total} canali liberi) per {seconds}s...',
    'Bluetooth scan running for {seconds} seconds...': 'Scansione Bluetooth attiva per {seconds} secondi...',
    'Scan finished on {hci}!': 'Scansione completata su {hci}!',

    // --- Pannello dentro Smart Calendar Hub (bluehub-hub-kit.js): frasi brevi ---
    ' · {count} microphones joined': ' · {count} microfoni uniti',
    ' · microphone on': ' · microfono attivo',
    'On {count} headphones: {names}': 'Su {count} cuffie: {names}',
    'On {name}': 'Su {name}',
    'No Bluetooth headphones · audio on {name}': 'Nessuna cuffia BT · audio su {name}',
    'No Bluetooth headphones': 'Nessuna cuffia BT',
    '{hci} · {bus}': '{hci} · {bus}',
    '{used}/{total} channels used · {free} free': '{used}/{total} canali usati · {free} liberi',
    'Connected on {hci}': 'Connesso su {hci}',
    'Not connected': 'Non connesso',
    'Full': 'Piena',
    'Adapter {hci} full': 'Antenna {hci} piena',
    'Locked': 'Bloccato',
    'Give +1 to Gamepads to connect': 'Dai +1 ai Gamepad per connettere',
    'Give +1 to Headphones to connect': 'Dai +1 alle Cuffie per connettere',
    'Microphone of {device}': 'Microfono di {device}',
    'On: voice (HFP)': 'Attivo: voce (HFP)',
    'Off: HD audio (A2DP)': 'Spento: audio HD (A2DP)',
    'You could lose your mouse or keyboard': 'Potresti rimanere senza mouse o tastiera',
    'Channels and shared audio active': 'Canali e audio condiviso attivi',
    'The least busy adapter': "L'antenna più libera",
    'Connected: {connected} of {quota} channels': 'Connessi: {connected} su {quota} canali',
    '{assigned}/{pool} assigned · {reserved} used by other devices': '{assigned}/{pool} assegnati · {reserved} usati da altri dispositivi',
    'Adapters': 'Antenne',
    'Adapter for new pairings': 'Antenna per nuovi accoppiamenti',
    'Channels': 'Canali',
    'Gamepads': 'Gamepad',
    'Headphones and speakers': 'Cuffie e casse',
    'Free channels': 'Canali liberi',
    'Shared audio': 'Audio condiviso',
    'Refresh': 'Aggiorna',
    'Bluetooth devices': 'Dispositivi Bluetooth',
    'Other devices': 'Altri dispositivi',
    'No other Bluetooth devices': 'Nessun altro dispositivo Bluetooth',
};

// Traduzioni lette dal file dell'utente (lingue diverse da it/en); null = nessuna
let userTable = null;
// Lingua del sistema, calcolata alla prima traduzione (azzerata in unload)
let cachedLanguage = null;

// Codice della lingua del sistema, es. 'it', 'en', 'fr'
function systemLanguage() {
    for (const name of GLib.get_language_names()) {
        if (name !== 'C' && name !== 'POSIX') {
            return name.split(/[_.@]/)[0].toLowerCase();
        }
    }
    return 'en';
}

// Traduce una frase inglese e sostituisce i segnaposto {nome} con params.nome
export function _(text, params = {}) {
    cachedLanguage ??= systemLanguage();
    const lang = cachedLanguage;
    let s = null;
    if (lang === 'it') {
        s = IT[text];
    } else if (lang !== 'en') {
        s = userTable?.[text];
    }
    if (typeof s !== 'string' || s === '') {
        s = text;
    }
    return s.replace(/\{(\w+)\}/g, (match, key) => (key in params ? String(params[key]) : match));
}

async function ensureDir(path) {
    const dir = Gio.File.new_for_path(path);
    try {
        await dir.make_directory_async(GLib.PRIORITY_DEFAULT, null);
    } catch (e) {
        if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS)) {
            return;
        }
        if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)) {
            throw e;
        }
        await ensureDir(GLib.path_get_dirname(path));   // crea prima la cartella superiore
        await dir.make_directory_async(GLib.PRIORITY_DEFAULT, null);
    }
}

// Carica il file di traduzione dell'utente per la lingua del sistema.
// Con merge=true (usato dal pannello) crea il file se manca e aggiunge in fondo
// le frasi nuove, senza mai modificare quelle già presenti.
// Se il file contiene un errore non lo tocca e usa l'inglese.
// Restituisce il percorso del file, oppure null per italiano/inglese.
export async function loadUserTranslations({merge = false} = {}) {
    const lang = systemLanguage();
    if (lang === 'it' || lang === 'en') {
        userTable = null;
        return null;
    }
    const path = GLib.build_filenamev([TRANSLATIONS_DIR, `${lang}.json`]);
    const file = Gio.File.new_for_path(path);

    let existing = null;
    try {
        const [contents] = await file.load_contents_async(null);
        existing = JSON.parse(new TextDecoder().decode(contents));
        if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
            throw new Error('the file must contain a JSON object { "English": "translation" }');
        }
    } catch (e) {
        if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)) {
            console.error(`[BlueHub] Translation file ${path} not valid, using English (file left untouched): ${e}`);
            userTable = null;
            return path;
        }
    }

    if (merge) {
        const missing = Object.keys(IT).filter(k => !(existing && k in existing));
        if (existing === null || missing.length > 0) {
            const updated = existing ?? {[README_KEY]: README_TEXT};
            for (const key of missing) {
                updated[key] = '';   // in fondo, da tradurre
            }
            try {
                await ensureDir(TRANSLATIONS_DIR);
                const data = new TextEncoder().encode(`${JSON.stringify(updated, null, 2)}\n`);
                await file.replace_contents_async(data, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
                existing = updated;
            } catch (e) {
                console.error(`[BlueHub] Cannot write translation file ${path}: ${e}`);
            }
        }
    }

    userTable = {};
    for (const [key, value] of Object.entries(existing ?? {})) {
        if (key !== README_KEY && typeof value === 'string' && value !== '') {
            userTable[key] = value;
        }
    }
    return path;
}

// Da chiamare in disable(): libera le traduzioni caricate
export function unloadUserTranslations() {
    userTable = null;
    cachedLanguage = null;
}
