import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import Navbar from "./components/Navbar";
import ProtectedRoute from "./components/ProtectedRoute";

import Login from "./pages/Login";
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard";
import ChangePassword from "./pages/ChangePassword";
import AdminUsers from "./pages/AdminUsers";
import TillSessionPage from "./pages/TillSessionPage";
import SafePage from "./pages/SafePage";
import Reports from "./pages/Reports";

function ForcePasswordChange({ children }) {
  const { user } = useAuth();
  if (user?.must_change_password) {
    return <Navigate to="/change-password" replace />;
  }
  return children;
}

export default function App() {
  return (
    <>
      <Navbar />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route
          path="/change-password"
          element={
            <ProtectedRoute>
              <ChangePassword />
            </ProtectedRoute>
          }
        />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <ForcePasswordChange>
                <Dashboard />
              </ForcePasswordChange>
            </ProtectedRoute>
          }
        />
        <Route
          path="/till"
          element={
            <ProtectedRoute>
              <ForcePasswordChange>
                <TillSessionPage />
              </ForcePasswordChange>
            </ProtectedRoute>
          }
        />
        <Route
          path="/safe"
          element={
            <ProtectedRoute>
              <ForcePasswordChange>
                <SafePage />
              </ForcePasswordChange>
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports"
          element={
            <ProtectedRoute adminOnly>
              <ForcePasswordChange>
                <Reports />
              </ForcePasswordChange>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/users"
          element={
            <ProtectedRoute adminOnly>
              <ForcePasswordChange>
                <AdminUsers />
              </ForcePasswordChange>
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
