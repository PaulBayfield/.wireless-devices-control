# Wireless Devices Control

Control my wireless devices and keep an eye on their batteries, without any
vendor app. Every protocol here was reverse engineered and is spoken
directly: BMAP over Bluetooth RFCOMM for Bose, HID++ 2.0 through the
Lightspeed receiver for Logitech. No app, no cloud, no account.

```console
$ uv sync
$ uv run __main__.py
  Paul's Speakers                        micro2    not connected
  Paul's Headphones                      qc45      70%
  G502 LIGHTSPEED Wireless Gaming Mouse  g502      49% (discharging, 3807 mV)
```

Three pieces, one device layer:

```
 browser ──HTTPS──▶ Next.js frontend ──HTTP + token──▶ Sanic API ──▶ Bluetooth / USB receiver
                    (your server, Docker)              (the PC the devices are connected to)
```

- **The API** (`src/api/`) owns the hardware: it polls every battery in the
  background, keeps the last reading of each device in memory, and exposes
  settings and actions. It runs natively on the machine the devices are
  connected to, since Docker cannot reach a Bluetooth radio.
- **The frontend** (`src/frontend/`) is a Next.js app with a login. It calls
  the API from its server, so the token never reaches the browser.
- **The command line** is the debugging tool for the device layer both of
  them share.

## Supported devices

| Device | Vendor | Key | Link | Status |
| --- | --- | --- | --- | --- |
| QuietComfort 45 headphones | Bose | `qc45` | Bluetooth, RFCOMM channel 8 | Reads, volume and transport controls verified, plus a ModeConfig write |
| SoundLink Micro 2 speaker | Bose | `micro2` | Bluetooth, RFCOMM channel 1 | Reads, volume, power off and pairing verified; mapped from scratch |
| G502 LIGHTSPEED mouse | Logitech | `g502` | Lightspeed receiver `046D:C539` | Battery, DPI, report rate, LEDs, onboard mode |

## Requirements

