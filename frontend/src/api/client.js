const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

const TOKEN_KEY = "pubcash_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

class ApiError extends Error {
  constructor(message, status, detail) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

async function request(path, { method = "GET", body, form, auth = true } = {}) {
  const headers = {};
  if (auth) {
    const token = getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }

  let payload;
  if (form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    payload = new URLSearchParams(form).toString();
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: payload,
  });

  if (res.status === 204) return null;

  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    const message = (data && data.detail) || res.statusText || "Request failed";
    throw new ApiError(message, res.status, data && data.detail);
  }

  return data;
}

export const api = {
  // Auth
  register: (username, password, invite_code) =>
    request("/auth/register", { method: "POST", body: { username, password, invite_code }, auth: false }),
  login: (username, password) => request("/auth/login", { method: "POST", form: { username, password }, auth: false }),
  me: () => request("/auth/me"),
  changePassword: (current_password, new_password) =>
    request("/auth/change-password", { method: "POST", body: { current_password, new_password } }),

  // Admin
  listUsers: (statusFilter) => request(`/admin/users${statusFilter ? `?status_filter=${statusFilter}` : ""}`),
  approveUser: (id) => request(`/admin/users/${id}/approve`, { method: "POST" }),
  suspendUser: (id) => request(`/admin/users/${id}/suspend`, { method: "POST" }),
  reactivateUser: (id) => request(`/admin/users/${id}/reactivate`, { method: "POST" }),
  deleteUser: (id) => request(`/admin/users/${id}`, { method: "DELETE" }),
  resetPassword: (id) => request(`/admin/users/${id}/reset-password`, { method: "POST" }),
  setUserRole: (id, role) => request(`/admin/users/${id}/role`, { method: "POST", body: { role } }),

  // Tills
  listTills: () => request("/tills"),
  createTill: (name, standard_float) => request("/tills", { method: "POST", body: { name, standard_float } }),
  deleteTill: (id) => request(`/tills/${id}`, { method: "DELETE" }),

  // Till sessions
  listTillSessions: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/till-sessions${qs ? `?${qs}` : ""}`);
  },
  getTillSession: (id) => request(`/till-sessions/${id}`),
  openTillSession: (till_id, opening_breakdown, note) =>
    request("/till-sessions/open", { method: "POST", body: { till_id, opening_breakdown, note } }),
  closeTillSession: (id, closing_breakdown, cash_sales, note) =>
    request(`/till-sessions/${id}/close`, { method: "POST", body: { closing_breakdown, cash_sales, note } }),
  reopenTillSession: (id, reason) =>
    request(`/till-sessions/${id}/reopen`, { method: "POST", body: { reason } }),
  cancelTillSession: (id, reason) =>
    request(`/till-sessions/${id}/cancel`, { method: "POST", body: { reason } }),
  importTillSessionToSafe: (id) =>
    request(`/till-sessions/${id}/import-to-safe`, { method: "POST" }),

  // Safe
  getSafeBalance: () => request("/safe/balance"),
  listSafeTransactions: () => request("/safe/transactions"),
  createSafeTransaction: (payload) => request("/safe/transactions", { method: "POST", body: payload }),
  closeBusinessDay: (counted_breakdown, note) =>
    request("/safe/close-business-day", { method: "POST", body: { counted_breakdown, note } }),
  listDayCloses: () => request("/safe/day-closes"),

  // Reports
  getSummary: (start_date, end_date) => {
    const qs = new URLSearchParams();
    if (start_date) qs.set("start_date", start_date);
    if (end_date) qs.set("end_date", end_date);
    return request(`/reports/summary${qs.toString() ? `?${qs}` : ""}`);
  },
  getVarianceAlerts: (threshold, start_date, end_date) => {
    const qs = new URLSearchParams();
    if (threshold !== undefined && threshold !== "") qs.set("threshold", threshold);
    if (start_date) qs.set("start_date", start_date);
    if (end_date) qs.set("end_date", end_date);
    return request(`/reports/variance-alerts${qs.toString() ? `?${qs}` : ""}`);
  },
};

export { ApiError };
