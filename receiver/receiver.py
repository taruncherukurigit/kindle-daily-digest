"""
Lightweight receiver. Accepts the finished digest text from n8n over
HTTP POST, renders it to EPUB with pandoc, archives a dated copy,
sends it through send_digest.py, and provides a full-article-text
extraction endpoint built on trafilatura, used by the n8n
digest-assembly step.

Runs as a systemd service. See receiver/digest-receiver.service.
"""
import os
import subprocess
from datetime import datetime
from zoneinfo import ZoneInfo
from flask import Flask, request
from send_digest import send_to_kindle_and_self, notify
import trafilatura

app = Flask(__name__)
ARCHIVE_DIR = os.path.expanduser("~/kindle-digest/digest-archive")
EST = ZoneInfo("America/New_York")


@app.route("/receive-digest", methods=["POST"])
def receive_digest():
    digest_text = request.get_data(as_text=True)
    if not digest_text.strip():
        notify("Digest FAILED: empty digest received from n8n")
        return "Empty digest received", 400

    now_est = datetime.now(EST)
    timestamp = now_est.strftime("%Y-%m-%d_%H%M")

    with open("digest.md", "w") as f:
        f.write(digest_text)

    os.makedirs(ARCHIVE_DIR, exist_ok=True)
    with open(f"{ARCHIVE_DIR}/digest_{timestamp}.md", "w") as f:
        f.write(digest_text)

    epub_filename = f"kindle_digest_{timestamp}.epub"
    result = subprocess.run(
        ["pandoc", "digest.md", "-o", epub_filename, "--toc",
         "--metadata", f"title=Daily Knowledge Digest {now_est.strftime('%Y-%m-%d %H:%M')} EST"],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        notify(f"Digest render FAILED: {result.stderr[:200]}")
        return f"Pandoc failed: {result.stderr}", 500

    try:
        send_to_kindle_and_self(epub_filename)
        notify(f"Daily Knowledge Digest sent successfully, archived as digest_{timestamp}.md")
        return "OK - digest sent", 200
    except Exception as e:
        notify(f"Digest send FAILED: {e}")
        return f"Send failed: {e}", 500


@app.route("/weekly-archive", methods=["GET"])
def weekly_archive():
    """Reads every digest_*.md file modified in the last 7 days and
    returns them concatenated as plain text. n8n runs on a different
    container and has no filesystem access to digest-archive/. This
    endpoint is the only thing that can read it, so it reads locally
    and hands the result back over HTTP."""
    import time
    seven_days_ago = time.time() - (7 * 24 * 60 * 60)
    combined = []
    if not os.path.isdir(ARCHIVE_DIR):
        return "", 200
    for fname in sorted(os.listdir(ARCHIVE_DIR)):
        if not (fname.startswith("digest_") and fname.endswith(".md")):
            continue
        fpath = os.path.join(ARCHIVE_DIR, fname)
        if os.path.getmtime(fpath) >= seven_days_ago:
            with open(fpath, "r") as f:
                combined.append(f.read())
    return "\n\n".join(combined), 200


@app.route("/extract", methods=["POST"])
def extract():
    """Given a URL in the raw POST body, return up to 4000 chars of
    extracted article text via trafilatura. Returns an empty string,
    not an error, on any failure. That lets the n8n caller fall back
    to the RSS summary without special-casing failure responses."""
    url = request.get_data(as_text=True).strip()
    if not url:
        return "", 200
    try:
        downloaded = trafilatura.fetch_url(url)
        if not downloaded:
            return "", 200
        text = trafilatura.extract(downloaded) or ""
        return text[:4000], 200
    except Exception:
        return "", 200


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
