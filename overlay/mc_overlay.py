"""Mission Control overlay: a slim pill at the top centre of the screen.

Shows while Claude is not the window in use; hover to expand, click
"Open Claude" to bring it back. Reads the status file the mod writes.
Windows only (uses the Win32 API through ctypes); exits quietly elsewhere.
Run with `pythonw mc_overlay.py` so no console window opens.
"""

from __future__ import annotations

import json
import os
import socket
import sys
import time

STATUS = os.path.join(os.path.expanduser('~'), '.claude', 'mission-control', 'status.json')
LOCK_PORT = 47213  # one overlay at a time, across every session

# Palette: Windows 11 dark surfaces with the mod's zone accents.
BG = '#1c1c21'
BG_HOVER = '#232329'
EDGE = '#34343c'
TEXT = '#ececf1'
DIM = '#8d8d98'
ZONE_COLOR = {'ok': '#4ade80', 'watch': '#facc15', 'warn': '#ff8700', 'high': '#f87171', 'danger': '#f87171'}


# ── Pure logic (tested) ─────────────────────────────────────────────────────
def zone(pct: float) -> str:
    if pct >= 95:
        return 'danger'
    if pct >= 90:
        return 'high'
    if pct >= 80:
        return 'warn'
    if pct >= 60:
        return 'watch'
    return 'ok'


def top_pct(meter: dict | None) -> float:
    if not meter:
        return 0
    vals = [meter.get('ctxPct')] + [(meter.get(k) or {}).get('pct') for k in ('fiveHour', 'weekly')]
    return max([v for v in vals if isinstance(v, (int, float))] or [0])


def _pct(v) -> str:
    return '–' if not isinstance(v, (int, float)) else f'{round(v)}%'


def _live(status: dict) -> list[dict]:
    return [a for a in status.get('agents') or [] if a.get('status') in ('pending', 'running', 'waiting')]


def summary_line(status: dict) -> str:
    m = status.get('meter')
    if not m:
        return 'Mission Control · waiting for Claude'
    n = len(_live(status))
    agents = f' · {n} agent{"s" if n != 1 else ""}' if n else ''
    return f"Context {_pct(m.get('ctxPct'))} · 5h {_pct((m.get('fiveHour') or {}).get('pct'))} · Week {_pct((m.get('weekly') or {}).get('pct'))}{agents}"


def _bar(p) -> str:
    filled = 0 if not isinstance(p, (int, float)) else max(0, min(5, round(p / 20)))
    return '▰' * filled + '▱' * (5 - filled)


def detail_lines(status: dict) -> list[str]:
    m = status.get('meter') or {}
    lines = []
    for label, p in (('Context', m.get('ctxPct')), ('5-hour ', (m.get('fiveHour') or {}).get('pct')), ('Weekly ', (m.get('weekly') or {}).get('pct'))):
        lines.append(f'{label} {_bar(p)} {_pct(p)}')
    route = status.get('route')
    if route:
        lines.append(f"Model  {route.get('model')} · {route.get('effort')}")
    now_ms = time.time() * 1000
    if status.get('midnight'):
        left = max(0, round((status['midnight']['endsAt'] - now_ms) / 60000))
        lines.append(f'🌙 Midnight · {left // 60}h{left % 60}m left')
    if status.get('god'):
        left = max(0, round((status['god']['endsAt'] - now_ms) / 60000))
        lines.append(f'⚡ God mode · {left}m left')
    if status.get('limited'):
        lines.append('⏸ Limit reached · auto-resume armed')
    lines += [f"• {a.get('description', '')}" for a in _live(status)][:4]
    return lines


def is_stale(mtime: float, now: float | None = None) -> bool:
    """A status file untouched for 15 minutes means no Claude session is running."""
    return (now if now is not None else time.time()) - mtime > 15 * 60


def read_status() -> tuple[dict, float]:
    try:
        with open(STATUS, encoding='utf-8') as f:
            return json.load(f), os.path.getmtime(STATUS)
    except (OSError, ValueError):
        return {}, 0.0


