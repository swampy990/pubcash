import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import { useAuth } from "../context/AuthContext";

const STATUS_LABELS = {
  pending: "Pending approval",
  active: "Active",
  suspended: "Suspended",
};

export default function AdminUsers() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [resetResult, setResetResult] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.listUsers();
      setUsers(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const runAction = async (id, action) => {
    setError("");
    setBusyId(id);
    try {
      await action();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action failed");
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (u) => {
    if (!window.confirm(`Delete user "${u.username}"? This cannot be undone.`)) return;
    await runAction(u.id, () => api.deleteUser(u.id));
  };

  const handlePromote = async (u) => {
    if (!window.confirm(`Promote "${u.username}" to admin? They'll gain full access, including user management.`)) {
      return;
    }
    await runAction(u.id, () => api.setUserRole(u.id, "admin"));
  };

  const handleDemote = async (u) => {
    if (!window.confirm(`Demote "${u.username}" to staff? They'll lose admin access.`)) return;
    await runAction(u.id, () => api.setUserRole(u.id, "staff"));
  };

  const handleResetPassword = async (u) => {
    if (!window.confirm(`Reset password for "${u.username}"? A new temporary password will be generated.`)) return;
    setError("");
    setBusyId(u.id);
    try {
      const result = await api.resetPassword(u.id);
      setResetResult(result);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Reset failed");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="page">
      <h2>User Management</h2>

      {error && <div className="alert alert-error">{error}</div>}

      {resetResult && (
        <div className="alert alert-warning">
          Temporary password for <strong>{resetResult.username}</strong>:{" "}
          <code>{resetResult.temporary_password}</code>
          <br />
          Share this with the user securely &mdash; they'll be required to set a new password on next login.
          <button style={{ marginLeft: 12 }} onClick={() => setResetResult(null)}>
            Dismiss
          </button>
        </div>
      )}

      {loading ? (
        <p>Loading users...</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Username</th>
              <th>Role</th>
              <th>Status</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.username}</td>
                <td>{u.role}</td>
                <td>
                  <span className={`badge badge-${u.status}`}>{STATUS_LABELS[u.status]}</span>
                </td>
                <td>{new Date(u.created_at).toLocaleString()}</td>
                <td className="actions">
                  {u.status === "pending" && (
                    <button disabled={busyId === u.id} onClick={() => runAction(u.id, () => api.approveUser(u.id))}>
                      Approve
                    </button>
                  )}
                  {u.status === "active" && u.id !== currentUser.id && (
                    <button disabled={busyId === u.id} onClick={() => runAction(u.id, () => api.suspendUser(u.id))}>
                      Suspend
                    </button>
                  )}
                  {u.status === "suspended" && (
                    <button disabled={busyId === u.id} onClick={() => runAction(u.id, () => api.reactivateUser(u.id))}>
                      Reactivate
                    </button>
                  )}
                  {u.role === "staff" && (
                    <button disabled={busyId === u.id} onClick={() => handlePromote(u)}>
                      Promote to admin
                    </button>
                  )}
                  {u.role === "admin" && u.id !== currentUser.id && (
                    <button disabled={busyId === u.id} onClick={() => handleDemote(u)}>
                      Demote to staff
                    </button>
                  )}
                  <button disabled={busyId === u.id} onClick={() => handleResetPassword(u)}>
                    Reset password
                  </button>
                  {u.id !== currentUser.id && (
                    <button className="danger" disabled={busyId === u.id} onClick={() => handleDelete(u)}>
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
