#!/usr/bin/env python3
# ============================================================
#  BlueHub — Centro di Controllo Connessioni Multiple Bluetooth
#  - Gestione Multi-Antenna Intelligente (hci0, hci1, hci2...):
#    * Rileva tutte le antenne Bluetooth collegate (Interna + USB)
#    * Calcola i 7 canali hardware indipendenti per OGNI antenna
#    * Smista connessioni e ricerca (Cerca BT) selezionando
#      automaticamente l'antenna registrata o quella più scarica
#  - Gestione Microfoni Cuffie BT (🎙️ Mic: OFF Audio HD / 🎙️ Mic: ON):
#    * Di default protegge le cuffie in modalità Stereo Alta Qualità (A2DP)
#    * Con 1 clic su "🎙️ Mic" attiva il microfono della cuffia scelta (HFP)
#    * Se attivi "🎙️ Mic: ON" su 2+ cuffie, unisce automaticamente anche
#      i loro microfoni BT! (Il microfono interno del PC non appare mai in lista)
#  - Scheda Estensione in alto con "Attivazione del programma" e
#    a fianco i due pulsanti compatti dello stesso stile:
#    [ Cerca BT ] e [ 🟢 Attivo / ⚪ Disattivato ]
#  - Riquadri Gamepad e Cuffie partono da 0 (o dai già connessi)
#  - Nessun canale riservato forzatamente: puoi dare anche TUTTI i
#    canali disponibili a Gamepad (lasciando Cuffie a 0) o viceversa!
#  - Conferma di sicurezza prima di scollegare Mouse o Tastiera
#  - Audio Condiviso AUTOMATICO appena ci sono 2+ Cuffie/Casse BT connesse
# ============================================================
import glob
import json
import os
import re
import subprocess
import sys
import threading
import gi

gi.require_version('Gtk', '4.0')
gi.require_version('Adw', '1')
from gi.repository import Gtk, Adw, GLib, Gio

COMBINED_SINK_NAME = 'bluehub_combined_sink'
COMBINED_MIC_SINK = 'bluehub_combined_mic_mix'
COMBINED_MIC_SOURCE = 'bluehub_combined_mic'
CONFIG_FILE = os.path.expanduser('~/.config/bluehub.json')


def load_config():
    try:
        with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {'enabled': True, 'preferred_scan_hci': 'auto', 'mic_enabled_macs': []}


def save_config(cfg):
    try:
        os.makedirs(os.path.dirname(CONFIG_FILE), exist_ok=True)
        with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
            json.dump(cfg, f, indent=2)
    except Exception:
        pass


def run_cmd(args, input_text=None, timeout=8):
    try:
        res = subprocess.run(
            args,
            input=input_text,
            capture_output=True,
            text=True,
            check=False,
            timeout=timeout,
        )
        return res.stdout.strip()
    except Exception:
        return ''


def run_btctl_commands(commands, timeout=10):
    """Esegue una sequenza di comandi in bluetoothctl (es. select <adapter_mac> + connect <dev_mac>)."""
    script = '\n'.join(commands + ['quit', ''])
    return run_cmd(['bluetoothctl'], input_text=script, timeout=timeout)


def _get_bluez_managed_objects():
    """Legge l'albero completo di BlueZ via D-Bus (tutte le antenne hci0, hci1... e tutti i dispositivi)."""
    try:
        bus = Gio.bus_get_sync(Gio.BusType.SYSTEM, None)
        res = bus.call_sync(
            'org.bluez',
            '/',
            'org.freedesktop.DBus.ObjectManager',
            'GetManagedObjects',
            None,
            GLib.VariantType.new('(a{oa{sa{sv}}})'),
            Gio.DBusCallFlags.NONE,
            3000,
            None,
        )
        unpacked = res.unpack()
        return unpacked[0] if unpacked else {}
    except Exception:
        return {}


def _detect_bus_type(hci_name):
    """Riconosce se un'antenna (hci0, hci1...) è Interna o USB."""
    try:
        dev_link = os.path.realpath(f'/sys/class/bluetooth/{hci_name}/device')
        if 'usb' in dev_link.lower():
            return 'USB'
    except Exception:
        pass
    return 'Interna'


def get_radio_hardware_stats():
    """Rileva tutte le antenne Bluetooth (hci0, hci1...) e conta i 7 canali fisici per ciascuna antenna."""
    entries = glob.glob('/sys/class/bluetooth/hci*')
    hosts = []
    links_by_hci = {}

    for path in entries:
        base = os.path.basename(path)
        if re.match(r'^hci\d+$', base):
            hosts.append(base)
            links_by_hci.setdefault(base, 0)
        elif re.match(r'^(hci\d+):\d+$', base):
            m = re.match(r'^(hci\d+):\d+$', base)
            if m:
                h = m.group(1)
                links_by_hci[h] = links_by_hci.get(h, 0) + 1

    hosts.sort()
    if not hosts:
        hosts = ['hci0']
        links_by_hci['hci0'] = 0

    managed = _get_bluez_managed_objects()
    adapter_meta = {}
    for obj_path, ifaces in managed.items():
        adp = ifaces.get('org.bluez.Adapter1')
        if adp:
            hci_id = os.path.basename(obj_path)
            adapter_meta[hci_id] = {
                'mac': adp.get('Address', ''),
                'alias': adp.get('Alias') or adp.get('Name') or hci_id,
                'powered': bool(adp.get('Powered', True)),
            }

    adapters = {}
    total_channels = 0
    active_links = 0

    for idx, hci in enumerate(hosts):
        meta = adapter_meta.get(hci, {})
        used = links_by_hci.get(hci, 0)
        free = max(0, 7 - used)
        bus_kind = _detect_bus_type(hci) if idx > 0 else 'Interna'
        role_hint = 'Gamepad / Periferiche' if idx == 0 else 'Audio / Espansione'
        adapters[hci] = {
            'hci': hci,
            'mac': meta.get('mac', ''),
            'alias': meta.get('alias', hci),
            'powered': meta.get('powered', True),
            'bus_kind': bus_kind,
            'role_hint': role_hint,
            'max_channels': 7,
            'active_links': used,
            'free_channels': free,
        }
        total_channels += 7
        active_links += used

    free_channels = max(0, total_channels - active_links)
    best_hci = max(hosts, key=lambda h: (adapters[h]['free_channels'], h != 'hci0'))

    return {
        'controllers': hosts,
        'adapters': adapters,
        'best_hci': best_hci,
        'num_controllers': len(hosts),
        'total_channels': total_channels,
        'active_links': active_links,
        'free_channels': free_channels,
    }