# ── Window (Windows only) ───────────────────────────────────────────────────
def main() -> None:
    if sys.platform != 'win32':
        return
    try:
        lock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        lock.bind(('127.0.0.1', LOCK_PORT))
    except OSError:
        return  # another overlay is already up

    import ctypes
    import tkinter as tk
    from ctypes import wintypes

    user32 = ctypes.windll.user32
    gdi32 = ctypes.windll.gdi32
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
    except Exception:
        pass

    def window_title(h) -> str:
        buf = ctypes.create_unicode_buffer(256)
        user32.GetWindowTextW(h, buf, 256)
        return buf.value

    def claude_window():
        found = []
        proc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

        def each(h, _):
            if window_title(h) == 'Claude' and user32.IsWindowVisible(h):
                found.append(h)
            return True

        user32.EnumWindows(proc(each), 0)
        return found[0] if found else None

    root = tk.Tk()
    root.title('Mission Control')
    root.overrideredirect(True)
    root.attributes('-topmost', True)
    root.attributes('-alpha', 0.97)
    root.configure(bg=BG)

    W, H, HX = 380, 32, 196
    R = 14
    font = ('Segoe UI Variable Text', 10)
    font_small = ('Segoe UI Variable Text', 9)
    state = {'open': False, 'leave': None, 'status': {}}

    frame = tk.Frame(root, bg=BG, highlightthickness=1, highlightbackground=EDGE)
    frame.pack(fill='both', expand=True)
    head = tk.Frame(frame, bg=BG)
    head.pack(fill='x', padx=14, pady=(6, 4))
    dot = tk.Label(head, text='●', fg=ZONE_COLOR['ok'], bg=BG, font=font)
    dot.pack(side='left')
    line = tk.Label(head, text='Mission Control', fg=TEXT, bg=BG, font=font, anchor='w')
    line.pack(side='left', padx=(6, 0))
    body = tk.Frame(frame, bg=BG)
    details = tk.Label(body, text='', fg=DIM, bg=BG, font=font_small, justify='left', anchor='nw')
    details.pack(fill='both', expand=True, padx=16)

    def open_claude():
        h = claude_window()
        if h:
            user32.ShowWindow(h, 9)  # SW_RESTORE
            user32.SetForegroundWindow(h)

    button = tk.Label(body, text='Open Claude  ↗', fg=TEXT, bg=EDGE, font=font_small, padx=10, pady=3, cursor='hand2')
    button.pack(anchor='e', padx=14, pady=(4, 8))
    button.bind('<Button-1>', lambda _e: open_claude())

    def shape(height: int) -> None:
        x = (root.winfo_screenwidth() - W) // 2
        root.geometry(f'{W}x{height}+{x}+0')
        root.update_idletasks()
        hwnd = user32.GetParent(root.winfo_id())
        # Rounded region that starts above the screen edge: only the bottom corners show.
        rgn = gdi32.CreateRoundRectRgn(0, -R, W + 1, height + 1, R * 2, R * 2)
        user32.SetWindowRgn(hwnd, rgn, True)

    def expand(_e=None):
        if state['leave']:
            root.after_cancel(state['leave'])
            state['leave'] = None
        if not state['open']:
            state['open'] = True
            body.pack(fill='both', expand=True)
            for w in (frame, head, dot, line, body, details):
                w.configure(bg=BG_HOVER)
            shape(HX)

    def collapse():
        state['open'] = False
        state['leave'] = None
        body.pack_forget()
        for w in (frame, head, dot, line, body, details):
            w.configure(bg=BG)
        shape(H)

    def leave(_e=None):
        if state['leave'] is None:
            state['leave'] = root.after(450, collapse)

    root.bind('<Enter>', expand)
    root.bind('<Leave>', leave)

    def poll():
        status, mtime = read_status()
        if is_stale(mtime):
            root.withdraw()
        else:
            state['status'] = status
            z = zone(top_pct(status.get('meter')))
            dot.configure(fg=ZONE_COLOR[z])
            line.configure(text=summary_line(status))
            details.configure(text='\n'.join(detail_lines(status)))
            fg = user32.GetForegroundWindow()
            in_claude = window_title(fg) == 'Claude'
            if in_claude and not state['open']:
                root.withdraw()
            else:
                root.deiconify()
                root.attributes('-topmost', True)
        root.after(1500, poll)

    shape(H)
    poll()
    root.mainloop()


if __name__ == '__main__':
    main()
