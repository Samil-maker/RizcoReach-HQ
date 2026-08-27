#!/usr/bin/env python3
"""Send a video file to Gemini 2.5 Flash and print a description of what happens in it.

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
from google.genai import types

MODEL = "gemini-2.5-flash"

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


def upload_video(client: genai.Client, path: str) -> types.File:
    """Upload the video and block until Gemini has finished processing it."""
    if not os.path.isfile(path):
        sys.exit(f"No such video file: {path}")

    size_mb = os.path.getsize(path) / (1024 * 1024)
    print(f"Uploading {os.path.basename(path)} ({size_mb:.1f} MB)...", file=sys.stderr)
    video = client.files.upload(file=path)

    while video.state.name == "PROCESSING":
        print("  processing...", file=sys.stderr)
        time.sleep(5)
        video = client.files.get(name=video.name)

    if video.state.name == "FAILED":
        sys.exit(f"Gemini failed to process the video: {video.state.name}")

    print("Upload ready. Analyzing...", file=sys.stderr)
    return video


def analyze(client: genai.Client, video: types.File, prompt: str) -> str:
    response = client.models.generate_content(
        model=MODEL,
        contents=[video, prompt],
    )
    return response.text


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Analyze a video with Gemini 2.5 Flash."
    )
    parser.add_argument("video", help="Path to the video file (mp4, mov, webm, ...)")
    parser.add_argument(
        "--prompt",
        default=DEFAULT_PROMPT,
        help="Custom question to ask about the video",
    )
    parser.add_argument(
        "--keep",
        action="store_true",
        help="Keep the uploaded file on Gemini's servers instead of deleting it",
    )
    args = parser.parse_args()

    client = get_client()
    video = upload_video(client, args.video)

    try:
        print(analyze(client, video, args.prompt))
    finally:
        if not args.keep:
            client.files.delete(name=video.name)


if __name__ == "__main__":
    main()
