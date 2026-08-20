import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  if (!user) return null;

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <nav className="navbar">
      <div className="navbar-brand">The Pub &mdash; Cash Management</div>
      <div className="navbar-links">
        <Link to="/">Dashboard</Link>
        <Link to="/till">Till Session</Link>
        <Link to="/safe">Safe</Link>
        {user.role === "admin" && <Link to="/reports">Reports</Link>}
        {user.role === "admin" && <Link to="/admin/users">Users</Link>}
      </div>
      <div className="navbar-user">
        <span>
          {user.username} <em>({user.role})</em>
        </span>
        <button onClick={handleLogout}>Log out</button>
      </div>
    </nav>
  );
}
