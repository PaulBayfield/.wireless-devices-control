# BoseControl

Dependency-free Python control for Bose hardware. It opens a Bluetooth
RFCOMM socket and speaks BMAP, the same protocol the Bose app uses — no app,
no cloud, no account.

```console
$ uv sync
$ uv run main.py
```

One entry point drives every supported model. It finds whatever is
connected, loads the class that drives it, and offers the commands that
model actually has:

```
  Model       Bose SL Micro 2 (billie)
  Name        Polo's Speakers
  Battery     90%
  Volume      ###########.................... 11/31
  Source      bluetooth from E0:AD:47:20:7E:2B
  EQ          -2/+3/+4 (bass/mid/treble)
  Auto-off    60 min
```

## Supported devices

| Model | Key | PID | Channel | Status |
| --- | --- | --- | --- | --- |
| QuietComfort 45 headphones | `qc45` | `0x4039` | 8 | Reads, volume and transport controls verified, plus a ModeConfig write |
| SoundLink Micro 2 speaker | `micro2` | `0xBC58` | 1 | Reads, volume, power off and pairing verified; mapped from scratch |

`uv run main.py devices` lists what is paired and whether a class exists for it.

With several devices connected, plain `status` prints all of them in turn —
it only reads, so there is nothing to disambiguate. Every other command acts
on one device, so pick it with `--device qc45` or `--mac`. A device that goes
quiet mid-sweep is reported in place and the rest still print.

## Requirements

- [`uv`](https://docs.astral.sh/uv/), which supplies the Python. No runtime
  packages are installed: the client is standard library from top to bottom,
  and `uv sync` only creates the environment — the project runs from its own
  tree rather than being built into a wheel.
- The device paired **and connected** in Settings → Bluetooth & devices
  (Linux: through `bluetoothctl`).

BMAP rides the same Bluetooth link as audio, so a device that is merely
paired cannot be reached. If it is attached to your phone, disconnect it
there first. macOS is not supported: RFCOMM there needs IOBluetooth via
PyObjC.

## Commands

Shared, and shown only for a model that has the feature behind them:

```bash
uv run main.py                     # status (the default)
uv run main.py info                # model, serial, addresses, platform
uv run main.py battery             # just the number, for status bars
uv run main.py standby             # auto-off timer, in minutes
uv run main.py paired              # devices this one remembers
uv run main.py volume 8            # see below
uv run main.py pause               # also play, stop, next, prev
uv run main.py control             # what this device accepts
uv run main.py source              # what it is playing, and from where
uv run main.py eq 3 0 -2           # bass / mid / treble, each -10..+10
uv run main.py name "Polo's QC45"  # rename over Bluetooth
uv run main.py multipoint on
uv run main.py prompts off
uv run main.py buttons Shortcut long_press ANC
uv run main.py pair                # pairing mode ('pair off' to leave)
uv run main.py off                 # power down
uv run main.py raw 00 05 01 00     # hand-written BMAP bytes
uv run main.py devices             # what is paired, no connection needed
uv run main.py nowplaying          # what this PC is playing, and who hears it
uv run main.py probe --mac ...     # map an unknown device, read-only
uv run main.py replay sweep.json   # check a model against a recording
uv run main.py help
```

QuietComfort 45 adds `cnc`, `wind`, `mode`, `modes`, `quiet`, `aware`,
`profile` and `sidetone`.

Options before the command: `--device <key>`, `--mac <address>`,
`--channel <n>`, `--timeout <s>`. Every setting command prints its current
value when called with no argument.

Volume will not go above **15** without `--loud` on the end. A write lands
instantly and these go loud enough to hurt — on headphones especially — so
the ceiling makes a mistyped number harmless. Relative moves (`volume +3`,
`up`, `down`) clamp to it rather than refusing.

**BMAP carries no track metadata.** A full sweep of a QC45 — 149 functions
across 13 blocks — turns up no title, artist or album anywhere; a device will
only tell you which *address* it is playing from. `nowplaying` reads the
track from the Windows media session instead and names the Bose devices
attached right now.

## How it is put together

```
main.py           the entry point
src/
  __init__.py     the public surface: connect(), Device, the errors
  output.py       colours, aligned rows, text meters
  media.py        what this PC is playing, via the Windows media session
  protocol/       BMAP itself: codec, errors, vocabulary, parsers, builders
  devices/        the models, and everything they have in common
  transport/      RFCOMM, discovery, and the two platform backends
  cli/            argument parsing, the command registry, the commands
  tools/          probe an unknown device, replay a recorded sweep
docs/             Sphinx documentation
```

The split that matters: **addresses and payload shapes are data, sequences
of exchanges are code.** A model declares which address holds the battery,
which parser reads it, which builder writes it, and `Device` turns that into
methods. A model that declares `battery` gets `battery()` and the `battery`
command; one that does not gets a clear refusal instead of a timeout. Only
genuine behaviour differences, like the QC45 storing its CNC level inside a
mode slot, are written as code on that model's own subclass.

Inside `devices/`, four files keep a model file short:

| File | What it holds |
| --- | --- |
| `base.py` | `Device`, the parent class every model inherits |
| `features.py` | one method per thing a device can be asked |
| `catalog.py` | the addresses models share, written once |
| `status.py` | the status screen, one named row at a time |

`catalog.COMMON` is the set every Bose device mapped so far answers
identically, which is why `micro2.py` declares two addresses and inherits
the rest.

## Adding a device

1. **Map it.** `uv run main.py probe --mac <address> --json captures/new.json`
   sweeps an unknown device read-only — GET is never authentication-gated
   and changes nothing — and prints every address that answers.
2. **Write the class.** Subclass `Device`, give it the identity attributes,
   and build `FEATURES` with `catalog.features()`, naming only what the
   model adds to or differs from `COMMON`.
3. **Register it** with one line in `devices/__init__.py`, keyed by the
   product id `[0.3]` reports.
4. **Check it without the hardware.** `uv run main.py replay captures/new.json
   status info paired` feeds the recorded sweep back through the class, so
   parsers and the status screen can be checked against real bytes while the
   device is asleep.

Discovery, the CLI and the help text all read from the registry, so nothing
else changes.

## Notes on the protocol

A BMAP packet is four header bytes plus a payload:

```
[function_block, function, flags, payload_length, ...payload]
```

`flags` carries the operator in its low nibble. Bose gates SET (operator 0)
behind cloud-mediated authentication, but GET (1), SETGET (2) and START (5)
are unauthenticated on the Settings, Control and AudioModes blocks — which
covers every user-facing setting. Nothing here breaks encryption or replays
traffic.

Windows only reaches a channel the device advertises over SDP and is racy
about reusing one, so session setup and the opening GET are retried; reads
are safe to retry, writes are not and never are. Opening the socket gets a
longer deadline than an exchange does, because waking an idle device takes
several seconds.

## Documentation

```console
$ uv sync --group docs
$ uv run sphinx-build -b html docs docs/_build/html
```

Then open `docs/_build/html/index.html`. The full protocol notes, the
architecture, the per-model mapping evidence and the complete API reference
are all there.

## Licence

MIT.
