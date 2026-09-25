"""The two tools that are not about driving a device you already support.

:mod:`~.tools.probe`
    sweep an unknown device read-only and print what answered -- how a
    new model gets mapped
:mod:`~.tools.replay`
    run a device class against a recorded sweep, so parsers can be
    checked with no hardware awake
:mod:`~.tools.reference`
    what the addresses meant on devices already mapped

Together they are the whole workflow for adding a model: probe it, write the
class, replay the capture until the status screen reads right.
"""