def is_unnamed_mac(name):
    return bool(re.match(r'^([0-9A-F]{2}[-:]){5}[0-9A-F]{2}$', name.strip(), re.I))


def _classify_device(name, icon_type):
    icon_type = (icon_type or '').lower()
    is_gamepad = (
        'gaming' in icon_type
        or 'joy' in icon_type
        or bool(re.search(r'gamepad|controller|joy|xbox|dualsense|dualshock|8bitdo|pro controller', name, re.I))
    )
    is_audio = (
        'audio' in icon_type
        or 'headset' in icon_type
        or 'headphone' in icon_type
        or bool(re.search(r'headphone|headset|earbud|buds|airpods|speaker|jbl|sony|bose|cuffie|marshall|soundcore|nothing ear', name, re.I))
    )
    is_input = (
        'mouse' in icon_type
        or 'keyboard' in icon_type
        or bool(re.search(r'mouse|keyboard|tastiera|bk10|mx master|logi|keychron', name, re.I))
    )

    if is_gamepad:
        return 'input-gaming-symbolic', 'Gamepad / Controller', 'gamepad'
    if is_audio:
        return 'audio-headphones-symbolic', 'Cuffie / Cassa Audio', 'audio'
    if is_input:
        icon_name = 'input-keyboard-symbolic' if ('keyboard' in name.lower() or 'keyboard' in icon_type) else 'input-mouse-symbolic'
        return icon_name, 'Mouse / Tastiera (Conferma richiesta per scollegare)', 'system'
    if 'phone' in icon_type:
        return 'phone-symbolic', 'Smartphone', 'system'
    return 'bluetooth-active-symbolic', 'Dispositivo Bluetooth', 'system'


def get_bt_cards_profile_map():
    """Restituisce per ogni MAC Bluetooth i profili PipeWire/PulseAudio (A2DP Stereo HD vs HFP Microfono)."""
    out = run_cmd(['pactl', '-f', 'json', 'list', 'cards'])
    if not out:
        return {}
    result = {}
    try:
        cards = json.loads(out)
        for c in cards:
            cname = c.get('name', '')
            if not cname.startswith('bluez_card.'):
                continue
            mac_part = cname.replace('bluez_card.', '').replace('_', ':').upper()
            active_prof = c.get('active_profile', '')
            profiles = c.get('profiles', {})
            prof_names = list(profiles.keys()) if isinstance(profiles, dict) else []

            # Sceglie il miglior profilo A2DP (Alta Qualità Stereo) e il miglior profilo HFP (Microfono attivo)
            a2dp_candidates = [p for p in prof_names if p.startswith('a2dp-sink')]
            hfp_candidates = [p for p in prof_names if p.startswith('headset-head-unit')]

            best_a2dp = 'a2dp-sink'
            if a2dp_candidates:
                best_a2dp = sorted(a2dp_candidates, key=lambda x: (x != 'a2dp-sink', len(x)))[0]

            best_hfp = None
            if hfp_candidates:
                # Preferisce mSBC (voce wideband) se presente
                best_hfp = sorted(
                    hfp_candidates,
                    key=lambda x: (0 if 'msbc' in x else (1 if x == 'headset-head-unit' else 2)),
                )[0]

            result[mac_part] = {
                'card_name': cname,
                'active_profile': active_prof,
                'is_mic_active': active_prof.startswith('headset-head-unit'),
                'best_a2dp': best_a2dp,
                'best_hfp': best_hfp,
                'has_mic_profile': bool(best_hfp),
            }
    except Exception:
        pass
    return result


def get_bt_devices(hw_stats=None):
    """Legge i dispositivi da TUTTE le antenne (hci0, hci1...) tramite D-Bus (con fallback a bluetoothctl)."""
    if hw_stats is None:
        hw_stats = get_radio_hardware_stats()
    adapters = hw_stats.get('adapters', {})
    card_map = get_bt_cards_profile_map()

    managed = _get_bluez_managed_objects()
    devices_by_mac = {}

    if managed:
        for obj_path, ifaces in managed.items():
            dev = ifaces.get('org.bluez.Device1')
            if not dev:
                continue
            mac = dev.get('Address', '').upper()
            if not mac:
                continue
            name = (dev.get('Alias') or dev.get('Name') or mac).strip()
            connected = bool(dev.get('Connected', False))
            paired = bool(dev.get('Paired', False))

            if is_unnamed_mac(name) and not connected and not paired:
                continue

            adapter_path = dev.get('Adapter', '/org/bluez/hci0')
            hci = os.path.basename(adapter_path)
            adp_info = adapters.get(hci, {'hci': hci, 'mac': '', 'free_channels': 7, 'active_links': 0})

            icon_type = dev.get('Icon', '')
            bat_iface = ifaces.get('org.bluez.Battery1', {})
            bat_pct = bat_iface.get('Percentage')
            battery = f"{int(bat_pct)}%" if bat_pct is not None else None

            icon_name, kind_label, category = _classify_device(name, icon_type)
            cinfo = card_map.get(mac, {})

            entry = {
                'mac': mac,
                'name': name,
                'connected': connected,
                'paired': paired,
                'battery': battery,
                'icon_name': icon_name,
                'kind_label': kind_label,
                'category': category,
                'hci': hci,
                'adapter_mac': adp_info.get('mac', ''),
                'adapter_free': adp_info.get('free_channels', 7),
                'dbus_path': obj_path,
                'known_hcis': [hci],
                'card_name': cinfo.get('card_name'),
                'is_mic_active': cinfo.get('is_mic_active', False),
                'best_a2dp': cinfo.get('best_a2dp', 'a2dp-sink'),
                'best_hfp': cinfo.get('best_hfp', 'headset-head-unit'),
                'has_mic_profile': cinfo.get('has_mic_profile', True),
            }

            if mac in devices_by_mac:
                prev = devices_by_mac[mac]
                if hci not in prev['known_hcis']:
                    prev['known_hcis'].append(hci)
                if connected or (not prev['connected'] and entry['adapter_free'] > prev['adapter_free']):
                    entry['known_hcis'] = prev['known_hcis']
                    devices_by_mac[mac] = entry
            else:
                devices_by_mac[mac] = entry

        devices = list(devices_by_mac.values())
        devices.sort(key=lambda d: (not d['connected'], d['name'].lower()))
        return devices

    # Fallback via bluetoothctl se D-Bus non risponde
    out = run_cmd(['bluetoothctl', 'devices'])
    devices = []
    default_hci = hw_stats['controllers'][0] if hw_stats.get('controllers') else 'hci0'
    adp_info = adapters.get(default_hci, {'mac': '', 'free_channels': 7})
    for line in out.splitlines():
        m = re.match(r'^Device\s+([0-9A-F:]{17})\s+(.+)$', line, re.I)
        if not m:
            continue
        mac = m.group(1).upper()
        name = m.group(2).strip()
        info = run_cmd(['bluetoothctl', 'info', mac])
        connected = bool(re.search(r'Connected:\s*yes', info, re.I))
        paired = bool(re.search(r'Paired:\s*yes', info, re.I))

        if is_unnamed_mac(name) and not connected and not paired:
            continue

        icon_m = re.search(r'Icon:\s*(\S+)', info, re.I)
        icon_type = icon_m.group(1).lower() if icon_m else ''
        bat_m = re.search(r'Battery Percentage:.*\((\d+)\)', info, re.I)
        battery = f"{bat_m.group(1)}%" if bat_m else None

        icon_name, kind_label, category = _classify_device(name, icon_type)
        cinfo = card_map.get(mac, {})
        devices.append({
            'mac': mac,
            'name': name,
            'connected': connected,
            'paired': paired,
            'battery': battery,
            'icon_name': icon_name,
            'kind_label': kind_label,
            'category': category,
            'hci': default_hci,
            'adapter_mac': adp_info.get('mac', ''),
            'adapter_free': adp_info.get('free_channels', 7),
            'dbus_path': f'/org/bluez/{default_hci}/dev_{mac.replace(":", "_")}',
            'known_hcis': [default_hci],
            'card_name': cinfo.get('card_name'),
            'is_mic_active': cinfo.get('is_mic_active', False),
            'best_a2dp': cinfo.get('best_a2dp', 'a2dp-sink'),
            'best_hfp': cinfo.get('best_hfp', 'headset-head-unit'),
            'has_mic_profile': cinfo.get('has_mic_profile', True),
        })
    devices.sort(key=lambda d: (not d['connected'], d['name'].lower()))
    return devices


