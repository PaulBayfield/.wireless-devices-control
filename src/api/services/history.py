"""Battery history, kept across restarts.

The poller hands every battery reading to :class:`BatteryHistory`, which
keeps them in one SQLite file (standard library, nothing to install or run).

A battery sits at the same level for many polls in a row, so readings are
stored as *runs*: one row per stretch of polls that returned the same level
and the same charging state, with when it started and when it was last
confirmed. A poll that agrees with the last run only moves its end; a poll
that differs, or that comes after the device was away, opens a new one.
That keeps months of 30-second polls in a few thousand rows, and makes the
times the device was not read explicit rather than a line drawn across them.

Charging phases are worked out when the history is read, see
:func:`phases`.
"""

import sqlite3
import threading
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from src.core import Battery, ChargeState

_SCHEMA = """
CREATE TABLE IF NOT EXISTS battery_runs (
    id          INTEGER PRIMARY KEY,
    device_id   TEXT    NOT NULL,
    started_at  INTEGER NOT NULL,
    ended_at    INTEGER NOT NULL,
    percent     INTEGER NOT NULL,
    state       TEXT    NOT NULL,
    millivolts  INTEGER
);
CREATE INDEX IF NOT EXISTS battery_runs_device ON battery_runs (device_id, ended_at);
"""

_UNKNOWN = ChargeState.UNKNOWN.value
_CHARGING = ChargeState.CHARGING.value

#: A rise smaller than this, on a device that does not say whether it is
#: charging, is a level wobbling between two values rather than a charge.
_MIN_INFERRED_RISE = 2

_DAY = 86_400


@dataclass(slots=True)
class Run:
    """Consecutive polls that returned the same level and charging state."""

    id: int
    #: First and last poll of the run, as Unix seconds.
    start: int
    end: int
    percent: int
    state: str
    #: The cell voltage at the last poll, for devices that measure it.
    millivolts: int | None


def _iso(seconds: int) -> str:
    return datetime.fromtimestamp(seconds, UTC).isoformat(timespec="seconds")


def phases(runs: list[Run], max_gap: int) -> list[dict]:
    """The charging phases behind a list of runs, oldest first.

    For a device that reports its charging state, a phase is every
    consecutive run in the same state: discharging, charging, full...

    A device that only reports a level (Bose) gets its charging phases
    inferred from it: a level that goes up was charged in between, whether
    the device stayed reachable or came back from the charger hours later.
    Those are marked ``inferred``, and run from the last poll at the low
    level to the first one at the high level.
    """
    found: list[dict] = []
    rising: dict | None = None
    previous: Run | None = None

    for run in runs:
        if run.state != _UNKNOWN:
            follows = previous is not None and run.start - previous.end <= max_gap
            if follows and previous.state == run.state:
                found[-1].update(end=run.end, to_percent=run.percent)
            else:
                found.append({"state": run.state, "inferred": False, "start": run.start, "end": run.end,
                              "from_percent": run.percent, "to_percent": run.percent})
        elif previous is not None and previous.state == _UNKNOWN and run.percent > previous.percent:
            if rising is not None and rising["end"] == previous.start:
                rising.update(end=run.start, to_percent=run.percent)
            else:
                rising = {"state": _CHARGING, "inferred": True, "start": previous.end, "end": run.start,
                          "from_percent": previous.percent, "to_percent": run.percent}
                found.append(rising)
        previous = run

    return [
        {
            "state": phase["state"],
            "inferred": phase["inferred"],
            "from": _iso(phase["start"]),
            "to": _iso(phase["end"]),
            "from_percent": phase["from_percent"],
            "to_percent": phase["to_percent"],
        }
        for phase in found
        if not phase["inferred"] or phase["to_percent"] - phase["from_percent"] >= _MIN_INFERRED_RISE
    ]


class BatteryHistory:
    """Every battery reading, as runs in a SQLite file.

    Called from worker threads, so every access holds a lock.

    :param path: the database file, created along with its directory.
    :param retention_days: runs that ended longer ago than this are deleted.
    :param max_gap: seconds without a reading after which the device counts
        as having been away, rather than as having kept its level.
    """

    def __init__(self, path: str | Path, retention_days: int, max_gap: int) -> None:
        self.path = Path(path)
        self.retention_days = retention_days
        self.max_gap = max_gap
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(self.path, check_same_thread=False)
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.executescript(_SCHEMA)
        self._lock = threading.Lock()
        #: The open run of each device, so a poll does not have to look it up.
        self._last: dict[str, Run] = {}
        self._pruned_at = 0

    def close(self) -> None:
        with self._lock:
            self._db.close()

    def _latest(self, device_id: str) -> Run | None:
        if device_id not in self._last:
            row = self._db.execute(
                "SELECT id, started_at, ended_at, percent, state, millivolts FROM battery_runs "
                "WHERE device_id = ? ORDER BY ended_at DESC LIMIT 1",
                (device_id,),
            ).fetchone()
            if row is None:
                return None
            self._last[device_id] = Run(*row)
        return self._last[device_id]

    def record(self, device_id: str, battery: Battery, at: datetime) -> None:
        """Store one reading: extend the device's open run, or start a new one.

        A reading without a level says nothing to plot, and is skipped.
        """
        if battery.percent is None:
            return
        now = int(at.timestamp())
        state = battery.state.value

        with self._lock, self._db:
            last = self._latest(device_id)
            if (last is not None and last.percent == battery.percent and last.state == state
                    and now - last.end <= self.max_gap):
                last.end = max(last.end, now)
                last.millivolts = battery.millivolts
                self._db.execute("UPDATE battery_runs SET ended_at = ?, millivolts = ? WHERE id = ?",
                                 (last.end, last.millivolts, last.id))
            else:
                cursor = self._db.execute(
                    "INSERT INTO battery_runs (device_id, started_at, ended_at, percent, state, millivolts) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (device_id, now, now, battery.percent, state, battery.millivolts),
                )
                self._last[device_id] = Run(cursor.lastrowid, now, now, battery.percent, state,
                                            battery.millivolts)

            if now - self._pruned_at >= _DAY:
                self._db.execute("DELETE FROM battery_runs WHERE ended_at < ?",
                                 (now - self.retention_days * _DAY,))
                self._pruned_at = now

    def read(self, device_id: str, since: datetime, until: datetime) -> dict:
        """The readings and charging phases of one device over a window.

        A run that straddles the start of the window is cut to it.
        """
        start = int(since.timestamp())
        with self._lock:
            rows = self._db.execute(
                "SELECT id, started_at, ended_at, percent, state, millivolts FROM battery_runs "
                "WHERE device_id = ? AND ended_at >= ? ORDER BY started_at",
                (device_id, start),
            ).fetchall()
        runs = [Run(*row) for row in rows]
        for run in runs:
            run.start = max(run.start, start)

        readings = []
        previous: Run | None = None
        for run in runs:
            readings.append({
                "from": _iso(run.start),
                "to": _iso(run.end),
                "percent": run.percent,
                "state": run.state,
                "millivolts": run.millivolts,
                "gap": previous is not None and run.start - previous.end > self.max_gap,
            })
            previous = run

        return {
            "since": since.isoformat(timespec="seconds"),
            "until": until.isoformat(timespec="seconds"),
            "retention_days": self.retention_days,
            "readings": readings,
            "phases": phases(runs, self.max_gap),
        }