- [`uv`](https://docs.astral.sh/uv/), which supplies Python 3.14. The only
  runtime dependency is `hidapi`, for the Logitech receiver; the Bose side is
  standard library. `uv sync` creates the environment, and the project runs
  from its own tree rather than being built into a wheel.
- **Bose:** the device paired **and connected** in Settings → Bluetooth &
  devices (Linux: through `bluetoothctl`). BMAP rides the same link as
  audio, so a device that is merely paired cannot be reached; if it is
  attached to your phone, disconnect it there first. macOS is not supported.
- **Logitech:** the receiver plugged in and the mouse awake. In host mode G
  HUB may overwrite DPI and LED changes; quit it, or switch to
  `logitech mode onboard`, if settings don't stick.

## Running it

### The API, on the device host

```bash
cp .env.example .env
uv run python -c "import secrets; print(secrets.token_urlsafe(32))"   # put it in API_TOKEN
uv run __main__.py serve
```

Documentation (Scalar) is at `/`, the spec at `/openapi.json`; both are
public, every other route needs `Authorization: Bearer <API_TOKEN>` (or
`X-API-Key`). There is no database: one token from the environment, and the
battery history is only what is in memory since the last start.

| Route | Description |
| --- | --- |
| `GET /v1/devices` | Every device seen since startup, with its last battery reading (from memory, instant) |
| `POST /v1/devices/refresh` | Poll every device now |
| `GET /v1/devices/<id>` | One device |
| `GET /v1/devices/<id>/settings` | Every setting the model has, read live, with the ranges to draw it |
| `PATCH /v1/devices/<id>/settings` | Change some settings; returns them all, read back |
| `POST /v1/devices/<id>/actions/<action>` | `play`, `pause`, `next`, `prev`, `power_off`, `pairing`... |
| `GET /v1/status` | API status |

For the frontend server to reach it, set `API_HOST` to `0.0.0.0` or to a VPN
address, and allow the port through the Windows firewall. The API speaks
plain HTTP: put it on a VPN such as Tailscale (encrypted, and not exposed to
the internet) rather than forwarding a port.

It is a single process on purpose: one poller owns the radio and the
receiver, with one lock per vendor so two exchanges never share a link.

### The frontend, on your server

Built and pushed to `ghcr.io/paulbayfield/wireless-devices-control-frontend`
by `.github/workflows/deployment.yaml` on every push to `main` that touches
it. Run it with two variables:

```bash
docker run -d -p 3000:3000 \
  -e API_URL=http://<device-host>:7000 \
  -e API_TOKEN=<the same token> \
  ghcr.io/paulbayfield/wireless-devices-control-frontend:latest
```

Serve it over HTTPS (the session cookie is `Secure` in production). The login
page asks for the same token; see `src/frontend/README.md` for development.

## Commands

```bash
uv run __main__.py                    # battery of every device (the default)
uv run __main__.py battery --json     # the same, in the shape the API uses
uv run __main__.py devices            # everything discovery finds, every vendor
uv run __main__.py serve              # start the API
uv run __main__.py help
```

### Bose

```bash
uv run __main__.py bose                     # status (the default)
uv run __main__.py bose info                # model, serial, addresses, platform
uv run __main__.py bose battery             # just the number, for status bars
uv run __main__.py bose volume 8            # see below
uv run __main__.py bose pause               # also play, stop, next, prev
uv run __main__.py bose eq 3 0 -2           # bass / mid / treble, each -10..+10
uv run __main__.py bose name "Paul's QC45"  # rename over Bluetooth
uv run __main__.py bose multipoint on
uv run __main__.py bose prompts off
uv run __main__.py bose buttons Shortcut long_press ANC
uv run __main__.py bose standby             # auto-off timer, in minutes
uv run __main__.py bose paired              # devices this one remembers
uv run __main__.py bose pair                # pairing mode ('pair off' to leave)
uv run __main__.py bose off                 # power down
uv run __main__.py bose raw 00 05 01 00     # hand-written BMAP bytes
uv run __main__.py bose devices             # what is paired, no connection needed
uv run __main__.py bose nowplaying          # what this PC is playing, and who hears it
uv run __main__.py bose probe --mac ...     # map an unknown device, read-only
uv run __main__.py bose replay sweep.json   # check a model against a recording
uv run __main__.py bose help
```

QuietComfort 45 adds `cnc`, `wind`, `mode`, `modes`, `quiet`, `aware`,
`profile` and `sidetone`. A shared command appears only for a model that has
the feature behind it.

Options go before the command: `bose --device <key>`, `--mac <address>`,
`--channel <n>`, `--timeout <s>`. With several devices connected, plain
`status` prints all of them; every other command acts on one, so pick it
with `--device` or `--mac`. Every setting command prints its current value
when called with no argument.

Volume will not go above **15** without `--loud` on the end. A write lands
instantly and these go loud enough to hurt, so the ceiling makes a mistyped
number harmless. Relative moves (`volume +3`, `up`, `down`) clamp to it.

**BMAP carries no track metadata.** A full sweep of a QC45 (149 functions
across 13 blocks) turns up no title, artist or album anywhere; a device only
tells you which *address* it is playing from. `nowplaying` reads the track
from the Windows media session instead.

### Logitech

```bash
uv run __main__.py logitech info                    # name, battery, DPI, rate, profile mode
uv run __main__.py logitech battery --watch -i 30   # live battery (events + polling)
uv run __main__.py logitech dpi 1600
uv run __main__.py logitech rate 500
uv run __main__.py logitech led logo static --color ff0000
uv run __main__.py logitech mode host|onboard
uv run __main__.py logitech features                # dump the HID++ feature table
```

`--slot <n>` before the command picks the receiver slot (default 1).

## How it is put together

```
__main__.py            the entry point
assets/models/         3D models for the web UI (g502.glb)
src/
  core/                what every vendor shares
    device.py          Device, the interface; FoundDevice, what discovery returns
    battery.py         Battery and ChargeState, one reading in one shape
    errors.py          DeviceError, the root of every vendor's errors
    output.py          terminal colours, aligned rows, meters
    media.py           what this PC is playing, via the Windows media session
  devices/             scan() across every vendor
    bose/              BMAP over Bluetooth RFCOMM
      protocol/        codec, errors, vocabulary, parsers, builders
      models/          the models, and everything they have in common
      transport/       RFCOMM, discovery, and the two platform backends
      tools/           probe an unknown device, replay a recorded sweep
    logitech/          HID++ 2.0 through a Lightspeed receiver
      hidpp.py         report framing, feature lookup, receiver paths
      g502.py          the G502 LIGHTSPEED
  api/                 the Sanic API, laid out like my other APIs
    app.py             app setup, OpenAPI description, startup checks
    components/        token auth, rate limiting, middleware, errors
    routes/v1/         devices and service blueprints
    models/            OpenAPI schemas
    services/          the device manager (poller, locks) and per-vendor controls
  cli/                 the debugging command line
    main.py            battery, devices, serve, and dispatch to a vendor
    bose/              the Bose commands
    logitech.py        the Logitech commands
  frontend/            the Next.js app (its own README)
```

The shared interface is deliberately thin. Every device class subclasses
`core.Device`, which asks for identity (`VENDOR`, `KIND`, `KEY`, `NAME`),
`name()`, `battery()` returning a `Battery`, and `close()`. Everything else,
like EQ on headphones or DPI on a mouse, stays on the vendor's own classes.
That is all the server needs to list devices and show their batteries:

```python
from src.devices import scan

for found in scan():                  # FoundDevice: id, vendor, key, kind, model, name, address, connected
    if found.connected:
        with found.open() as dev:     # a core.Device subclass
            print(found.name, dev.battery())
```

### Bose internals

The split that matters: **addresses and payload shapes are data, sequences
of exchanges are code.** A model declares which address holds the battery,
which parser reads it, which builder writes it, and `Device` turns that into
methods. A model that declares `battery` gets `battery()` and the `battery`
command; one that does not gets a clear refusal instead of a timeout.

| File in `devices/bose/models/` | What it holds |
| --- | --- |
| `base.py` | `Device`, the parent class every model inherits |
| `features.py` | one method per thing a device can be asked |
| `catalog.py` | the addresses models share, written once |
| `status.py` | the status screen, one named row at a time |

## Adding a device

**Bose**

1. **Map it.** `uv run __main__.py bose probe --mac <address> --json
   captures/new.json` sweeps an unknown device read-only and prints every
   address that answers.
2. **Write the class** in `src/devices/bose/models/`: subclass `Device`, give
   it the identity attributes, and build `FEATURES` with
   `catalog.features()`, naming only what differs from `COMMON`.
3. **Register it** with one line in `src/devices/bose/models/__init__.py`,
   keyed by the product id `[0.3]` reports.
4. **Check it without the hardware.** `uv run __main__.py bose replay
   captures/new.json status info paired` feeds the recording back through
   the class.

**Logitech**

Subclass `HidppDevice` and `core.Device` in `src/devices/logitech/`, set the
identity attributes and `MATCH` (a substring of the name the device
reports), implement `battery()`, and add the class to `MODELS` in
`src/devices/logitech/__init__.py`. `logitech features` lists what the
device supports.

**A new vendor** gets a package under `src/devices/` with a `VENDOR` name
and a `scan()` returning `FoundDevice` records, and joins `VENDORS` in
`src/devices/__init__.py`.

## Notes on the protocols

### Bose BMAP

A BMAP packet is four header bytes plus a payload:

```
[function_block, function, flags, payload_length, ...payload]
```

`flags` carries the operator in its low nibble. Bose gates SET (operator 0)
behind cloud-mediated authentication, but GET (1), SETGET (2) and START (5)
are unauthenticated on the Settings, Control and AudioModes blocks, which
covers every user-facing setting. Nothing here breaks encryption or replays
traffic.

Windows only reaches a channel the device advertises over SDP and is racy
about reusing one, so session setup and the opening GET are retried; reads
are safe to retry, writes are not and never are.

### Logitech HID++ 2.0

- Requests are long reports: `11 <slot> <featIdx> <fn<<4|swId> <params...>`
  (20 bytes), on the receiver's vendor collection (usage page `0xFF00`).
- Feature indexes are looked up through ROOT (`idx 0, fn 0, featureId`).
- An empty slot or a sleeping device answers with a HID++ 1.0 error on the
  short collection, which is how discovery pings each receiver slot.
- Battery is `0x1001 BATTERY_VOLTAGE`: millivolts plus a flags byte, and no
  native percentage. The percentage comes from interpolating over a Li-ion
  discharge curve (see `g502.py`).

## Licence

GNU AGPL v3, see [LICENSE](LICENSE).
