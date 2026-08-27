# RizcoReach-HQ

Static marketing site (plain HTML, no build step) for RizcoReach, a Dubai
marketing agency. Each `*.html` file at the repo root is a standalone page —
edit them directly; there is no framework, bundler, or dev server.

## Video analysis

`analyze_video.py` sends a video file to Google Gemini and returns a
description of what happens in it. Use it whenever the user asks to analyze,
describe, summarize, or pull details out of a video — including ad creative
and competitor clips.

Just run it; don't rewrite it:

```bash
python3 analyze_video.py path/to/video.mp4
python3 analyze_video.py ad.mp4 --prompt "What's the hook in the first 3 seconds?"
```

Flags: `--prompt` (custom question), `--model` (override model), `--keep`
(don't delete the upload from Google's servers afterward).

### Setup in a fresh session

The container is ephemeral, so both of these are usually needed once:

1. `python3 -m pip install -r requirements.txt`
2. A `GEMINI_API_KEY` must be available — either set in the environment
   config, or written to a local `.env` file as `GEMINI_API_KEY=...`.

`.env` is gitignored and must stay that way. Never commit the key, echo it
into chat, or paste it into a file that is tracked by git.

### Model note

`gemini-2.5-flash` returns 404 for API keys created recently — it is retired
for new users. The default is `gemini-3.6-flash`. Override per-run with
`--model`, or persistently with `GEMINI_MODEL` in the environment or `.env`.
Run `client.models.list()` to see what a given key can actually reach before
assuming a model exists.

### Reading the video

The script needs the video on local disk. In a remote session the container
only sees this repo, so a file on the user's own machine is not reachable —
ask them to commit it, provide a URL to download, or run locally. Claude can
view images directly, but not video; this script is the video path.
