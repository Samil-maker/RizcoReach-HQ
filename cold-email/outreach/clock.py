"""Dubai time for everything. Tests swap the clock and the sleep function."""
from __future__ import annotations

import time as _time
from datetime import date, datetime, timedelta
from typing import Callable, Optional

from zoneinfo import ZoneInfo

TZ = ZoneInfo("Asia/Dubai")

_fake_now: Optional[Callable[[], datetime]] = None
_fake_sleep: Optional[Callable[[float], None]] = None


def now() -> datetime:
    return _fake_now() if _fake_now else datetime.now(TZ)


def today() -> date:
    return now().date()


def sleep(seconds: float) -> None:
    if seconds <= 0:
        return
    if _fake_sleep:
        _fake_sleep(seconds)
    else:
        _time.sleep(seconds)


def iso(dt: Optional[datetime] = None) -> str:
    return (dt or now()).astimezone(TZ).isoformat(timespec="seconds")


def parse(value: str) -> datetime:
    dt = datetime.fromisoformat(value)
    return dt if dt.tzinfo else dt.replace(tzinfo=TZ)


def parse_date(value: str) -> date:
    return date.fromisoformat(value[:10])


def at(day: date, hour: int, minute: int = 0) -> datetime:
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=TZ)


def next_weekday(day: date) -> date:
    """The same day if it is Monday to Friday, else the next Monday."""
    while day.weekday() >= 5:
        day += timedelta(days=1)
    return day


def nice(day: date) -> str:
    """Monday 9 November"""
    return "%s %d %s" % (day.strftime("%A"), day.day, day.strftime("%B"))


def week_start(day: date) -> date:
    return day - timedelta(days=day.weekday())


def set_fake(now_fn: Optional[Callable[[], datetime]] = None, sleep_fn: Optional[Callable[[float], None]] = None) -> None:
    global _fake_now, _fake_sleep
    _fake_now = now_fn
    _fake_sleep = sleep_fn
