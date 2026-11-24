"""The background jobs stay switched on: an update never stops the job it runs in, and the dashboard restarts
any job it finds stopped. (On 14 November 2026 the hourly job's update stopped the hourly job itself.)"""
import subprocess

from outreach import launchd


class FakeLaunchctl:
    def __init__(self, loaded):
        self.loaded = set(loaded)
        self.calls = []

    def __call__(self, *args):
        self.calls.append(args)
        verb = args[0]
        label = args[1].rsplit("/", 1)[-1] if len(args) > 1 else ""
        code = 0
        if verb == "print":
            code = 0 if label in self.loaded else 113
        elif verb == "bootout":
            self.loaded.discard(label)
        elif verb == "bootstrap":
            self.loaded.add(args[2].rsplit("/", 1)[-1].replace(".plist", ""))
        return subprocess.CompletedProcess(args, code, "", "")


def mac(monkeypatch, tmp_path, loaded, running_as=""):
    fake = FakeLaunchctl(loaded)
    monkeypatch.setattr(launchd, "IS_MAC", True)
    monkeypatch.setattr(launchd, "_launchctl", fake)
    monkeypatch.setattr(launchd, "plist_path", lambda label=launchd.LABEL: tmp_path / ("%s.plist" % label))
    monkeypatch.setattr(launchd, "local_start_time", lambda: (9, 0, False))
    if running_as:
        monkeypatch.setenv("XPC_SERVICE_NAME", running_as)
    else:
        monkeypatch.delenv("XPC_SERVICE_NAME", raising=False)
    return fake


def test_the_update_never_stops_the_hourly_job_it_runs_in(monkeypatch, tmp_path, project):
    fake = mac(monkeypatch, tmp_path, launchd.LABELS, running_as=launchd.HOURLY_LABEL)
    assert launchd.install().startswith("Installed")
    stopped = [c[1].rsplit("/", 1)[-1] for c in fake.calls if c[0] == "bootout"]
    assert launchd.HOURLY_LABEL not in stopped                 # it would have been killed right here
    assert launchd.LABEL in stopped and launchd.DASHBOARD_LABEL in stopped   # the others reload (new code)
    assert fake.loaded == set(launchd.LABELS)
    assert (tmp_path / ("%s.plist" % launchd.HOURLY_LABEL)).exists()      # its new file is written all the same


def test_setup_from_terminal_reloads_everything(monkeypatch, tmp_path, project):
    fake = mac(monkeypatch, tmp_path, launchd.LABELS)
    launchd.install()
    assert {c[1].rsplit("/", 1)[-1] for c in fake.calls if c[0] == "bootout"} == set(launchd.LABELS)


def test_the_dashboard_switches_stopped_jobs_back_on(monkeypatch, tmp_path, project):
    fake = mac(monkeypatch, tmp_path, launchd.LABELS)
    launchd.install()
    fake.loaded = {launchd.DASHBOARD_LABEL, launchd.LABEL}           # the hourly job was switched off
    monkeypatch.setenv("XPC_SERVICE_NAME", launchd.DASHBOARD_LABEL)
    said = []
    assert launchd.heal(log=said.append) == [launchd.HOURLY_LABEL]
    assert launchd.HOURLY_LABEL in fake.loaded and said
    assert launchd.heal(log=said.append) == []                       # nothing to do once they all run
