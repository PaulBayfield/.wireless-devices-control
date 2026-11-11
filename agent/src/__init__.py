"""Wireless Devices Control -- one place to manage every wireless device.

Each vendor's protocol was reverse engineered separately and lives in its own
package; what they share is a thin interface, so the rest of the project can
list devices and read their batteries without knowing who made them.

Layout
------

:mod:`~src.core`
    the shared interface: ``Device``, ``Battery``, ``DeviceError``
:mod:`~src.devices`
    one package per vendor, and :func:`~src.devices.scan` across all of them
:mod:`~src.devices.bose`
    Bose headphones and speakers, over BMAP on Bluetooth RFCOMM
:mod:`~src.devices.logitech`
    Logitech mice, over HID++ 2.0 through a Lightspeed receiver
:mod:`~src.cli`
    the command line, for debugging the device layer

Using it as a library
---------------------

::

    from src.devices import scan

    for found in scan():
        with found.open() as dev:
            print(found.name, dev.battery())
"""

__version__ = "0.1.0"
