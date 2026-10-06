import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {
    appName,
    itemTitle,
    readItems,
    writeItems,
} from './lib/honeycombItems.js';

function chooseApplication(parent, onPick) {
    const dialog = Gtk.AppChooserDialog.new_for_content_type(
        parent,
        Gtk.DialogFlags.MODAL | Gtk.DialogFlags.DESTROY_WITH_PARENT,
        'application/octet-stream');
    dialog.set_heading('Choose Application');

    const widget = dialog.get_widget();
    if (widget) {
        widget.set_show_all(true);
        widget.set_show_other(true);
        widget.refresh?.();
    }

    dialog.connect('response', (dlg, response) => {
        if (response === Gtk.ResponseType.OK) {
            const info = dlg.get_app_info();
            const id = info?.get_id?.();
            if (id)
                onPick(id);
        }
        dlg.destroy();
    });
    dialog.present();
}

function suffixButton(iconName) {
    return new Gtk.Button({
        icon_name: iconName,
        valign: Gtk.Align.CENTER,
        has_frame: false,
    });
}

function buildHoneycombPage(window, settings) {
    const page = new Adw.PreferencesPage({
        title: 'Honeycomb',
        icon_name: 'view-grid-symbolic',
    });
    const group = new Adw.PreferencesGroup({
        title: 'Dots',
        description: 'Each dot is an application or a website. The island shows them as a honeycomb. Websites use the site icon.',
    });
    page.add(group);

    const add = new Gtk.Button({
        icon_name: 'list-add-symbolic',
        valign: Gtk.Align.CENTER,
    });
    group.set_header_suffix(add);

    let suppress = false;
    let stamping = false;
    const rows = [];
    const commit = items => {
        suppress = true;
        try {
            writeItems(settings, items);
        } finally {
            suppress = false;
        }
    };
    const clearRows = () => {
        while (rows.length) {
            const row = rows.pop();
            try {
                group.remove(row);
            } catch (e) {
                // ignore
            }
        }
    };

    const fill = () => {
        stamping = true;
        try {
        clearRows();
        const items = readItems(settings);
        items.forEach((item, index) => {
            const row = new Adw.ExpanderRow({
                title: itemTitle(item),
                subtitle: item.type === 'url' ? 'Website' : 'Application',
            });

            const up = suffixButton('go-up-symbolic');
            const down = suffixButton('go-down-symbolic');
            const remove = suffixButton('user-trash-symbolic');
            up.sensitive = index > 0;
            down.sensitive = index < items.length - 1;
            row.add_suffix(up);
            row.add_suffix(down);
            row.add_suffix(remove);

            const typeRow = new Adw.ComboRow({
                title: 'Type',
                model: (() => {
                    const model = new Gtk.StringList();
                    model.append('Application');
                    model.append('Website');
                    return model;
                })(),
                selected: item.type === 'url' ? 1 : 0,
            });
            row.add_row(typeRow);

            const appRow = new Adw.ActionRow({
                title: 'Application',
                subtitle: appName(item.app) || item.app || 'Not chosen',
                visible: item.type !== 'url',
            });
            const choose = new Gtk.Button({
                label: 'Choose',
                valign: Gtk.Align.CENTER,
            });
            appRow.add_suffix(choose);
            appRow.activatable_widget = choose;
            row.add_row(appRow);

            const urlRow = new Adw.EntryRow({
                title: 'URL',
                text: item.type === 'url' ? (item.url || '') : '',
                visible: item.type === 'url',
            });
            row.add_row(urlRow);

            const current = () => readItems(settings);

            up.connect('clicked', () => {
                const next = current();
                if (index <= 0 || index >= next.length)
                    return;
                const [moved] = next.splice(index, 1);
                next.splice(index - 1, 0, moved);
                commit(next);
                fill();
            });
            down.connect('clicked', () => {
                const next = current();
                if (index < 0 || index >= next.length - 1)
                    return;
                const [moved] = next.splice(index, 1);
                next.splice(index + 1, 0, moved);
                commit(next);
                fill();
            });
            remove.connect('clicked', () => {
                const next = current();
                next.splice(index, 1);
                commit(next);
                fill();
            });
            choose.connect('clicked', () => {
                chooseApplication(window, id => {
                    const next = current();
                    if (!next[index])
                        return;
                    next[index] = { type: 'app', app: id };
                    commit(next);
                    fill();
                });
            });
            typeRow.connect('notify::selected', () => {
                if (stamping)
                    return;
                const next = current();
                if (!next[index])
                    return;
                const wantUrl = typeRow.selected === 1;
                if (wantUrl && next[index].type === 'url')
                    return;
                if (!wantUrl && next[index].type !== 'url')
                    return;
                next[index] = wantUrl
                    ? { type: 'url', url: next[index].url || 'https://' }
                    : { type: 'app', app: next[index].app || '' };
                commit(next);
                fill();
            });
            urlRow.connect('notify::text', () => {
                if (stamping)
                    return;
                const next = current();
                if (!next[index] || next[index].type !== 'url')
                    return;
                const text = urlRow.text || '';
                if ((next[index].url || '') === text)
                    return;
                next[index] = { type: 'url', url: text };
                row.title = itemTitle(next[index]);
                commit(next);
            });

            group.add(row);
            rows.push(row);
        });
        } finally {
            stamping = false;
        }
    };

    add.connect('clicked', () => {
        const next = readItems(settings);
        next.push({ type: 'app', app: '' });
        commit(next);
        fill();
    });

    settings.connect('changed::honeycomb-items', () => {
        if (!suppress)
            fill();
    });

    fill();
    return page;
}

export default class BrowPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        window.add(buildHoneycombPage(window, this.getSettings()));
    }
}
