import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Dashboard() {
  const { user } = useAuth();

  return (
    <div className="page">
      <h2>Welcome, {user.username}</h2>
      <p className="muted">Role: {user.role}</p>

      <div className="dashboard-grid">
        <Link to="/till" className="dashboard-tile">
          <h3>Till Session</h3>
          <p>Open or close a till, count cash, and record the float.</p>
        </Link>
        <Link to="/safe" className="dashboard-tile">
          <h3>Safe</h3>
          <p>View the safe balance, log drops and (admin) withdrawals.</p>
        </Link>
        {user.role === "admin" && (
          <Link to="/reports" className="dashboard-tile">
            <h3>Reports</h3>
            <p>Daily/weekly summaries and variance discrepancy alerts.</p>
          </Link>
        )}
        {user.role === "admin" && (
          <Link to="/admin/users" className="dashboard-tile">
            <h3>Users</h3>
            <p>Approve new accounts, reset passwords, suspend or delete users.</p>
          </Link>
        )}
      </div>
    </div>
  );
}
