"""What is playing right now -- read from Windows, not from the device.

BMAP carries no track metadata. A full sweep of a QC45 (149 functions across
13 blocks) turns up no title, artist or album anywhere: AudioManagement holds
the source, the transport controls, the volume and some numeric parameters,
and nothing else is text. The Bose app shows a track because the *phone* it
runs on knows it, not because the headphones report it.

The metadata lives on whichever device is the audio source. When that source
is this PC, Windows exposes it through the media session API that the volume
overlay and the lock screen use, so a track can be read there and lined up
with the device playing it.

That API is WinRT, reachable from Windows PowerShell 5.1 but not from
PowerShell 7 or plain CPython. Shelling out to it is the same bargain the
Linux side already makes with bluetoothctl: a host tool rather than a
package, so the no-dependency promise holds.
"""

import base64
import json
import subprocess
import sys

# Written to run under Windows PowerShell 5.1, which still resolves WinRT
# types. `AsTask` turns each IAsyncOperation into something waitable.
_SCRIPT = r"""
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object {
        $_.Name -eq 'AsTask' -and
        $_.GetParameters().Count -eq 1 -and
        $_.GetParameters()[0].ParameterType.Name -like 'IAsyncOperation*'
    })[0]

function Await($op, $type) {
    $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
    $null = $task.Wait(3000)
    $task.Result
}

$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
if ($null -eq $mgr) { ConvertTo-Json @{ error = 'no session manager' }; exit 0 }

$session = $mgr.GetCurrentSession()
if ($null -eq $session) { ConvertTo-Json @{ error = 'nothing playing' }; exit 0 }

$props = Await ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
ConvertTo-Json @{
    app    = [string]$session.SourceAppUserModelId
    title  = [string]$props.Title
    artist = [string]$props.Artist
    album  = [string]$props.AlbumTitle
    track  = [string]$props.TrackNumber
    state  = [string]$session.GetPlaybackInfo().PlaybackStatus
}
"""


class MediaUnavailable(Exception):
    """Windows would not say what is playing."""


def now_playing(timeout=15):
    """What this PC is playing, as a dict, or raise MediaUnavailable.

    Keys: app, title, artist, album, track, state.
    """
    if sys.platform != "win32":
        raise MediaUnavailable(
            "Reading the current track needs the Windows media session API. "
            "On Linux the same information is on the machine that is playing, "
            "through MPRIS (playerctl).")

    # -EncodedCommand takes UTF-16LE base64, which sidesteps every layer of
    # quoting between here and PowerShell's parser.
    encoded = base64.b64encode(_SCRIPT.encode("utf-16-le")).decode("ascii")
    try:
        result = subprocess.run(
            ["powershell.exe", "-NoProfile", "-NonInteractive",
             "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
            capture_output=True, text=True, timeout=timeout,
        )
    except FileNotFoundError:
        raise MediaUnavailable(
            "Windows PowerShell (powershell.exe) was not found") from None
    except subprocess.TimeoutExpired:
        raise MediaUnavailable("Windows did not answer in %ds" % timeout) from None

    output = result.stdout.strip()
    if not output:
        raise MediaUnavailable(result.stderr.strip() or "no answer from Windows")
    try:
        data = json.loads(output)
    except ValueError:
        raise MediaUnavailable(output.splitlines()[0]) from None

    if data.get("error"):
        raise MediaUnavailable(data["error"])
    return data
