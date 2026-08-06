/*
Multi Monitor Swap — port to GNOME Shell 50.

Original work by dvrlabs (https://github.com/dvrlabs/multimonitorswap).
*/

import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

// Windows belonging to the shell's own GJS processes must never be swapped.
const IGNORED_WM_CLASS = 'gjs';

// A window moved across monitors is only focusable once the compositor has
// settled the move, so re-activation is deferred by this delay.
const REFOCUS_DELAY_MS = 75;

// Keybinding table: schema key -> handler name and direction.
// Data-driven so adding a binding never means repeating an addKeybinding block.
const DIRECTION_BY_KEY = {
    'swap-up': Meta.DisplayDirection.UP,
    'swap-down': Meta.DisplayDirection.DOWN,
    'swap-left': Meta.DisplayDirection.LEFT,
    'swap-right': Meta.DisplayDirection.RIGHT,
    'focus-up': Meta.DisplayDirection.UP,
    'focus-down': Meta.DisplayDirection.DOWN,
    'focus-left': Meta.DisplayDirection.LEFT,
    'focus-right': Meta.DisplayDirection.RIGHT,
};

const SWAP_KEYS = ['swap-up', 'swap-down', 'swap-left', 'swap-right'];
const FOCUS_KEYS = ['focus-up', 'focus-down', 'focus-left', 'focus-right'];
const SELECT_KEYS = ['select-up', 'select-down'];

const SELECT_OFFSET_BY_KEY = {
    'select-up': 1,
    'select-down': -1,
};

export default class MultiMonitorSwapExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._boundKeys = [];
        this._refocusTimeoutId = 0;

        for (const key of SWAP_KEYS)
            this._addKeybinding(key, () => this._swapWindow(key));

        for (const key of FOCUS_KEYS)
            this._addKeybinding(key, () => this._focusWindow(key));

        for (const key of SELECT_KEYS)
            this._addKeybinding(key, () => this._selectWindow(key));
    }

    disable() {
        for (const key of this._boundKeys)
            Main.wm.removeKeybinding(key);
        this._boundKeys = [];

        if (this._refocusTimeoutId) {
            GLib.Source.remove(this._refocusTimeoutId);
            this._refocusTimeoutId = 0;
        }

        this._settings = null;
    }

    _addKeybinding(key, handler) {
        Main.wm.addKeybinding(
            key,
            this._settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.ALL,
            handler
        );
        this._boundKeys.push(key);
    }

    /** Windows on the active workspace that are valid swap/focus targets. */
    _listEligibleWindows() {
        const workspace = global.workspace_manager.get_active_workspace();
        return workspace.list_windows().filter(w =>
            !w.is_hidden() && w.get_wm_class() !== IGNORED_WM_CLASS);
    }

    _getFocusedWindow(windows) {
        return windows.find(w => w.has_focus()) ?? null;
    }

    /**
     * Resolves the focused window plus the topmost window on the neighbouring
     * monitor in the given direction. Returns null when there is nothing
     * focused or no neighbouring monitor.
     */
    _getSwapContext(key) {
        const windows = this._listEligibleWindows();
        const focusedWindow = this._getFocusedWindow(windows);
        if (!focusedWindow)
            return null;

        const currentMonitor = focusedWindow.get_monitor();
        const nextMonitor = global.display.get_monitor_neighbor_index(
            currentMonitor, DIRECTION_BY_KEY[key]);

        // -1 means there is no monitor in that direction.
        if (nextMonitor < 0)
            return null;

        const nextWindows = windows.filter(w => w.get_monitor() === nextMonitor);
        const stacked = global.display.sort_windows_by_stacking(nextWindows);
        const inertWindow = stacked.length ? stacked[stacked.length - 1] : null;

        return {focusedWindow, currentMonitor, inertWindow, nextMonitor};
    }

    _focusWindow(key) {
        const context = this._getSwapContext(key);
        if (!context?.inertWindow)
            return;

        context.inertWindow.activate(global.get_current_time());
    }

    _swapWindow(key) {
        const context = this._getSwapContext(key);
        if (!context)
            return;

        const {focusedWindow, currentMonitor, inertWindow, nextMonitor} = context;

        if (!inertWindow) {
            // Nothing to trade places with: just move and re-focus once the
            // compositor has applied the move.
            focusedWindow.move_to_monitor(nextMonitor);
            this._queueRefocus(focusedWindow);
            return;
        }

        inertWindow.move_to_monitor(currentMonitor);
        focusedWindow.move_to_monitor(nextMonitor);
    }

    _queueRefocus(window) {
        if (this._refocusTimeoutId)
            GLib.Source.remove(this._refocusTimeoutId);

        this._refocusTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT, REFOCUS_DELAY_MS, () => {
                this._refocusTimeoutId = 0;
                window.activate(global.get_current_time());
                return GLib.SOURCE_REMOVE;
            });
    }

    /** Cycles focus through the windows already on the current monitor. */
    _selectWindow(key) {
        const windows = this._listEligibleWindows();
        const focusedWindow = this._getFocusedWindow(windows);
        if (!focusedWindow)
            return;

        const currentMonitor = focusedWindow.get_monitor();
        const currentWindows = windows.filter(
            w => w.get_monitor() === currentMonitor);
        if (currentWindows.length < 2)
            return;

        const currentIndex = currentWindows.findIndex(
            w => w.get_id() === focusedWindow.get_id());
        if (currentIndex < 0)
            return;

        const offset = SELECT_OFFSET_BY_KEY[key];
        const count = currentWindows.length;
        // Wrap around in both directions.
        const nextIndex = (currentIndex + offset + count) % count;

        currentWindows[nextIndex].activate(global.get_current_time());
    }
}
