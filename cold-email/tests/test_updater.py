"""The daily self update, against real git repositories on disk."""
import subprocess
from datetime import datetime

from outreach import clock, config, db, updater


def git(cwd, *args):
    subprocess.run(["git", "-C", str(cwd), *args], check=True, capture_output=True)


def make_repos(tmp_path):
    origin = tmp_path / "origin"
    (origin / "cold-email" / "tests").mkdir(parents=True)
    (origin / "cold-email" / "requirements.txt").write_text("")
    (origin / "cold-email" / "tests" / "test_ok.py").write_text("def test_ok():\n    assert True\n")
    (origin / "cold-email" / "version.txt").write_text("1\n")
    git(origin, "init", "-q", "-b", "main")
    git(origin, "-c", "user.email=t@t", "-c", "user.name=t", "add", "-A")
    git(origin, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "v1")
    mac = tmp_path / "RizcoReach-Outreach"
    subprocess.run(["git", "clone", "-q", "--depth", "1", "file://%s" % origin, str(mac)], check=True)
    (mac / "cold-email" / ".env").write_text("INBOX1_APP_PASSWORD=secret\n")  # never touched by updates
    return origin, mac


def commit(origin, path, text, msg):
    (origin / "cold-email" / path).write_text(text)
    git(origin, "-c", "user.email=t@t", "-c", "user.name=t", "add", "-A")
    git(origin, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", msg)


def test_update_applies_good_versions_and_rolls_back_bad_ones(tmp_path, monkeypatch, fake_clock):
    origin, mac = make_repos(tmp_path)
    config.set_root(mac / "cold-email")
    monkeypatch.delenv("OUTREACH_NO_UPDATE", raising=False)
    con = db.connect(mac / "cold-email" / "data" / "outreach.db")
    fake_clock.set(datetime(2026, 11, 9, 18, 0, tzinfo=clock.TZ))  # Monday evening, after sending
    try:
        assert updater.due(con)
        assert updater.update(con) == "Already up to date."
        assert not updater.due(con)  # once a day

        commit(origin, "version.txt", "2\n", "v2")
        fake_clock.set(datetime(2026, 11, 10, 7, 0, tzinfo=clock.TZ))
        assert updater.due(con)
        assert updater.update(con).startswith("Updated to the latest version")
        assert (mac / "cold-email" / "version.txt").read_text() == "2\n"
        assert (mac / "cold-email" / ".env").read_text() == "INBOX1_APP_PASSWORD=secret\n"

        commit(origin, "tests/test_ok.py", "def test_ok():\n    assert False\n", "broken")
        commit(origin, "version.txt", "3\n", "v3")
        fake_clock.set(datetime(2026, 11, 11, 7, 0, tzinfo=clock.TZ))
        assert "kept" in updater.update(con)
        assert (mac / "cold-email" / "version.txt").read_text() == "2\n"  # still the working version

        fake_clock.set(datetime(2026, 11, 12, 10, 0, tzinfo=clock.TZ))  # Thursday 10:00: emails are going out
        assert not updater.due(con)
    finally:
        config.set_root(config.Path(__file__).resolve().parent.parent)