def get_bt_audio_sinks():
    out = run_cmd(['pactl', '-f', 'json', 'list', 'sinks'])
    if not out:
        return []
    try:
        sinks = json.loads(out)
        bt_sinks = []
        for s in sinks:
            name = s.get('name', '')
            if name.startswith('bluez_output.'):
                props = s.get('properties', {})
                desc = props.get('device.description') or s.get('description') or name
                bt_sinks.append({'name': name, 'desc': desc})
        return bt_sinks
    except Exception:
        return []


def get_bt_audio_sources():
    """Restituisce i microfoni Bluetooth attivi (bluez_input.*) senza mai includere il microfono interno del PC."""
    out = run_cmd(['pactl', '-f', 'json', 'list', 'sources'])
    if not out:
        return []
    try:
        sources = json.loads(out)
        bt_sources = []
        for s in sources:
            name = s.get('name', '')
            if name.startswith('bluez_input.'):
                props = s.get('properties', {})
                desc = props.get('device.description') or s.get('description') or name
                bt_sources.append({'name': name, 'desc': desc})
        return bt_sources
    except Exception:
        return []


def unload_combined():
    out = run_cmd(['pactl', 'list', 'short', 'modules'])
    for line in out.splitlines():
        if 'module-combine-sink' in line and (
            COMBINED_SINK_NAME in line or 'multy_bt_sink' in line or 'audio_condiviso_scelto' in line
        ):
            parts = line.strip().split()
            if parts:
                run_cmd(['pactl', 'unload-module', parts[0]])


def unload_combined_mics():
    out = run_cmd(['pactl', 'list', 'short', 'modules'])
    # Scarica prima i loopback/remap e poi il null-sink dei microfoni BT
    lines = out.splitlines()
    for line in reversed(lines):
        if COMBINED_MIC_SINK in line or COMBINED_MIC_SOURCE in line:
            parts = line.strip().split()
            if parts:
                run_cmd(['pactl', 'unload-module', parts[0]])


def sync_bt_microphones(enabled=True, mic_enabled_macs=None):
    """
    Gestisce i profili A2DP (Audio HD, Mic OFF) vs HFP (Mic ON) sulle cuffie Bluetooth
    e combina più microfoni BT se 2+ cuffie hanno "🎙️ Mic: ON" attivo.
    """
    unload_combined_mics()
    if not enabled:
        return ""

    wanted_macs = set(m.upper() for m in (mic_enabled_macs or []))
    card_map = get_bt_cards_profile_map()

    for mac, cinfo in card_map.items():
        card_name = cinfo['card_name']
        want_mic = mac in wanted_macs
        if want_mic and cinfo.get('best_hfp') and not cinfo['is_mic_active']:
            run_cmd(['pactl', 'set-card-profile', card_name, cinfo['best_hfp']])
        elif (not want_mic) and cinfo['is_mic_active'] and cinfo.get('best_a2dp'):
            run_cmd(['pactl', 'set-card-profile', card_name, cinfo['best_a2dp']])

    bt_sources = get_bt_audio_sources()
    if len(bt_sources) >= 2:
        run_cmd([
            'pactl', 'load-module', 'module-null-sink',
            f'sink_name={COMBINED_MIC_SINK}',
            'sink_properties=device.description="BlueHub_Mix_Microfoni_BT"',
        ])
        for src in bt_sources:
            run_cmd([
                'pactl', 'load-module', 'module-loopback',
                f'source={src["name"]}',
                f'sink={COMBINED_MIC_SINK}',
                'latency_msec=20',
            ])
        run_cmd([
            'pactl', 'load-module', 'module-remap-source',
            f'master={COMBINED_MIC_SINK}.monitor',
            f'source_name={COMBINED_MIC_SOURCE}',
            'source_properties=device.description="BlueHub_Microfoni_BT_Condivisi"',
        ])
        run_cmd(['pactl', 'set-default-source', COMBINED_MIC_SOURCE])
        names = ', '.join(s['desc'] for s in bt_sources)
        return f" • 🎙️ {len(bt_sources)} Microfoni BT uniti ({names})"
    elif len(bt_sources) == 1:
        run_cmd(['pactl', 'set-default-source', bt_sources[0]['name']])
        return f" • 🎙️ Mic BT attivo: {bt_sources[0]['desc']}"
    return " • 🔒 Cuffie protette in Stereo HD (Mic BT spenti)"


