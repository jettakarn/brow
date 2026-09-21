import GLib from 'gi://GLib';

/** Timed / modal island overlays. Higher number wins. */
export const HudKind = {
    AUTH: 'auth',
    VOLUME: 'volume',
    BATTERY: 'battery',
};

export const HUD_PRIORITY = {
    [HudKind.AUTH]: 100,
    [HudKind.VOLUME]: 50,
    [HudKind.BATTERY]: 10,
};

function nowMs() {
    return GLib.get_monotonic_time() / 1000;
}

/**
 * Priority queue for island HUDs.
 * - Higher priority preempts lower; preempted entries stay until expiry.
 * - holdMs null => stays until dismiss (e.g. auth).
 * - request() on an existing kind refreshes payload and hold (debounce).
 */
export function createHudQueue({ onActiveChanged } = {}) {
    const entries = new Map();
    let active = null;
    let timerId = 0;

    function clearTimer() {
        if (timerId) {
            GLib.source_remove(timerId);
            timerId = 0;
        }
    }

    function pruneExpired(now = nowMs()) {
        for (const [kind, entry] of entries) {
            if (entry.expiresAt != null && entry.expiresAt <= now)
                entries.delete(kind);
        }
    }

    function pickTop() {
        let best = null;
        let bestPri = -1;
        for (const kind of entries.keys()) {
            const pri = HUD_PRIORITY[kind] ?? 0;
            if (pri > bestPri) {
                bestPri = pri;
                best = kind;
            }
        }
        return best;
    }

    function armTimer(kind) {
        clearTimer();
        const entry = entries.get(kind);
        if (!entry || entry.expiresAt == null)
            return;

        const ms = Math.max(1, Math.ceil(entry.expiresAt - nowMs()));
        timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            timerId = 0;
            entries.delete(kind);
            reconcile();
            return GLib.SOURCE_REMOVE;
        });
    }

    function reconcile() {
        pruneExpired();
        const next = pickTop();
        if (next !== active) {
            const prev = active;
            active = next;
            const payload = active ? entries.get(active)?.payload ?? null : null;
            try {
                onActiveChanged?.(active, prev, payload);
            } catch (e) {
                console.error('HudQueue onActiveChanged failed:', e);
            }
        }
        if (active)
            armTimer(active);
        else
            clearTimer();
    }

    return {
        get active() {
            return active;
        },

        has(kind) {
            return entries.has(kind);
        },

        getPayload(kind) {
            return entries.get(kind)?.payload ?? null;
        },

        /**
         * @param {string} kind
         * @param {{ payload?: any, holdMs?: number|null }} [opts]
         *        holdMs omitted/null => until dismiss; number => auto-dismiss
         */
        request(kind, { payload = null, holdMs = null } = {}) {
            const expiresAt = holdMs == null ? null : nowMs() + holdMs;
            entries.set(kind, { payload, expiresAt });
            reconcile();
        },

        /** Update payload for an existing entry without changing expiry. */
        updatePayload(kind, payload) {
            const entry = entries.get(kind);
            if (!entry)
                return;
            entry.payload = payload;
            if (active === kind) {
                try {
                    onActiveChanged?.(active, active, payload);
                } catch (e) {
                    console.error('HudQueue payload update failed:', e);
                }
            }
        },

        dismiss(kind) {
            if (!entries.has(kind))
                return;
            entries.delete(kind);
            reconcile();
        },

        /** Drop all timed HUDs (keep auth if present). */
        dismissTimed() {
            let changed = false;
            for (const kind of [...entries.keys()]) {
                if (kind === HudKind.AUTH)
                    continue;
                entries.delete(kind);
                changed = true;
            }
            if (changed)
                reconcile();
        },

        clear() {
            entries.clear();
            clearTimer();
            const prev = active;
            active = null;
            if (prev) {
                try {
                    onActiveChanged?.(null, prev, null);
                } catch (e) {
                    console.error('HudQueue clear failed:', e);
                }
            }
        },

        destroy() {
            this.clear();
        },
    };
}
