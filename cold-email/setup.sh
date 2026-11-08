#!/bin/bash
# RizcoReach cold email: the one line setup for a Mac. Paste this into Terminal:
#
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/Samil-maker/RizcoReach-HQ/main/cold-email/setup.sh)"
#
# Safe to run again any time: it updates the code and keeps your settings, leads and history.
set -u

REPO="https://github.com/Samil-maker/RizcoReach-HQ.git"
BRANCH="${RIZCO_BRANCH:-main}"
DIR="${RIZCO_DIR:-$HOME/RizcoReach-Outreach}"
APP="$DIR/cold-email"

bold() { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31m%s\033[0m\n' "$*"; exit 1; }

if [ "$(uname)" != "Darwin" ] && [ -z "${RIZCO_TEST:-}" ]; then
  fail "This setup is for a Mac."
fi

bold "Getting things ready. This part runs by itself."

# 1. Apple's free command line tools give the Mac git and Python.
if [ -z "${RIZCO_TEST:-}" ] && ! xcode-select -p >/dev/null 2>&1; then
  bold "Your Mac needs Apple's command line tools first."
  echo "A window is opening: click Install, then Agree. It takes 5 to 15 minutes."
  echo "Leave this Terminal window open. Setup carries on by itself when it's done."
  xcode-select --install >/dev/null 2>&1 || true
  until xcode-select -p >/dev/null 2>&1 && git --version >/dev/null 2>&1; do sleep 10; done
  echo "Command line tools installed."
fi

# 2. Python 3.9 or newer (the Mac's own is fine).
PY=""
for candidate in /opt/homebrew/bin/python3 /usr/local/bin/python3 python3 /usr/bin/python3; do
  if command -v "$candidate" >/dev/null 2>&1 &&
     "$candidate" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' >/dev/null 2>&1; then
    PY="$(command -v "$candidate")"
    break
  fi
done
[ -n "$PY" ] || fail "Python 3.9 or newer is missing. Install it from https://www.python.org/downloads/ and run this line again."

# 3. The code, in its own folder (outside Documents and Desktop, which macOS keeps from background jobs).
if [ -d "$DIR/.git" ]; then
  echo "Updating the code in $DIR"
  if git -C "$DIR" fetch --quiet --depth 1 origin "$BRANCH"; then
    git -C "$DIR" reset --quiet --hard FETCH_HEAD   # only touches the code: your .env, leads and data are kept
  else
    echo "Couldn't download the update right now, carrying on with what is there."
  fi
elif [ -e "$DIR" ]; then
  fail "$DIR already exists but isn't this program. Rename or remove it, then run this line again."
else
  echo "Downloading the code to $DIR"
  git clone --quiet --depth 1 --branch "$BRANCH" "$REPO" "$DIR" || fail "The download failed. Check the internet connection and run this line again."
fi
cd "$APP" || fail "Something went wrong: $APP is missing."

# 4. A private Python box (.venv) with the packages this program uses.
if ! .venv/bin/python -c 'import sys' >/dev/null 2>&1; then
  rm -rf .venv
  "$PY" -m venv .venv || fail "Couldn't make the Python environment."
fi
echo "Installing the Python packages (about a minute the first time)"
.venv/bin/python -m pip install --quiet --disable-pip-version-check --upgrade pip >/dev/null 2>&1
.venv/bin/python -m pip install --quiet --disable-pip-version-check -r requirements.txt || fail "Installing packages failed. Check the internet connection and run this line again."
mkdir -p leads/inbox leads/processed data reports logs

# 5. The "rizco" command, so any Terminal window can run  rizco report,  rizco resume  and so on.
for rc in "$HOME/.zshrc" "$HOME/.bash_profile"; do
  if [ "$rc" = "$HOME/.zshrc" ] || [ -f "$rc" ]; then
    grep -q "alias rizco=" "$rc" 2>/dev/null || printf '\n# RizcoReach cold email\nalias rizco="%s/rizco"\n' "$APP" >> "$rc"
  fi
done

# 6. The questions.
[ -n "${RIZCO_TEST:-}" ] && { echo "RIZCO_TEST: stopping before the questions."; exit 0; }
exec .venv/bin/python run.py setup </dev/tty