def apply_fallback_sink():
    """
    Uscita audio da usare quando non c'è audio Bluetooth (o BlueHub è spento).
    Si sceglie con "fallback_sink" in ~/.config/bluehub.json; se non è impostata
    (o non esiste su questo PC) BlueHub non tocca nulla e decide il sistema.
    Restituisce la descrizione dell'uscita impostata, oppure None.
    """
    fallback = load_config().get('fallback_sink')
    if not fallback:
        return None
    out = run_cmd(['pactl', '-f', 'json', 'list', 'sinks'])
    try:
        for s in json.loads(out) if out else []:
            if s.get('name') == fallback:
                run_cmd(['pactl', 'set-default-sink', fallback])
                props = s.get('properties', {})
                return props.get('device.description') or s.get('description') or fallback
    except Exception:
        pass
    return None


def sync_automatic_shared_audio(enabled=True, mic_enabled_macs=None):
    unload_combined()

    if not enabled:
        unload_combined_mics()
        apply_fallback_sink()
        return "⚪ BlueHub Disattivato — Condivisione audio spenta"

    mic_msg = sync_bt_microphones(enabled=True, mic_enabled_macs=mic_enabled_macs)
    bt_sinks = get_bt_audio_sinks()

    if len(bt_sinks) >= 2:
        slaves_str = ','.join(s['name'] for s in bt_sinks)
        run_cmd([
            'pactl', 'load-module', 'module-combine-sink',
            f'sink_name={COMBINED_SINK_NAME}',
            f'slaves={slaves_str}',
            'sink_properties=device.description="BlueHub_Audio_Condiviso_Automatico"',
        ])
        run_cmd(['pactl', 'set-default-sink', COMBINED_SINK_NAME])
        names = ', '.join(s['desc'] for s in bt_sinks)
        return f"🎶 Ascolto Condiviso AUTOMATICO su {len(bt_sinks)} cuffie ({names}){mic_msg}"
    elif len(bt_sinks) == 1:
        run_cmd(['pactl', 'set-default-sink', bt_sinks[0]['name']])
        return f"🎧 Audio su: {bt_sinks[0]['desc']}{mic_msg}"
    else:
        fallback_desc = apply_fallback_sink()
        if fallback_desc:
            return f"🔊 Nessuna cuffia BT connessa — Audio attivo su: {fallback_desc}"
        return "🔊 Nessuna cuffia BT connessa — Audio sull'uscita predefinita del sistema"


