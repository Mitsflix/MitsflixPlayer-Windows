#!/usr/bin/env python3
"""Post a release announcement to a Discord channel through its webhook.

Reads DISCORD_WEBHOOK (a repository secret). Without it, or if Discord refuses, it says so and
exits 0: an announcement never fails a release.
    python3 discord_post.py --title "..." --url "..." [--notes-file f] [--footer "..."]
"""
import argparse, json, os, sys, urllib.request

LOGO = 'https://raw.githubusercontent.com/Mitsflix/MitsflixPlayer/main/extras/mitsflix-logos/logo_round.png'

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--title', required=True)
    ap.add_argument('--url', required=True)
    ap.add_argument('--notes-file')
    ap.add_argument('--footer', default='')
    a = ap.parse_args()
    hook = os.environ.get('DISCORD_WEBHOOK', '').strip()
    if not hook:
        print('No DISCORD_WEBHOOK secret: skipping the Discord post.')
        return
    notes = ''
    if a.notes_file and os.path.isfile(a.notes_file):
        notes = open(a.notes_file, encoding='utf-8').read().strip()
    body = notes
    if len(body) > 3000:
        body = body[:3000].rsplit('\n', 1)[0] + '\n…'
    if a.footer:
        body = (body + '\n\n' if body else '') + a.footer.replace('\\n', '\n')
    payload = {
        'username': 'Mitsflix',
        'avatar_url': LOGO,
        'embeds': [{'title': a.title, 'url': a.url, 'description': body, 'color': 0xF2B53E, 'thumbnail': {'url': LOGO}}],
        'allowed_mentions': {'parse': []},
    }
    req = urllib.request.Request(hook, data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json', 'User-Agent': 'MitsflixRelease/1.0'})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            print('Posted to Discord:', r.status)
    except Exception as e:  # noqa: BLE001 — never fail the release over an announcement
        print('::warning::Discord post failed:', e)

if __name__ == '__main__':
    main()
