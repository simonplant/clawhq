
## Sprint Orchestration (aishore)

AI sprint runner. Backlog lives in `backlog/`, tool lives in `.aishore/`. Run `.aishore/aishore help` for full usage.

```bash
.aishore/aishore run [N|ID]         # Run sprints (branch, commit, merge, push per item)
.aishore/aishore groom [--backlog]  # Groom bugs or features
.aishore/aishore review             # Architecture review
.aishore/aishore status             # Backlog overview
```

After modifying `.aishore/` files, run `.aishore/aishore checksums` before committing.
