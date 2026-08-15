# Setup

## Prerequisites

- Two LXC containers on Proxmox VE (or equivalent). One runs FreshRSS and n8n, one runs the receiver.
- FreshRSS with the Google Reader compatible API enabled, and an API password set for your user.
- A Gmail account with an [app password](https://myaccount.google.com/apppasswords) generated, and Send-to-Kindle enabled for that address on your Amazon account.
- `pandoc` installed on the receiver container.

## 1. FreshRSS

Create the 18 categories listed in the README. Subscribe 2 to 3 readable, authoritative RSS feeds to each. Two categories, Entertainment and Facts and Things to Know, are lighter weight by design and get a higher per-run article cap in `assemble-node.js` (`CATEGORY_LIMITS`).

Category names have to match exactly. The fetch node uses the `categories` array in `n8n-workflow/fetch-node.js` to build the FreshRSS API request URL, so if you rename or add a category, update that array to match the FreshRSS label character for character. Watch spacing too. `"Facts/ Things to Know"` has no space before the slash and one after.

Confirm the API is reachable and note your FreshRSS username and API password.

You can export a snapshot of the current feed list any time from FreshRSS. Settings, Import/Export, Download OPML. This repo doesn't commit a live copy of that file since the feed list changes often. Export your own current list if you want a backup.

## 2. Receiver container

```bash
mkdir -p ~/kindle-digest && cd ~/kindle-digest
pip install flask trafilatura --break-system-packages
```

Copy `receiver/receiver.py` into this directory. Add your own `send_digest.py` (email-sending logic, not included here since it contains account-specific SMTP handling) and a real `.env` based on `receiver/.env.example`.

Note on images: the receiver's `/extract` endpoint calls `trafilatura.extract()` with default output, which returns plain text only. It doesn't extract images. An earlier version of this pipeline tried to embed article images through RSS enclosure tags and an HTML `<img>` fallback in `assemble-node.js`. Coverage stayed too inconsistent across feeds to be worth it, so images were removed from the digest entirely. See `docs/tradeoffs.md` for the full reasoning.

Install the systemd service:

```bash
sudo cp receiver/digest-receiver.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable digest-receiver
sudo systemctl start digest-receiver
```

Confirm it's running:

```bash
curl http://localhost:5000/receive-digest -d "# Test Digest

This is a test."
```

Check your Kindle or email for the test send.

## 3. n8n workflow

Build a workflow with, in order:

1. **Schedule Trigger**: two rules, for example 6:00 and 18:00 daily.
2. **HTTP Request**: POST to `http://<freshrss-host>/api/greader.php/accounts/ClientLogin`, form-urlencoded body with `Email` and `Passwd`.
3. **Code**: extract the auth token from the response.
   ```javascript
   const text = $input.first().json.data;
   const match = text.match(/Auth=(.*)/);
   return [{ json: { authToken: match[1] } }];
   ```
4. **Code**: paste `n8n-workflow/fetch-node.js`.
5. **Code**: paste `n8n-workflow/assemble-node.js`.
6. **HTTP Request**: POST to `http://<receiver-container-ip>:5000/receive-digest`, raw text body set to the expression `{{ $json.digest }}`.

Save and publish. Run Execute Workflow once to confirm the full chain works end to end.

A note on testing: the fetch node marks every article it retrieves as read in FreshRSS right after fetching, so the next run only sees new content. That's correct in production. It also means repeated manual test runs in a short window drain each category's unread backlog faster than FreshRSS can refill it. Categories can come back empty during rapid testing even when nothing is broken. If a test run looks thin, that's usually why. Give FreshRSS time to pull fresh articles before assuming something is wrong.

## 4. Reboot survival

On the Proxmox host shell, not inside either container:

```bash
pct set <receiver-container-id> --onboot 1
pct set <n8n-container-id> --onboot 1
```

Confirm n8n's own container or Docker setup already has `restart: unless-stopped` (or equivalent), so it survives a reboot along with the container itself.
