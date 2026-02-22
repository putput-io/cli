# @putput/cli

Upload files from your terminal. Get a CDN URL back. No signup required.

## Usage

```bash
# Upload a file — prints the CDN URL
npx @putput/cli upload photo.jpg

# Upload and get JSON output
npx @putput/cli upload photo.jpg --json

# List your files
npx @putput/cli ls

# Delete a file
npx @putput/cli rm <file-id>
```

## Install (optional)

```bash
npm install -g @putput/cli
putput upload photo.jpg
```

Or use directly with npx — no install needed.

## First run

On first run, create a guest token:

```bash
putput init --guest
```

This creates a token and stores it in `~/.putput/config.json`. No signup, no API keys to configure.

## Commands

### upload

```bash
putput upload <file>              # upload a file
putput upload <file> --json       # output JSON
putput upload <file> --prefix avatars  # organize with prefix
putput upload <file> --private    # private file (Pro only)
putput upload <file> --metadata '{"key":"value"}'  # attach metadata
putput upload <file> --tags foo,bar  # add tags
putput upload <file> --expires 2026-12-31T00:00:00Z  # set expiry
putput upload <file> --type image/png  # override content type
```

### upload-url

```bash
putput upload-url <url>           # upload a file from a URL
putput upload-url <url> --filename photo.jpg  # set filename
putput upload-url <url> --type image/jpeg  # set content type
```

### ls

```bash
putput ls                         # list all files
putput ls --prefix avatars        # filter by prefix
putput ls --project-id <id>       # filter by project
putput ls --tag <tag>             # filter by tag
putput ls --limit 10              # max results
putput ls --cursor <cursor>       # pagination
putput ls --json                  # output JSON
```

### rm

```bash
putput rm <file-id>               # delete a file
```

### token

```bash
putput token                      # show current token and config
```

### watch

```bash
putput watch <directory>          # watch a directory and auto-upload on changes
putput watch <directory> --prefix uploads  # organize with prefix
putput watch <directory> --json   # output JSON (one object per line)
```

### activity

```bash
putput activity                   # list recent activity
putput activity --limit 10        # limit results
putput activity --json            # output JSON
```

### projects

```bash
putput projects                   # list projects
putput projects --json            # output JSON
```

### export

```bash
putput export                     # export all account data as JSON
```

## JSON output

All commands support `--json` for machine-readable output. When piped (non-TTY), JSON is the default.

```bash
putput upload photo.jpg --json | jq '.public_url'
putput ls --json | jq '.files[].id'
```

## Plans

| Plan | Storage | Max File | Price |
|------|---------|----------|-------|
| Guest | 1 GB | 100 MB | Free, no signup |
| Free | 10 GB | 100 MB | Free |
| Pro | 100 GB | 500 MB | $9/mo |

$0 egress on all plans.

## Links

- Website: https://putput.io
- SDK: `npm install putput`
- Dashboard: https://putput.io/dashboard
- GitHub: https://github.com/putput-io
