import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import GLib from 'gi://GLib';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const BLUEHUB_APP_PATH = '/home/michele/Documenti/Claude/Projects/Mio Portatile Linux/bluehub.py';

export default class BlueHubPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const page = new Adw.PreferencesPage();
        const group = new Adw.PreferencesGroup({
            title: 'BlueHub — Centro di Controllo',
            description: 'Gestione Canali Bluetooth (Gamepad & Cuffie) e Audio Condiviso automatico.',
        });
        page.add(group);

        const row = new Adw.ActionRow({
            title: 'Pannello di Controllo BlueHub',
            subtitle: 'Apri la finestra principale per regolare le quote [+ / −] di Gamepad e Cuffie',
        });

        const btn = new Gtk.Button({
            label: 'Apri BlueHub',
            valign: Gtk.Align.CENTER,
        });
        btn.add_css_class('suggested-action');
        btn.connect('clicked', () => {
            GLib.spawn_command_line_async(`/usr/bin/python3 "${BLUEHUB_APP_PATH}"`);
            window.close();
        });

        row.add_suffix(btn);
        group.add(row);
        window.add(page);
    }
}
