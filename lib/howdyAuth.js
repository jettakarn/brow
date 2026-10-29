//
// Passive Howdy listener. Watches pam_howdy's journal lines.
// Does not enroll a face, open the camera, or call compare.py.
//
// The island animation those lines drive is adapted from Glance
// (Jonathan Zhou, MIT). See media/howdy/LICENSE-GLANCE.
//

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

/**
 * Map one journal message (`journalctl -o cat`) to an auth phase.
 * @param {string} line
 * @returns {'start'|'success'|'failure'|null}
 */
export function classifyHowdyLine(line) {
    const text = String(line ?? '').trim();
    if (!text || text.startsWith('Skipped authentication'))
        return null;
    if (text.startsWith('Attempting facial authentication'))
        return 'start';
    if (text === 'Login approved' || text.startsWith('Login approved'))
        return 'success';
    if (text.startsWith('Failure,'))
        return 'failure';
    return null;
}

/** True while PAM's compare.py is running. That process opens the camera. */
function _compareIsRunning() {
    let enumerator;
    try {
        enumerator = Gio.File.new_for_path('/proc').enumerate_children(
            'standard::name',
            Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
            null
        );
    } catch (e) {
        return false;
    }

    let found = false;
    let info = enumerator.next_file(null);
    while (info) {
        const pid = info.get_name();
        info = enumerator.next_file(null);
        if (!/^[0-9]+$/.test(pid))
            continue;
        try {
            const [, commBytes] = Gio.File.new_for_path(`/proc/${pid}/comm`).load_contents(null);
            const comm = new TextDecoder().decode(commBytes);
            if (!comm.startsWith('python') && !comm.includes('compare'))
                continue;
            const [, cmdBytes] = Gio.File.new_for_path(`/proc/${pid}/cmdline`).load_contents(null);
            if (new TextDecoder().decode(cmdBytes).includes('compare.py')) {
                found = true;
                break;
            }
        } catch (e) {
            // kernel thread or a process that exited mid-scan
        }
    }
    try {
        enumerator.close(null);
    } catch (e) {
        // ignore
    }
    return found;
}

/**
 * Follows new pam_howdy syslog lines. Historical lines are not replayed.
 * @param {{ onStart?: Function, onSuccess?: Function, onFail?: Function, onCompareExit?: Function }} callbacks
 */
export class HowdyAuthMonitor {
    constructor(callbacks = {}) {
        this._cb = callbacks;
        this._proc = null;
        this._stream = null;
        this._cancellable = null;
        this._pollId = 0;
        this._compareActive = false;
    }

    start() {
        if (this._proc)
            return;

        this._cancellable = new Gio.Cancellable();
        try {
            this._proc = Gio.Subprocess.new(
                ['journalctl', '-t', 'pam_howdy', '-f', '-n', '0', '-o', 'cat'],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE
            );
        } catch (e) {
            console.error('Brow: howdy journal follow failed to start:', e.message ?? e);
            this._proc = null;
            this._cancellable = null;
            this._pollCompare();
            return;
        }

        this._stream = new Gio.DataInputStream({
            base_stream: this._proc.get_stdout_pipe(),
            close_base_stream: true,
        });
        this._readLine();
        this._pollCompare();
    }

    _pollCompare() {
        if (this._pollId)
            return;
        this._pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
            const running = _compareIsRunning();
            if (running && !this._compareActive) {
                this._compareActive = true;
                this._cb.onStart?.();
            } else if (!running && this._compareActive) {
                this._compareActive = false;
                this._cb.onCompareExit?.();
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    stop() {
        if (this._pollId) {
            GLib.source_remove(this._pollId);
            this._pollId = 0;
        }
        this._compareActive = false;
        try {
            this._cancellable?.cancel();
        } catch (e) {
            // ignore
        }
        this._cancellable = null;
        try {
            this._proc?.force_exit();
        } catch (e) {
            // already gone
        }
        this._proc = null;
        try {
            this._stream?.close(null);
        } catch (e) {
            // ignore
        }
        this._stream = null;
    }

    _readLine() {
        const stream = this._stream;
        const cancellable = this._cancellable;
        if (!stream || !cancellable || cancellable.is_cancelled())
            return;

        stream.read_line_async(GLib.PRIORITY_DEFAULT, cancellable, (src, result) => {
            if (src !== this._stream)
                return;
            let line = null;
            try {
                [line] = src.read_line_finish_utf8(result);
            } catch (e) {
                if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    console.debug?.('Brow: howdy journal read ended', e.message ?? e);
                return;
            }
            if (line == null)
                return;
            this._dispatch(line);
            this._readLine();
        });
    }

    _dispatch(line) {
        const phase = classifyHowdyLine(line);
        switch (phase) {
        case 'start':
            this._cb.onStart?.();
            break;
        case 'success':
            this._cb.onSuccess?.();
            break;
        case 'failure':
            this._cb.onFail?.(String(line).trim());
            break;
        default:
            break;
        }
    }
}
