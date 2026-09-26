"""The Bose command line: ``uv run __main__.py bose ...``.

:mod:`~.bose.main`
    argument parsing, discovery and dispatch
:mod:`~.bose.registry`
    which commands a given model offers
:mod:`~.bose.shared`
    the commands that are not particular to a model
:mod:`~.bose.offline`
    the commands that need no device to answer

How output looks lives in :mod:`src.core.output`, because the status rows a
device class declares print through it too.
"""
