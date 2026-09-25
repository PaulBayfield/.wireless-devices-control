"""The command line.

:mod:`~.cli.main`
    argument parsing, discovery and dispatch
:mod:`~.cli.registry`
    which commands a given model offers
:mod:`~.cli.shared`
    the commands that are not particular to a model
:mod:`~.cli.offline`
    the commands that need no device to answer

How output looks lives one level up, in :mod:`src.output`, because
the status rows a device class declares print through it too.
"""