class BlueHubWindow(Adw.ApplicationWindow):
    def __init__(self, app):
        super().__init__(application=app, title="BlueHub")
        self.set_default_size(720, 820)

        self.cfg = load_config()
        self.ext_enabled = bool(self.cfg.get('enabled', True))
        self.preferred_scan_hci = self.cfg.get('preferred_scan_hci', 'auto')
        self.mic_enabled_macs = set(m.upper() for m in self.cfg.get('mic_enabled_macs', []))

        self.quota_gamepads = 0
        self.quota_headphones = 0
        self.usable_pool = 5
        self.conn_gamepads = 0
        self.conn_audio = 0
        self.free_hw_channels = 5
        self.hw_stats = {}
        self.bt_devices_cache = []

        self.toast_overlay = Adw.ToastOverlay()
        self.set_content(self.toast_overlay)

        toolbar_view = Adw.ToolbarView()
        self.toast_overlay.set_child(toolbar_view)

        header = Adw.HeaderBar()
        self.title_widget = Adw.WindowTitle(
            title="BlueHub",
            subtitle="Gestione Canali Bluetooth Multi-Antenna",
        )
        header.set_title_widget(self.title_widget)

        refresh_btn = Gtk.Button(icon_name="view-refresh-symbolic", tooltip_text="Aggiorna antenne, canali e dispositivi")
        refresh_btn.connect('clicked', lambda _: self.refresh_all())
        header.pack_start(refresh_btn)

        toolbar_view.add_top_bar(header)

        page = Adw.PreferencesPage()
        toolbar_view.set_content(page)

        # --- SCHEDA DELL'ESTENSIONE (Attivazione + Cerca BT affiancati nello stesso stile compatto) ---
        ext_group = Adw.PreferencesGroup(
            title="⚙️ Scheda Estensione BlueHub",
        )
        page.add(ext_group)

        self.ext_row = Adw.ActionRow(
            title="Attivazione del programma",
            subtitle="Controlla la gestione dei canali Bluetooth e l'audio condiviso automatico",
        )
        ext_icon = Gtk.Image.new_from_icon_name("bluetooth-active-symbolic")
        self.ext_row.add_prefix(ext_icon)

        ext_btns_box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        ext_btns_box.set_valign(Gtk.Align.CENTER)

        # Pulsante "Cerca BT" al fianco del tasto di attivazione
        self.scan_btn = Gtk.Button(label="Cerca BT")
        self.scan_btn.set_valign(Gtk.Align.CENTER)
        self.scan_btn.set_tooltip_text("Avvia scansione Bluetooth intelligente per 8 secondi")
        self.scan_btn.connect('clicked', self.on_scan_bt)
        ext_btns_box.append(self.scan_btn)

        # Tasto di attivazione ridimensionato con lo stesso identico stile compatto di "Cerca BT"
        self.master_toggle_btn = Gtk.ToggleButton()
        self.master_toggle_btn.set_valign(Gtk.Align.CENTER)
        self.master_toggle_btn.set_active(self.ext_enabled)
        self.master_toggle_btn.connect('toggled', self.on_master_toggle)
        ext_btns_box.append(self.master_toggle_btn)

        self.ext_row.add_suffix(ext_btns_box)
        ext_group.add(self.ext_row)

        # Riga per stato Multi-Antenna e selezione antenna d'accoppiamento
        self.multi_antenna_row = Adw.ActionRow()
        antenna_icon = Gtk.Image.new_from_icon_name("network-wireless-hotspot-symbolic")
        self.multi_antenna_row.add_prefix(antenna_icon)
        self.antenna_btn_box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=6)
        self.antenna_btn_box.set_valign(Gtk.Align.CENTER)
        self.multi_antenna_row.add_suffix(self.antenna_btn_box)
        ext_group.add(self.multi_antenna_row)

        # --- SEZIONE 1: BILANCIO CANALI E 2 RIQUADRI (+ / -) ---
        self.radio_group = Adw.PreferencesGroup(
            title="📡 Ripartizione Canali Bluetooth",
        )
        page.add(self.radio_group)

        self.radio_row = Adw.ActionRow()
        self.radio_group.add(self.radio_row)

        self.cap_hint_row = Adw.ActionRow()
        self.radio_group.add(self.cap_hint_row)

        # Due riquadri affiancati: [ Gamepad (- / +) ] e [ Cuffie (- / +) ]
        self.cards_grid = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=16)
        self.cards_grid.set_homogeneous(True)
        self.cards_grid.set_margin_top(12)
        self.cards_grid.set_margin_bottom(8)
        self.radio_group.add(self.cards_grid)

        # --- RIQUADRO 1: GAMEPAD ---
        gp_card = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=10)
        gp_card.add_css_class('card')
        gp_card.set_margin_start(4)
        gp_card.set_margin_end(4)

        gp_inner = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        gp_inner.set_margin_top(16)
        gp_inner.set_margin_bottom(16)
        gp_inner.set_margin_start(16)
        gp_inner.set_margin_end(16)
        gp_card.append(gp_inner)

        gp_title = Gtk.Label(label="<b>🎮 Gamepad</b>", use_markup=True)
        gp_inner.append(gp_title)

        self.gp_sub_label = Gtk.Label(label="Connessi ora: 0")
        self.gp_sub_label.add_css_class('dim-label')
        gp_inner.append(self.gp_sub_label)

        gp_ctrl_box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=18)
        gp_ctrl_box.set_halign(Gtk.Align.CENTER)
        gp_ctrl_box.set_margin_top(6)
        gp_inner.append(gp_ctrl_box)

        self.btn_gp_minus = Gtk.Button(label="−")
        self.btn_gp_minus.add_css_class('circular')
        self.btn_gp_minus.connect('clicked', self.on_change_gp, -1)
        gp_ctrl_box.append(self.btn_gp_minus)

        self.lbl_gp_val = Gtk.Label(label="0", use_markup=True)
        gp_ctrl_box.append(self.lbl_gp_val)

        self.btn_gp_plus = Gtk.Button(label="+")
        self.btn_gp_plus.add_css_class('circular')
        self.btn_gp_plus.add_css_class('suggested-action')
        self.btn_gp_plus.connect('clicked', self.on_change_gp, +1)
        gp_ctrl_box.append(self.btn_gp_plus)

        self.cards_grid.append(gp_card)

        # --- RIQUADRO 2: CUFFIE / CASSE ---
        au_card = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=10)
        au_card.add_css_class('card')
        au_card.set_margin_start(4)
        au_card.set_margin_end(4)

        au_inner = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        au_inner.set_margin_top(16)
        au_inner.set_margin_bottom(16)
        au_inner.set_margin_start(16)
        au_inner.set_margin_end(16)
        au_card.append(au_inner)

        au_title = Gtk.Label(label="<b>🎧 Cuffie / Casse</b>", use_markup=True)
        au_inner.append(au_title)

        self.au_sub_label = Gtk.Label(label="Connesse ora: 0")
        self.au_sub_label.add_css_class('dim-label')
        au_inner.append(self.au_sub_label)

        au_ctrl_box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=18)
        au_ctrl_box.set_halign(Gtk.Align.CENTER)
        au_ctrl_box.set_margin_top(6)
        au_inner.append(au_ctrl_box)

        self.btn_au_minus = Gtk.Button(label="−")
        self.btn_au_minus.add_css_class('circular')
        self.btn_au_minus.connect('clicked', self.on_change_au, -1)
        au_ctrl_box.append(self.btn_au_minus)

        self.lbl_au_val = Gtk.Label(label="0", use_markup=True)
        au_ctrl_box.append(self.lbl_au_val)

        self.btn_au_plus = Gtk.Button(label="+")
        self.btn_au_plus.add_css_class('circular')
        self.btn_au_plus.add_css_class('suggested-action')
        self.btn_au_plus.connect('clicked', self.on_change_au, +1)
        au_ctrl_box.append(self.btn_au_plus)

        self.cards_grid.append(au_card)

        # --- GRUPPO 1: Gamepad ---
        self.gamepad_group = Adw.PreferencesGroup()
        page.add(self.gamepad_group)
        self.gamepad_rows = []

        # --- GRUPPO 2: Cuffie / Casse BT (con Audio Condiviso automatico + tasto 🎙️ Mic) ---
        self.bt_audio_group = Adw.PreferencesGroup()
        page.add(self.bt_audio_group)
        self.bt_audio_rows = []

        # --- GRUPPO 3: Periferiche già connesse (Mouse, Tastiera, Altro) ---
        self.system_group = Adw.PreferencesGroup()
        page.add(self.system_group)
        self.system_rows = []

        self.refresh_all()

    def _rebuild_antenna_selector(self):
        child = self.antenna_btn_box.get_first_child()
        while child is not None:
            nxt = child.get_next_sibling()
            self.antenna_btn_box.remove(child)
            child = nxt

        controllers = self.hw_stats.get('controllers', ['hci0'])
        adapters = self.hw_stats.get('adapters', {})
        best_hci = self.hw_stats.get('best_hci', 'hci0')

        if len(controllers) == 1:
            h0 = controllers[0]
            a0 = adapters.get(h0, {'active_links': 0, 'free_channels': 7})
            self.multi_antenna_row.set_title(
                f"Antenna rilevata: {h0} (Interna • {a0['active_links']}/7 usati, {a0['free_channels']} liberi)"
            )
            self.multi_antenna_row.set_subtitle(
                "Multi-Antenna pronto: se inserisci una chiavetta BT USB (hci1) avrai 14 canali con smistamento automatico."
            )
        else:
            per_ant = []
            for h in controllers:
                a = adapters.get(h, {})
                per_ant.append(f"{h} ({a.get('bus_kind', 'BT')}): {a.get('active_links', 0)}/7 usati")
            self.multi_antenna_row.set_title(
                f"Multi-Antenna Attivo ({len(controllers)} ricevitori = {len(controllers) * 7} canali): " + " • ".join(per_ant)
            )
            self.multi_antenna_row.set_subtitle(
                f"Scansione e accoppiamento ('Cerca BT'): Auto sceglie l'antenna più libera ({best_hci})"
            )

            options = [('auto', f"Auto ({best_hci})")] + [(h, h) for h in controllers]
            if self.preferred_scan_hci not in [k for k, _ in options]:
                self.preferred_scan_hci = 'auto'

            group_head = None
            for key, label in options:
                b = Gtk.ToggleButton(label=label)
                b.set_valign(Gtk.Align.CENTER)
                if group_head is not None:
                    b.set_group(group_head)
                else:
                    group_head = b
                b.set_active(self.preferred_scan_hci == key)
                b.connect('toggled', self.on_select_scan_antenna, key)
                self.antenna_btn_box.append(b)

    def on_select_scan_antenna(self, btn, key):
        if not btn.get_active():
            return
        self.preferred_scan_hci = key
        self.cfg['preferred_scan_hci'] = key
        save_config(self.cfg)
        self.show_toast(
            f"Antenna per nuovi accoppiamenti: {'Automatica (la più scarica)' if key == 'auto' else key}"
        )

    def _update_master_toggle_style(self):
        if self.ext_enabled:
            self.master_toggle_btn.set_label("🟢 Attivo")
            self.ext_row.set_subtitle("🟢 Estensione attiva — Gestione canali e audio condiviso in funzione")
        else:
            self.master_toggle_btn.set_label("⚪ Disattivato")
            self.ext_row.set_subtitle("⚪ Estensione disattivata — Premi 'Disattivato' per riattivarla")

        self.multi_antenna_row.set_sensitive(self.ext_enabled)
        self.radio_group.set_sensitive(self.ext_enabled)
        self.gamepad_group.set_sensitive(self.ext_enabled)
        self.bt_audio_group.set_sensitive(self.ext_enabled)
        self.scan_btn.set_sensitive(self.ext_enabled)

    def on_master_toggle(self, btn):
        self.ext_enabled = btn.get_active()
        self.cfg['enabled'] = self.ext_enabled
        save_config(self.cfg)
        self._update_master_toggle_style()
        self._rebuild_device_lists()
        self.show_toast("BlueHub Attivo" if self.ext_enabled else "BlueHub Disattivato")

    def _clamp_quotas(self):
        self.quota_gamepads = max(self.conn_gamepads, min(self.usable_pool, self.quota_gamepads))
        self.quota_headphones = max(self.conn_audio, min(self.usable_pool, self.quota_headphones))

        while (self.quota_gamepads + self.quota_headphones) > self.usable_pool:
            if self.quota_headphones > self.conn_audio and self.quota_headphones >= self.quota_gamepads:
                self.quota_headphones -= 1
            elif self.quota_gamepads > self.conn_gamepads:
                self.quota_gamepads -= 1
            else:
                break

    def _update_quotas_and_buttons(self):
        self._update_master_toggle_style()

        allocated = self.quota_gamepads + self.quota_headphones
        unassigned = max(0, self.usable_pool - allocated)
        cap_reached = (allocated >= self.usable_pool)

        self.lbl_gp_val.set_markup(f"<span size='xx-large' weight='bold'>{self.quota_gamepads}</span>")
        self.lbl_au_val.set_markup(f"<span size='xx-large' weight='bold'>{self.quota_headphones}</span>")

        self.gp_sub_label.set_text(f"Connessi ora: {self.conn_gamepads} / {self.quota_gamepads}")
        self.au_sub_label.set_text(f"Connesse ora: {self.conn_audio} / {self.quota_headphones}")

        can_gp_minus = self.ext_enabled and (self.quota_gamepads > self.conn_gamepads)
        can_gp_plus = self.ext_enabled and (not cap_reached)

        can_au_minus = self.ext_enabled and (self.quota_headphones > self.conn_audio)
        can_au_plus = self.ext_enabled and (not cap_reached)

        self.btn_gp_minus.set_sensitive(can_gp_minus)
        self.btn_gp_plus.set_sensitive(can_gp_plus)
        self.btn_au_minus.set_sensitive(can_au_minus)
        self.btn_au_plus.set_sensitive(can_au_plus)

        if cap_reached:
            self.cap_hint_row.set_title(
                f"🔒 Tutti i {self.usable_pool} canali disponibili sono assegnati ({self.quota_gamepads} Gamepad + {self.quota_headphones} Cuffie)"
            )
            self.cap_hint_row.set_subtitle(
                "Zero canali rimasti. Per spostare un canale sull'altro riquadro, premi prima [ − ] su quello che ha i canali."
            )
        else:
            self.cap_hint_row.set_title(
                f"🟢 Hai ancora {unassigned} {'canale disponibile' if unassigned == 1 else 'canali disponibili'} da assegnare ({allocated}/{self.usable_pool} assegnati)"
            )
            self.cap_hint_row.set_subtitle(
                "Puoi metterli tutti su Gamepad, tutti su Cuffie, o dividerli come preferisci."
            )

        self._rebuild_device_lists()

    def on_change_gp(self, _btn, delta):
        new_val = self.quota_gamepads + delta
        if new_val < self.conn_gamepads or new_val < 0:
            return
        if delta > 0 and (self.quota_gamepads + self.quota_headphones) >= self.usable_pool:
            return
        self.quota_gamepads = new_val
        self._update_quotas_and_buttons()

    def on_change_au(self, _btn, delta):
        new_val = self.quota_headphones + delta
        if new_val < self.conn_audio or new_val < 0:
            return
        if delta > 0 and (self.quota_gamepads + self.quota_headphones) >= self.usable_pool:
            return
        self.quota_headphones = new_val
        self._update_quotas_and_buttons()

    def show_toast(self, text):
        toast = Adw.Toast.new(text)
        toast.set_timeout(4)
        self.toast_overlay.add_toast(toast)

    def refresh_all(self):
        self.cfg = load_config()
        self.ext_enabled = bool(self.cfg.get('enabled', True))
        self.preferred_scan_hci = self.cfg.get('preferred_scan_hci', 'auto')
        self.mic_enabled_macs = set(m.upper() for m in self.cfg.get('mic_enabled_macs', []))
        if self.master_toggle_btn.get_active() != self.ext_enabled:
            self.master_toggle_btn.set_active(self.ext_enabled)

        # Sincronizza subito profili microfono e audio condiviso prima di rileggere lo stato delle schede
        shared_status_msg = sync_automatic_shared_audio(self.ext_enabled, self.mic_enabled_macs)
        self._last_shared_status_msg = shared_status_msg

        hw = get_radio_hardware_stats()
        self.hw_stats = hw
        self.free_hw_channels = hw['free_channels']
        self.bt_devices_cache = get_bt_devices(hw)

        self._rebuild_antenna_selector()

        gamepads = [d for d in self.bt_devices_cache if d['category'] == 'gamepad']
        audio_bt = [d for d in self.bt_devices_cache if d['category'] == 'audio']
        system_bt = [d for d in self.bt_devices_cache if d['category'] == 'system']

        self.conn_gamepads = sum(1 for d in gamepads if d['connected'])
        self.conn_audio = sum(1 for d in audio_bt if d['connected'])
        conn_system = sum(1 for d in system_bt if d['connected'])

        reserved_system_channels = max(conn_system, hw['active_links'] - self.conn_gamepads - self.conn_audio)
        self.usable_pool = max(0, hw['total_channels'] - reserved_system_channels)

        self._clamp_quotas()

        ant_label = f"{hw['num_controllers']} {'antenna' if hw['num_controllers'] == 1 else 'antenne'}"
        self.title_widget.set_subtitle(
            f"{hw['total_channels']} Canali Totali ({ant_label}) − {reserved_system_channels} già occupati = "
            f"{self.usable_pool} canali liberi da assegnare"
        )

        sys_names = [d['name'] for d in system_bt if d['connected']]
        sys_desc = f" ({', '.join(sys_names)})" if sys_names else ""
        self.radio_row.set_title(
            f"{hw['total_channels']} Canali Totali − {reserved_system_channels} occupati da periferiche{sys_desc} = "
            f"{self.usable_pool} Canali Disponibili"
        )
        self.radio_row.set_subtitle(
            "Nessun canale è riservato in anticipo: puoi assegnare tutti i canali disponibili come vuoi."
        )

        self._update_quotas_and_buttons()

    def _rebuild_device_lists(self):
        gamepads = [d for d in self.bt_devices_cache if d['category'] == 'gamepad']
        audio_bt = [d for d in self.bt_devices_cache if d['category'] == 'audio']
        system_bt = [d for d in self.bt_devices_cache if d['category'] == 'system']

        # 1. Lista Gamepad
        for r in self.gamepad_rows:
            self.gamepad_group.remove(r)
        self.gamepad_rows.clear()

        self.gamepad_group.set_title(
            f"🎮 Gamepad Bluetooth (Connessi: {self.conn_gamepads} / Canali assegnati: {self.quota_gamepads})"
        )
        if self.quota_gamepads == 0 and self.conn_gamepads == 0:
            self.gamepad_group.set_description(
                "0 canali assegnati ai Gamepad: premi [ + ] nel riquadro Gamepad per abilitare la connessione."
            )
        else:
            self.gamepad_group.set_description(
                f"Slot Gamepad liberi: {max(0, self.quota_gamepads - self.conn_gamepads)} su {self.quota_gamepads} assegnati."
            )

        if not gamepads:
            empty_gp = Adw.ActionRow(
                title="Nessun Gamepad Bluetooth in memoria",
                subtitle="Accendi il controller in modalità pairing e premi 'Cerca BT' in alto.",
            )
            self.gamepad_group.add(empty_gp)
            self.gamepad_rows.append(empty_gp)
        else:
            for dev in gamepads:
                row = self._create_bt_row(dev, 'gamepad')
                self.gamepad_group.add(row)
                self.gamepad_rows.append(row)

        # 2. Lista Cuffie e Casse Bluetooth + sincronizzazione automatica Audio Condiviso e Microfoni BT
        for r in self.bt_audio_rows:
            self.bt_audio_group.remove(r)
        self.bt_audio_rows.clear()

        shared_status_msg = getattr(self, '_last_shared_status_msg', None) or sync_automatic_shared_audio(
            self.ext_enabled, self.mic_enabled_macs
        )
        self.bt_audio_group.set_title(
            f"🎧 Cuffie e Casse Bluetooth (Connesse: {self.conn_audio} / Canali assegnati: {self.quota_headphones})"
        )
        self.bt_audio_group.set_description(shared_status_msg)

        if not audio_bt:
            empty_au = Adw.ActionRow(
                title="Nessuna cuffia o cassa Bluetooth in memoria",
                subtitle="Usa 'Cerca BT' in alto per cercare nuovi dispositivi.",
            )
            self.bt_audio_group.add(empty_au)
            self.bt_audio_rows.append(empty_au)
        else:
            for dev in audio_bt:
                row = self._create_bt_row(dev, 'audio')
                self.bt_audio_group.add(row)
                self.bt_audio_rows.append(row)

        # 3. Lista Mouse, Tastiere e Periferiche (con conferma prima di scollegare)
        for r in self.system_rows:
            self.system_group.remove(r)
        self.system_rows.clear()

        conn_system = sum(1 for d in system_bt if d['connected'])
        self.system_group.set_title(
            f"⌨️ Mouse, Tastiera e Altri Dispositivi ({conn_system} connessi)"
        )
        self.system_group.set_description(
            "Protetti da disconnessione accidentale: se premi 'Disconnetti' ti verrà chiesta conferma."
        )
        for dev in system_bt:
            row = self._create_bt_row(dev, 'system')
            self.system_group.add(row)
            self.system_rows.append(row)

    def _create_bt_row(self, dev, category):
        hci_tag = f"📡 {dev['hci']}"
        if len(dev.get('known_hcis', [])) > 1:
            hci_tag = f"📡 {'/'.join(dev['known_hcis'])}"

        status_txt = f"🟢 Connesso su {dev['hci']} (1 canale)" if dev['connected'] else f"⚪ Non connesso ({hci_tag})"
        bat_txt = f" • 🔋 {dev['battery']}" if dev['battery'] else ""
        row = Adw.ActionRow(
            title=dev['name'],
            subtitle=f"{status_txt} • {dev['kind_label']}{bat_txt}",
        )
        icon = Gtk.Image.new_from_icon_name(dev['icon_name'])
        row.add_prefix(icon)

        suffix_box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
        suffix_box.set_valign(Gtk.Align.CENTER)

        # Se è una Cuffia Bluetooth CONNESSA: mostra il tastino dedicato per il Microfono BT della cuffia!
        if category == 'audio' and dev['connected']:
            mic_on = (dev['mac'].upper() in self.mic_enabled_macs) or dev.get('is_mic_active', False)
            mic_btn = Gtk.ToggleButton(
                label="🎙️ Mic: ON (Voce)" if mic_on else "🎙️ Mic: OFF (Audio HD)"
            )
            mic_btn.set_valign(Gtk.Align.CENTER)
            mic_btn.set_active(mic_on)
            mic_btn.set_tooltip_text(
                "OFF = Cuffia bloccata in Alta Qualità Stereo (A2DP)\n"
                "ON = Attiva il microfono integrato di questa cuffia Bluetooth (HFP)"
            )
            mic_btn.connect('toggled', self.on_toggle_headphone_mic, dev)
            suffix_box.append(mic_btn)

        btn = Gtk.Button()
        btn.set_valign(Gtk.Align.CENTER)

        adapter_has_free = dev.get('adapter_free', 7) > 0

        if dev['connected']:
            btn.set_label("Disconnetti")
            btn.add_css_class('destructive-action')
            btn.set_sensitive(True)
        else:
            if not adapter_has_free:
                btn.set_label(f"Antenna {dev['hci']} piena (7/7)")
                btn.set_sensitive(False)
            elif category == 'gamepad':
                has_slot = self.ext_enabled and (self.conn_gamepads < self.quota_gamepads) and (self.free_hw_channels > 0)
                if has_slot:
                    btn.set_label("Connetti")
                    btn.add_css_class('suggested-action')
                    btn.set_sensitive(True)
                else:
                    btn.set_label("Bloccato (Dai +1 a Gamepad)")
                    btn.set_sensitive(False)
            elif category == 'audio':
                has_slot = self.ext_enabled and (self.conn_audio < self.quota_headphones) and (self.free_hw_channels > 0)
                if has_slot:
                    btn.set_label("Connetti")
                    btn.add_css_class('suggested-action')
                    btn.set_sensitive(True)
                else:
                    btn.set_label("Bloccato (Dai +1 a Cuffie)")
                    btn.set_sensitive(False)
            else:
                has_slot = self.free_hw_channels > 0
                btn.set_label("Connetti" if has_slot else "Canali pieni")
                if has_slot:
                    btn.add_css_class('suggested-action')
                btn.set_sensitive(has_slot)

        btn.connect('clicked', self.on_click_device_button, dev, category)
        suffix_box.append(btn)
        row.add_suffix(suffix_box)
        return row

    def on_toggle_headphone_mic(self, btn, dev):
        mac = dev['mac'].upper()
        want_mic = btn.get_active()
        if want_mic:
            self.mic_enabled_macs.add(mac)
        else:
            self.mic_enabled_macs.discard(mac)

        self.cfg['mic_enabled_macs'] = sorted(list(self.mic_enabled_macs))
        save_config(self.cfg)

        mode_txt = "Microfono BT attivato" if want_mic else "Audio Stereo HD ripristinato (Mic spento)"
        self.show_toast(f"{dev['name']}: {mode_txt}")
        self.refresh_all()

    def on_click_device_button(self, btn, dev, category):
        if dev['connected'] and category == 'system':
            dialog = Adw.MessageDialog(
                transient_for=self,
                heading=f"Scollegare {dev['name']}?",
                body=(
                    f"Stai per disconnettere '{dev['name']}' dall'antenna {dev['hci']}.\n"
                    "Se è il tuo mouse o la tua tastiera principale potresti rimanere senza controlli! "
                    "Sei sicuro di voler procedere?"
                ),
            )
            dialog.add_response('cancel', 'Annulla')
            dialog.add_response('disconnect', 'Sì, disconnetti')
            dialog.set_response_appearance('disconnect', Adw.ResponseAppearance.DESTRUCTIVE)
            dialog.set_default_response('cancel')
            dialog.set_close_response('cancel')
            dialog.connect('response', self._on_confirm_system_disconnect, btn, dev)
            dialog.present()
            return

        self._execute_bt_toggle(btn, dev)

    def _on_confirm_system_disconnect(self, dialog, response, btn, dev):
        dialog.destroy()
        if response == 'disconnect':
            self._execute_bt_toggle(btn, dev)

    def _execute_bt_toggle(self, btn, dev):
        was_connected = dev['connected']
        action_method = 'Disconnect' if was_connected else 'Connect'
        action_cli = 'disconnect' if was_connected else 'connect'
        btn.set_sensitive(False)
        btn.set_label("Attendere...")
        self.show_toast(
            f"{'Disconnessione da' if was_connected else 'Connessione a'} {dev['name']} (antenna {dev['hci']})..."
        )

        def worker():
            ok = False
            if dev.get('dbus_path'):
                try:
                    bus = Gio.bus_get_sync(Gio.BusType.SYSTEM, None)
                    bus.call_sync(
                        'org.bluez',
                        dev['dbus_path'],
                        'org.bluez.Device1',
                        action_method,
                        None,
                        None,
                        Gio.DBusCallFlags.NONE,
                        10000,
                        None,
                    )
                    ok = True
                except Exception:
                    ok = False

            if not ok:
                cmds = []
                if dev.get('adapter_mac'):
                    cmds.append(f"select {dev['adapter_mac']}")
                cmds.append(f"{action_cli} {dev['mac']}")
                run_btctl_commands(cmds, timeout=10)

            if was_connected:
                if dev['category'] == 'audio' and self.quota_headphones > 0:
                    self.quota_headphones = max(0, self.quota_headphones - 1)
                elif dev['category'] == 'gamepad' and self.quota_gamepads > 0:
                    self.quota_gamepads = max(0, self.quota_gamepads - 1)
            GLib.idle_add(self.refresh_all)

        threading.Thread(target=worker, daemon=True).start()

    def on_scan_bt(self, btn):
        btn.set_sensitive(False)
        btn.set_label("Ricerca...")

        adapters = self.hw_stats.get('adapters', {})
        best_hci = self.hw_stats.get('best_hci', 'hci0')
        target_hci = best_hci if self.preferred_scan_hci == 'auto' else self.preferred_scan_hci
        target_info = adapters.get(target_hci, adapters.get('hci0', {'hci': 'hci0', 'mac': ''}))

        if len(adapters) > 1:
            self.show_toast(
                f"Scansione Multi-Antenna su {target_hci} ({target_info.get('free_channels', 7)}/7 canali liberi) per 8s..."
            )
        else:
            self.show_toast("Scansione Bluetooth attiva per 8 secondi...")

        def worker():
            target_mac = target_info.get('mac', '')
            if target_mac:
                run_btctl_commands([
                    f"select {target_mac}",
                    "power on",
                    "pairable on",
                    "scan on",
                ], timeout=2)
                subprocess.run(['sleep', '8'], check=False)
                run_btctl_commands([
                    f"select {target_mac}",
                    "scan off",
                ], timeout=3)
            else:
                run_cmd(['bluetoothctl', '--timeout', '8', 'scan', 'on'], timeout=10)

            def done():
                btn.set_sensitive(True)
                btn.set_label("Cerca BT")
                self.refresh_all()
                self.show_toast(f"Scansione completata su {target_hci}!")
            GLib.idle_add(done)

        threading.Thread(target=worker, daemon=True).start()


class BlueHubApp(Adw.Application):
    def __init__(self):
        super().__init__(application_id='local.michele.BlueHub')

    def do_startup(self):
        Adw.Application.do_startup(self)
        Adw.StyleManager.get_default().set_color_scheme(Adw.ColorScheme.PREFER_DARK)

    def do_activate(self):
        win = BlueHubWindow(self)
        win.present()


if __name__ == '__main__':
    app = BlueHubApp()
    sys.exit(app.run(sys.argv))
