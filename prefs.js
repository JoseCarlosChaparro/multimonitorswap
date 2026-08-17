/*
Multi Monitor Swap preferences — port to GNOME Shell 50 (GTK4 + libadwaita).

Original work by dvrlabs (https://github.com/dvrlabs/multimonitorswap).
*/

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import GObject from 'gi://GObject';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const SHORTCUT_GROUPS = [
    {
        title: 'Swap windows between monitors',
        keys: [
            ['swap-up', 'Swap up'],
            ['swap-down', 'Swap down'],
            ['swap-left', 'Swap left'],
            ['swap-right', 'Swap right'],
        ],
    },
    {
        title: 'Move focus between monitors',
        keys: [
            ['focus-up', 'Focus up'],
            ['focus-down', 'Focus down'],
            ['focus-left', 'Focus left'],
            ['focus-right', 'Focus right'],
        ],
    },
    {
        title: 'Cycle windows on the current monitor',
        keys: [
            ['select-up', 'Select up'],
            ['select-down', 'Select down'],
        ],
    },
];

/**
 * A preferences row that captures a single keyboard shortcut.
 *
 * Replaces the GTK3-era Gtk.TreeView + Gtk.CellRendererAccel combination,
 * which is deprecated in GTK4. Key capture uses an event controller on a
 * modal dialog, which is the supported GTK4 approach.
 */
const ShortcutRow = GObject.registerClass(
class ShortcutRow extends Adw.ActionRow {
    _init(settings, key, description) {
        super._init({
            title: description,
            activatable: true,
        });

        this._settings = settings;
        this._key = key;

        this._label = new Gtk.ShortcutLabel({
            valign: Gtk.Align.CENTER,
            // Shown when no shortcut is assigned.
            disabled_text: 'Disabled',
        });
        this.add_suffix(this._label);

        const clearButton = new Gtk.Button({
            icon_name: 'edit-clear-symbolic',
            valign: Gtk.Align.CENTER,
            has_frame: false,
            tooltip_text: 'Clear shortcut',
        });
        clearButton.connect('clicked', () => this._store(null));
        this.add_suffix(clearButton);

        this._settingsChangedId = this._settings.connect(
            `changed::${this._key}`, () => this._sync());
        this.connect('destroy', () => {
            this._settings.disconnect(this._settingsChangedId);
        });

        this.connect('activated', () => this._promptForShortcut());
        this._sync();
    }

    _sync() {
        this._label.accelerator = this._settings.get_strv(this._key)[0] ?? '';
    }

    _store(accelerator) {
        this._settings.set_strv(this._key, accelerator ? [accelerator] : []);
    }

    _promptForShortcut() {
        const dialog = new Adw.MessageDialog({
            heading: 'Set shortcut',
            body: `Press the new shortcut for “${this.title}”, or Esc to cancel.`,
            modal: true,
            transient_for: this.get_root(),
        });
        dialog.add_response('cancel', 'Cancel');

        const controller = new Gtk.EventControllerKey();
        controller.connect('key-pressed', (_c, keyval, keycode, state) => {
            const mask = state & Gtk.accelerator_get_default_mod_mask();

            if (keyval === Gdk.KEY_Escape && !mask) {
                dialog.close();
                return Gdk.EVENT_STOP;
            }

            // Ignore lone modifier presses; wait for a real key.
            if (!this._isValidAccel(keyval, mask))
                return Gdk.EVENT_STOP;

            this._store(Gtk.accelerator_name_with_keycode(
                null, keyval, keycode, mask));
            dialog.close();
            return Gdk.EVENT_STOP;
        });
        dialog.add_controller(controller);
        dialog.present();
    }

    _isValidAccel(keyval, mask) {
        if (Gtk.accelerator_valid(keyval, mask))
            return true;

        // Allow unmodified function/navigation keys, which accelerator_valid
        // rejects without a modifier.
        return mask !== 0;
    }
});

export default class MultiMonitorSwapPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage();

        for (const {title, keys} of SHORTCUT_GROUPS) {
            const group = new Adw.PreferencesGroup({title});
            for (const [key, description] of keys)
                group.add(new ShortcutRow(settings, key, description));
            page.add(group);
        }

        window.add(page);
    }
}
