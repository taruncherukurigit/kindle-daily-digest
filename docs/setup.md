# Setup

## Prerequisites

- Two LXC containers on Proxmox VE (or equivalent): one running FreshRSS + n8n, one for the receiver
- FreshRSS with the Google Reader–compatible API enabled, and an API password set for your user
- A Gmail account with an [app password](https://myaccount.google.com/apppasswords) generated, and Send-to-Kindle enabled for that address on your Amazon account
- `pandoc` installed on the receiver container

## 1. FreshRSS

Create the 16 categories listed in the README, and subscribe 2-3 authoritative RSS feeds to each. Confirm the API is reachable and note your FreshRSS username and API password.

## 2. Receiver container

```bash
mkdir -p ~/kindle-digest && cd ~/kindle-digest
pip install flask trafilatura --break-system-packages
```

Copy `receiver/receiver.py` into this directory, along with your own `send_digest.py` (email-sending logic, not included here since it contains account-specific SMTP handling) and a real `.env` based on `receiver/.env.example`.

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

Check your Kindle/email for the test send.

## 3. n8n workflow

Build a workflow with, in order:

1. **Schedule Trigger** — two rules, e.g. 6:00 and 18:00 daily
2. **HTTP Request** — `POST` to `http://<freshrss-host>/api/greader.php/accounts/ClientLogin`, form-urlencoded body with `Email` and `Passwd`
3. **Code** — extract the auth token from the response:
   ```javascript
   const text = $input.first().json.data;
   const match = text.match(/Auth=(.*)/);
   return [{ json: { authToken: match[1] } }];
   ```
4. **Code** — paste `n8n-workflow/fetch-node.js`
5. **Code** — paste `n8n-workflow/assemble-node.js`
6. **HTTP Request** — `POST` to `http://<receiver-container-ip>:5000/receive-digest`, raw/text body set to the expression `{{ $json.digest }}`

Save and publish. Run **Execute Workflow** once to confirm the full chain works end to end.

## 4. Reboot survival

On the Proxmox host shell (not inside either container):

```bash
pct set <receiver-container-id> --onboot 1
pct set <n8n-container-id> --onboot 1
```

Confirm n8n's own container/Docker setup already has `restart: unless-stopped` (or equivalent) so it survives a reboot alongside the container itself.
