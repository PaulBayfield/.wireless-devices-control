"""How output looks: colours, aligned rows and the little text meters.

Presentation only, and shared -- the CLI prints through it, and so do the
status rows a device module declares. Colour is decided once, when this
module is first imported: a terminal gets ANSI escapes, a pipe or a file
gets empty strings, so redirected output stays clean without every call site
checking.
"""

import sys

if sys.stdout.isatty():
    if sys.platform == "win32":
        # Ask the console for ANSI handling; harmless if it is already on.
        try:
            import ctypes

            _kernel32 = ctypes.windll.kernel32
            _kernel32.SetConsoleMode(_kernel32.GetStdHandle(-11), 7)
        except Exception:
            pass
    RESET, BOLD, DIM = "\033[0m", "\033[1m", "\033[2m"
    CYAN, GREEN, YELLOW, RED, MAGENTA = (
        "\033[36m", "\033[32m", "\033[33m", "\033[31m", "\033[35m")
else:
    RESET = BOLD = DIM = CYAN = GREEN = YELLOW = RED = MAGENTA = ""

#: Status labels worth colouring. Everything else prints plain.
ROW_COLORS = {"Model": MAGENTA, "Mode": CYAN, "Source": CYAN, "Name": BOLD,
              "Firmware": DIM, "Serial": DIM, "MAC": DIM}

#: Words accepted for ``True`` by :func:`as_bool`.
TRUE_WORDS = ("on", "true", "yes", "1", "enable", "enabled")
#: Words accepted for ``False`` by :func:`as_bool`.
FALSE_WORDS = ("off", "false", "no", "0", "disable", "disabled")


def row(label, value, color=""):
    """Print one aligned ``label  value`` line."""
    print("  %s%-12s%s %s%s%s" % (DIM, label, RESET, color, value, RESET))


def status_row(label, value):
    """Print one row of the status screen, coloured by what it is."""
    color = ROW_COLORS.get(label, "")
    if label == "Battery" and str(value).endswith("%"):
        color = battery_color(int(str(value)[:-1]))
    row(label, value, color)


def battery_color(percent):
    """Green, amber or red, by how much charge is left."""
    return GREEN if percent > 30 else YELLOW if percent > 10 else RED


def bar(filled, total):
    """A plain text meter, e.g. ``'###......'``.

    Written with ``#`` and ``.`` rather than block characters so it survives
    a console that is not in UTF-8, which Windows often is not.
    """
    filled = max(0, min(total, filled))
    return "#" * filled + "." * (total - filled)


def as_bool(word, what):
    """Read an on/off argument, or exit explaining what was expected.

    :param word: the argument as typed.
    :param what: the setting being changed, for the error message.
    :raises SystemExit: on anything that is not an obvious yes or no.
    """
    if word.lower() in TRUE_WORDS:
        return True
    if word.lower() in FALSE_WORDS:
        return False
    raise SystemExit("%s takes 'on' or 'off', got %r" % (what, word))


def on_off(value):
    """``'on'``, ``'off'``, or ``'unknown'`` for ``None``."""
    return "unknown" if value is None else ("on" if value else "off")
