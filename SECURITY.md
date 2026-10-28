# Security

## Reporting a vulnerability

Report security problems privately, not in a public issue. Use GitHub's private
vulnerability reporting: open the repository's **Security** tab and choose
**Report a vulnerability**.

## How keys are handled

- Keys live only in `.env` and `models.local.json`. Both files are git-ignored.
  Keys added in the page are saved to `models.local.json` as typed.
- `bench.yaml` refuses literal keys. An `apiKey` must be a `${NAME}` placeholder
  that is read from `.env`.
- Keys stay on the server. The page never receives them.
- Logs and `bench.json` store placeholders, not key values.
- Error text is redacted before it is shown or logged. The redaction masks
  common key formats, bearer tokens, AWS account numbers and ARNs.

## What you should do

- Never commit `.env` or `models.local.json`. Check `git status` before each commit.
- Check `bench.json` and the run logs before you share a run folder.
- Keep `bun dev` on `127.0.0.1`. Set `HOST` only on a network you trust.
- If a key ends up in a commit, an issue or a shared file, revoke it with the
  provider and create a new one.
