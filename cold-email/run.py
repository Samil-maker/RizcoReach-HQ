#!/usr/bin/env python3
"""RizcoReach cold email.  Start here:  python run.py help

Every day:
    python run.py send       sends today's emails slowly (python run.py send --dry-run to preview)
    python run.py replies    checks for replies and drafts answers for you
    python run.py report     writes reports/YYYY-MM-DD.md
"""
import sys

if sys.version_info < (3, 9):
    sys.exit("This needs Python 3.9 or newer. You have %s. See README step 1." % sys.version.split()[0])

from outreach.cli import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main())
