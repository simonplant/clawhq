/**
 * Todoist CLI tool generator.
 *
 * Generates a Python3 CLI for Todoist task management.
 * Integration: tasks (todoist) → requires TODOIST_API_KEY.
 */

export function generateTodoistTool(): string {
  return `#!/usr/bin/env python3
# todoist — Todoist CLI
# Usage: todoist <command> [args]

import sys
import os
import json
import requests
from datetime import date

TOKEN = os.environ.get("TODOIST_API_KEY")
if not TOKEN:
    print("ERROR: TODOIST_API_KEY env var is not set", file=sys.stderr)
    sys.exit(1)
BASE = "https://api.todoist.com/api/v1"
HEADERS = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}
PRI = {"1": "none", "2": "low", "3": "medium", "4": "high"}

def api(method, endpoint, **kwargs):
    r = requests.request(method, f"{BASE}{endpoint}", headers=HEADERS, **kwargs)
    if r.status_code in (200, 201, 204):
        return r.json() if r.content else {}
    print(f"ERROR {r.status_code}: {r.text[:300]}", file=sys.stderr)
    sys.exit(1)

def get_projects():
    return {p["name"].lower(): p["id"] for p in api("GET", "/projects").get("results", [])}

def fmt_task(t, indent=""):
    pri = PRI.get(str(t.get("priority", 1)), "none")
    due = (t.get("due") or {}).get("date", "")
    due_str = f"  [{due}]" if due else ""
    return f"{indent}[{pri}] {t.get('content', '')}{due_str}  id:{t.get('id', '')}"

def print_tasks(tasks, show_subtasks=True):
    top = [t for t in tasks if not t.get("parent_id")]
    children = {}
    for t in tasks:
        if t.get("parent_id"):
            children.setdefault(t["parent_id"], []).append(t)

    count = 0
    for t in top:
        print(fmt_task(t))
        count += 1
        if show_subtasks:
            for child in children.get(t["id"], []):
                print(fmt_task(child, "  > "))
                count += 1
    print(f"\\nTotal: {count} tasks")

cmd = sys.argv[1] if len(sys.argv) > 1 else "help"
args = sys.argv[2:]

if cmd == "projects":
    for p in api("GET", "/projects").get("results", []):
        inbox = " (inbox)" if p.get("inbox_project") else ""
        print(f"{p['id']}  {p['name']}{inbox}")

elif cmd == "list":
    if args:
        project_name = args[0].lower()
        projects = get_projects()
        if project_name not in projects:
            print(f"Project '{args[0]}' not found. Available: {', '.join(p.title() for p in projects)}")
            sys.exit(1)
        proj_id = projects[project_name]
        tasks = api("GET", f"/tasks?project_id={proj_id}").get("results", [])
    else:
        tasks = api("GET", "/tasks").get("results", [])
    print_tasks(tasks)

elif cmd == "today":
    today = date.today().isoformat()
    all_tasks = api("GET", "/tasks").get("results", [])
    due_tasks = [
        t for t in all_tasks
        if not t.get("parent_id")
        and (t.get("due") or {}).get("date", "9999") <= today
    ]
    urgent = [
        t for t in all_tasks
        if not t.get("parent_id")
        and t.get("priority", 1) == 4
        and not (t.get("due") or {}).get("date")
    ]
    combined = {t["id"]: t for t in due_tasks + urgent}
    tasks = sorted(combined.values(), key=lambda t: (
        -(t.get("priority", 1)),
        (t.get("due") or {}).get("date", "9999")
    ))
    print_tasks(tasks, show_subtasks=False)

elif cmd == "add":
    if not args:
        print("Usage: todoist add \\"Task title\\" [--project X] [--due DATE] [--priority 1-4]")
        sys.exit(1)

    content = args[0]
    project_name = None
    due = None
    priority = 1

    i = 1
    while i < len(args):
        if args[i] == "--project" and i + 1 < len(args):
            project_name = args[i+1]; i += 2
        elif args[i] == "--due" and i + 1 < len(args):
            due = args[i+1]; i += 2
        elif args[i] == "--priority" and i + 1 < len(args):
            priority = int(args[i+1]); i += 2
        else:
            i += 1

    payload = {"content": content, "priority": priority}
    if project_name:
        projects = get_projects()
        pid = projects.get(project_name.lower())
        if pid:
            payload["project_id"] = pid
        else:
            print(f"Warning: project '{project_name}' not found, adding to Inbox")
    if due:
        payload["due_string"] = due

    t = api("POST", "/tasks", json=payload)
    print(f"Created: {t.get('content')}  id:{t.get('id')}")

elif cmd == "complete":
    if not args:
        print("Usage: todoist complete <id>")
        sys.exit(1)
    api("POST", f"/tasks/{args[0]}/close")
    print(f"Completed: {args[0]}")

elif cmd == "delete":
    if not args:
        print("Usage: todoist delete <id>")
        sys.exit(1)
    api("DELETE", f"/tasks/{args[0]}")
    print(f"Deleted: {args[0]}")

elif cmd == "update":
    if not args:
        print("Usage: todoist update <id> [--priority 1-4] [--due DATE] [--title TEXT]")
        sys.exit(1)
    task_id = args[0]
    payload = {}
    i = 1
    while i < len(args):
        if args[i] == "--priority" and i + 1 < len(args):
            payload["priority"] = int(args[i+1]); i += 2
        elif args[i] == "--due" and i + 1 < len(args):
            payload["due_string"] = args[i+1]; i += 2
        elif args[i] == "--title" and i + 1 < len(args):
            payload["content"] = args[i+1]; i += 2
        elif args[i] == "--notes" and i + 1 < len(args):
            payload["description"] = args[i+1]; i += 2
        else:
            i += 1
    t = api("POST", f"/tasks/{task_id}", json=payload)
    print(f"Updated: {t.get('content')}  id:{t.get('id')}")

else:
    print("""todoist — Todoist CLI

Commands:
  projects                                    List all projects
  list [project]                              List tasks (filter by project name)
  today                                       Due today + overdue + urgent (no subtasks)
  add "Title" [--project X] [--due DATE] [--priority 1-4]
  complete <id>                               Mark complete
  delete <id>                                 Delete task
  update <id> [--priority N] [--due DATE] [--title TEXT] [--notes TEXT]

Priority: 1=none 2=low 3=medium 4=high""")
`;
}
