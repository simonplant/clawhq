/**
 * Approvals page — pending approval queue with approve/reject actions.
 */

import type { ApprovalItem } from "../../evolve/approval/index.js";
import { Layout } from "../layout.js";

export function ApprovalsPage({ items }: { items: readonly ApprovalItem[] }) {
  const pendingCount = items.filter((i) => i.status === "pending").length;

  return (
    <Layout title="Approvals" activePath="/approvals">
      <hgroup>
        <h1>Approval Queue</h1>
        <p>
          {pendingCount > 0
            ? <span class="badge badge-pending">{pendingCount} pending</span>
            : <span class="badge badge-ok">No pending approvals</span>}
        </p>
      </hgroup>

      <div id="approval-list" hx-get="/api/approvals" hx-trigger="every 15s" hx-swap="innerHTML">
        <ApprovalList items={items} />
      </div>
    </Layout>
  );
}

export function ApprovalList({ items }: { items: readonly ApprovalItem[] }) {
  if (items.length === 0) {
    return <p><em>No pending items in the approval queue.</em></p>;
  }

  return (
    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th>Category</th>
          <th>Summary</th>
          <th>Source</th>
          <th>Created</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr>
            <td><code>{item.id.slice(0, 8)}</code></td>
            <td><span class="badge badge-pending">{item.category}</span></td>
            <td>{item.summary}</td>
            <td>{item.source}</td>
            <td>{new Date(item.createdAt).toLocaleString()}</td>
            <td>
              {item.status === "pending" ? (
                <>
                  <button
                    hx-post={`/api/approvals/${item.id}/approve`}
                    hx-target="#approval-list"
                    hx-swap="innerHTML"
                    class="outline"
                  >
                    Approve
                  </button>{" "}
                  <button
                    hx-post={`/api/approvals/${item.id}/reject`}
                    hx-target="#approval-list"
                    hx-swap="innerHTML"
                    class="outline secondary"
                  >
                    Reject
                  </button>
                </>
              ) : (
                <span class={item.status === "approved" ? "badge badge-ok" : "badge badge-err"}>
                  {item.status}
                </span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
