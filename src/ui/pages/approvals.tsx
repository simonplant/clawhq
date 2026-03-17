/**
 * Approvals page.
 *
 * Shows pending approval queue as card list with approve/reject action
 * buttons. Fetches from GET /api/v1/approvals and uses htmx POST for
 * approve/reject without page reload.
 */

import type { HtmlEscapedString } from "hono/utils/html";

import { Layout } from "../components/layout.js";

export function renderApprovalsPage(): HtmlEscapedString {
  return (
    <Layout title="Approvals">
      <hgroup>
        <h1>Approvals</h1>
        <p>Review and resolve pending agent actions</p>
      </hgroup>

      <div id="approvals-list">
        <p aria-busy="true">Loading approvals...</p>
      </div>

      <script>{`
        document.addEventListener('DOMContentLoaded', function() {
          loadApprovals();
        });

        function loadApprovals() {
          var listEl = document.getElementById('approvals-list');
          listEl.innerHTML = '<p aria-busy="true">Loading approvals...</p>';

          fetch('/api/v1/approvals')
            .then(function(r) { return r.json(); })
            .then(function(res) {
              if (!res.ok) {
                listEl.innerHTML = '<p class="status-error">Error: ' + escapeHtml(res.error || 'Unknown error') + '</p>';
                return;
              }
              renderApprovals(listEl, res.data);
              updateSidebarBadge(res.data);
            })
            .catch(function(err) {
              listEl.innerHTML = '<p class="status-error">Failed to load approvals: ' + escapeHtml(err.message) + '</p>';
            });
        }

        function renderApprovals(el, approvals) {
          if (!approvals || approvals.length === 0) {
            el.innerHTML =
              '<article class="empty-state">' +
              '<p>No pending approvals — your agent is waiting for nothing.</p>' +
              '</article>';
            return;
          }

          var html = '';
          approvals.forEach(function(entry) {
            html += renderCard(entry);
          });
          el.innerHTML = html;
        }

        function renderCard(entry) {
          var statusClass = 'approval-' + entry.status;
          var isResolved = entry.status !== 'pending';

          var html =
            '<article class="approval-card ' + statusClass + '" id="card-' + entry.id + '">' +
            '<header>' +
            '<div class="card-header-row">' +
            '<span class="category-badge">' + escapeHtml(formatCategory(entry.category)) + '</span>' +
            '<span class="status-badge approval-status-' + entry.status + '">' + entry.status.toUpperCase() + '</span>' +
            '</div>' +
            '</header>' +
            '<p class="card-description">' + escapeHtml(entry.description) + '</p>';

          if (entry.details) {
            html += '<p class="metric-label">' + escapeHtml(entry.details) + '</p>';
          }

          html += '<p class="metric-label">Queued: ' + formatTime(entry.createdAt) + '</p>';

          if (entry.rejectionReason) {
            html += '<p class="metric-label">Reason: ' + escapeHtml(entry.rejectionReason) + '</p>';
          }

          if (!isResolved) {
            html +=
              '<footer class="card-actions">' +
              '<button class="approve-btn" onclick="approveAction(\\'' + entry.id + '\\')">Approve</button>' +
              '<button class="reject-btn secondary" onclick="showRejectForm(\\'' + entry.id + '\\')">Reject</button>' +
              '<div class="reject-form" id="reject-form-' + entry.id + '" style="display:none; margin-top:0.5rem;">' +
              '<input type="text" id="reject-reason-' + entry.id + '" placeholder="Reason (optional)" style="margin-bottom:0.25rem;" />' +
              '<button class="contrast" onclick="rejectAction(\\'' + entry.id + '\\')">Confirm Reject</button>' +
              '</div>' +
              '</footer>';
          }

          if (isResolved && entry.resolvedAt) {
            html += '<p class="metric-label">Resolved: ' + formatTime(entry.resolvedAt) + '</p>';
          }

          html += '</article>';
          return html;
        }

        function approveAction(id) {
          var card = document.getElementById('card-' + id);
          var footer = card.querySelector('.card-actions');
          if (footer) footer.innerHTML = '<p aria-busy="true">Approving...</p>';

          fetch('/api/v1/approvals/' + id + '/approve', { method: 'POST' })
            .then(function(r) { return r.json(); })
            .then(function(res) {
              if (!res.ok) {
                if (footer) footer.innerHTML = '<p class="status-error">Error: ' + escapeHtml(res.error) + '</p>';
                return;
              }
              card.outerHTML = renderCard(res.data.entry);
              updateSidebarBadge(null);
            })
            .catch(function(err) {
              if (footer) footer.innerHTML = '<p class="status-error">' + escapeHtml(err.message) + '</p>';
            });
        }

        function showRejectForm(id) {
          var form = document.getElementById('reject-form-' + id);
          form.style.display = form.style.display === 'none' ? 'block' : 'none';
        }

        function rejectAction(id) {
          var reasonInput = document.getElementById('reject-reason-' + id);
          var reason = reasonInput ? reasonInput.value : '';
          var card = document.getElementById('card-' + id);
          var footer = card.querySelector('.card-actions');
          if (footer) footer.innerHTML = '<p aria-busy="true">Rejecting...</p>';

          fetch('/api/v1/approvals/' + id + '/reject', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: reason || undefined })
          })
            .then(function(r) { return r.json(); })
            .then(function(res) {
              if (!res.ok) {
                if (footer) footer.innerHTML = '<p class="status-error">Error: ' + escapeHtml(res.error) + '</p>';
                return;
              }
              card.outerHTML = renderCard(res.data.entry);
              updateSidebarBadge(null);
            })
            .catch(function(err) {
              if (footer) footer.innerHTML = '<p class="status-error">' + escapeHtml(err.message) + '</p>';
            });
        }

        function updateSidebarBadge(approvals) {
          if (approvals) {
            var count = approvals.filter(function(a) { return a.status === 'pending'; }).length;
            setSidebarCount(count);
          } else {
            // Re-fetch to get updated count
            fetch('/api/v1/approvals')
              .then(function(r) { return r.json(); })
              .then(function(res) {
                if (res.ok) {
                  var count = res.data.filter(function(a) { return a.status === 'pending'; }).length;
                  setSidebarCount(count);
                }
              });
          }
        }

        function setSidebarCount(count) {
          var badge = document.getElementById('approvals-badge');
          if (badge) {
            badge.textContent = count > 0 ? count : '';
            badge.style.display = count > 0 ? 'inline-block' : 'none';
          }
        }

        function formatCategory(cat) {
          return cat.replace(/_/g, ' ');
        }

        function formatTime(iso) {
          try {
            var d = new Date(iso);
            return d.toLocaleString();
          } catch(e) {
            return iso;
          }
        }

        function escapeHtml(str) {
          if (!str) return '';
          var div = document.createElement('div');
          div.textContent = str;
          return div.innerHTML;
        }

        // Poll for updates every 5s
        setInterval(function() {
          fetch('/api/v1/approvals')
            .then(function(r) { return r.json(); })
            .then(function(res) {
              if (res.ok) {
                updateSidebarBadge(res.data);
              }
            })
            .catch(function() {});
        }, 5000);
      `}</script>

      <style>{`
        .approval-card {
          margin-bottom: 1rem;
        }
        .card-header-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .category-badge {
          display: inline-block;
          padding: 0.1rem 0.4rem;
          border-radius: 4px;
          font-size: 0.75rem;
          font-weight: 600;
          text-transform: capitalize;
          background: #495057;
          color: #dee2e6;
        }
        .approval-status-pending { background: #e76f51; color: #fce4db; }
        .approval-status-approved { background: #2d6a4f; color: #b7e4c7; }
        .approval-status-rejected { background: #6c757d; color: #dee2e6; }
        .approval-status-expired { background: #495057; color: #adb5bd; }
        .approval-pending { border-left: 3px solid #e76f51; }
        .approval-approved { border-left: 3px solid #52b788; opacity: 0.7; }
        .approval-rejected { border-left: 3px solid #6c757d; opacity: 0.7; }
        .approval-expired { border-left: 3px solid #495057; opacity: 0.7; }
        .card-description {
          font-size: 1rem;
          margin: 0.5rem 0;
        }
        .card-actions {
          display: flex;
          gap: 0.5rem;
          flex-wrap: wrap;
          align-items: flex-start;
          padding: 0;
          margin: 0;
          border: none;
          background: none;
        }
        .approve-btn {
          min-width: 5rem;
        }
        .reject-btn {
          min-width: 5rem;
        }
        .empty-state {
          text-align: center;
          padding: 2rem;
        }
        .empty-state p {
          color: var(--pico-muted-color);
          font-size: 1.1rem;
        }
      `}</style>
    </Layout>
  ) as unknown as HtmlEscapedString;
}
