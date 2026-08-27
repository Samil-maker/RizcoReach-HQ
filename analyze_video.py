#!/usr/bin/env python3
"""Send a video file to Gemini and print a description of what happens in it.

Usage:
    python3 analyze_video.py path/to/video.mp4
    python3 analyze_video.py path/to/video.mp4 --prompt "List every on-screen text overlay"
"""

import argparse
import os
import sys
import time

from dotenv import load_dotenv
from google import genai
from google.genai import errors, types

# gemini-2.5-flash is no longer served to new API keys; 3.6-flash is the
# migration target Google's API points at. Override with GEMINI_MODEL in .env.
DEFAULT_MODEL = "gemini-3.6-flash"

DEFAULT_PROMPT = (
    "Describe what is happening in this video. Cover the setting, the people or "
    "objects on screen, the sequence of actions from start to finish, any spoken "
    "or on-screen text, and the overall mood. Give approximate timestamps for the "
    "key moments."
)


def get_client() -> genai.Client:
    """Load GEMINI_API_KEY from .env and return an authenticated client."""
    load_dotenv()
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key or api_key == "your_key_here":
        sys.exit(
            "GEMINI_API_KEY is missing or still the placeholder.\n"
            "Put your real key in the .env file next to this script:\n"
            "    GEMINI_API_KEY=AIza...\n"
            "Get one at https://aistudio.google.com/apikey"
        )
    return genai.Client(api_key=api_key)


def get_model() -> str:
    """Model id, overridable via GEMINI_MODEL in .env."""
    return os.getenv("GEMINI_MODEL") or DEFAULT_MODEL


def _retry(call, what: str, attempts: int = 4):
    """Run call(), retrying transient 5xx / rate-limit errors with backoff."""
    for attempt in range(1, attempts + 1):
        try:
            return call()
        except errors.APIError as exc:
            transient = exc.code in (429, 500, 502, 503, 504)
            if not transient or attempt == attempts:
                raise
            wait = 2 ** attempt
            print(
                f"  {what}: transient error {exc.code}, retrying in {wait}s "
                f"({attempt}/{attempts - 1})",
                file=sys.stderr,
            )
            time.sleep(wait)


def upload_video(client: genai.Client, path: str) -> types.File:
    """Upload the video and block until Gemini has finished processing it."""
    if not os.path.isfile(path):
        sys.exit(f"No such video file: {path}")

    size_mb = os.path.getsize(path) / (1024 * 1024)
    print(f"Uploading {os.path.basename(path)} ({size_mb:.1f} MB)...", file=sys.stderr)
    video = _retry(lambda: client.files.upload(file=path), "upload")

    while video.state.name == "PROCESSING":
        print("  processing...", file=sys.stderr)
        time.sleep(5)
        video = _retry(lambda: client.files.get(name=video.name), "poll")

    if video.state.name == "FAILED":
        sys.exit(f"Gemini failed to process the video: {video.state.name}")

    print("Upload ready. Analyzing...", file=sys.stderr)
    return video


def analyze(client: genai.Client, video: types.File, prompt: str, model: str) -> str:
    response = _retry(
        lambda: client.models.generate_content(
            model=model,
            contents=[video, prompt],
        ),
        "analyze",
    )
    return response.text


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Analyze a video with Gemini."
    )
    parser.add_argument("video", help="Path to the video file (mp4, mov, webm, ...)")
    parser.add_argument(
        "--prompt",
        default=DEFAULT_PROMPT,
        help="Custom question to ask about the video",
    )
    parser.add_argument(
        "--model",
        default=None,
        help=f"Model id to use (default: $GEMINI_MODEL or {DEFAULT_MODEL})",
    )
    parser.add_argument(
        "--keep",
        action="store_true",
        help="Keep the uploaded file on Gemini's servers instead of deleting it",
    )
    args = parser.parse_args()

    client = get_client()
    model = args.model or get_model()

    try:
        video = upload_video(client, args.video)
    except errors.APIError as exc:
        sys.exit(f"Upload failed ({exc.code}): {exc.message}")

    try:
        print(analyze(client, video, args.prompt, model))
    except errors.APIError as exc:
        sys.exit(f"Analysis failed ({exc.code}): {exc.message}")
    finally:
        if not args.keep:
            try:
                client.files.delete(name=video.name)
            except errors.APIError:
                pass  # cleanup is best-effort; the file expires on its own


if __name__ == "__main__":
    main()
