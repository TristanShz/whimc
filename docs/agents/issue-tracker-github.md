# GitHub Issues — operations

All operations go through the `gh` CLI against `TristanShz/whimc`.

## Labels

| Label | Meaning |
| ----- | ------- |
| `spec` | The issue is a spec, not an implementation ticket. |
| `ticket` | An implementation ticket cut from a spec. |
| `ready-for-agent` | Triage: specified enough for an agent to pick up. |
| `needs-info` | Triage: blocked on a question for the maintainer. |

Create a label idempotently before applying it:

```bash
gh label create <name> --repo TristanShz/whimc --color <hex> --description "<meaning>" --force
```

## Create an issue

```bash
gh issue create --repo TristanShz/whimc --title "<title>" --body-file <file> --label spec --label ready-for-agent
```

## Read, comment, close

```bash
gh issue view <number> --repo TristanShz/whimc --comments
gh issue comment <number> --repo TristanShz/whimc --body-file <file>
gh issue close <number> --repo TristanShz/whimc
```
