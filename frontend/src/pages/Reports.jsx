import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";

function toDateInputValue(date) {
  return date.toISOString().slice(0, 10);
}

export default function Reports() {
  const today = new Date();
  const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [startDate, setStartDate] = useState(toDateInputValue(weekAgo));
  const [endDate, setEndDate] = useState(toDateInputValue(today));
  const [threshold, setThreshold] = useState("");
  const [summary, setSummary] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const startIso = new Date(`${startDate}T00:00:00Z`).toISOString();
      const endIso = new Date(`${endDate}T23:59:59Z`).toISOString();
      const [summaryRes, alertsRes] = await Promise.all([
        api.getSummary(startIso, endIso),
        api.getVarianceAlerts(threshold, startIso, endIso),
      ]);
      setSummary(summaryRes);
      setAlerts(alertsRes);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load reports");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="page">
      <h2>Reports</h2>

      {error && <div className="alert alert-error">{error}</div>}

      <form
        className="card filters"
        onSubmit={(e) => {
          e.preventDefault();
          load();
        }}
      >
        <label htmlFor="start-date">From</label>
        <input id="start-date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />

        <label htmlFor="end-date">To</label>
        <input id="end-date" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />

        <label htmlFor="threshold">Variance alert threshold (£)</label>
        <input
          id="threshold"
          type="number"
          min="0"
          step="0.01"
          placeholder="default"
          value={threshold}
          onChange={(e) => setThreshold(e.target.value)}
        />

        <button type="submit">Apply</button>
      </form>

      {loading ? (
        <p>Loading...</p>
      ) : (
        <>
          {summary && (
            <div className="dashboard-grid">
              <div className="card stat-card">
                <span>Sessions closed</span>
                <strong>{summary.sessions_closed}</strong>
              </div>
              <div className="card stat-card">
                <span>Total opening floats</span>
                <strong>£{Number(summary.total_opening_floats).toFixed(2)}</strong>
              </div>
              <div className="card stat-card">
                <span>Total closing counted</span>
                <strong>£{Number(summary.total_closing_counted).toFixed(2)}</strong>
              </div>
              <div className="card stat-card">
                <span>Total cash sales</span>
                <strong>£{Number(summary.total_cash_sales).toFixed(2)}</strong>
              </div>
              <div className="card stat-card">
                <span>Total variance</span>
                <strong className={Number(summary.total_variance) !== 0 ? "variance-flag" : ""}>
                  £{Number(summary.total_variance).toFixed(2)}
                </strong>
              </div>
              <div className="card stat-card">
                <span>Safe drops (period)</span>
                <strong>£{Number(summary.total_safe_drops).toFixed(2)}</strong>
              </div>
              <div className="card stat-card">
                <span>Safe withdrawals (period)</span>
                <strong>£{Number(summary.total_safe_withdrawals).toFixed(2)}</strong>
              </div>
              <div className="card stat-card">
                <span>Current safe balance</span>
                <strong>£{Number(summary.safe_balance).toFixed(2)}</strong>
              </div>
            </div>
          )}

          <h3>Variance / discrepancy alerts</h3>
          {alerts.length === 0 ? (
            <p className="muted">No sessions over the threshold in this period.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Till</th>
                  <th>Opened by</th>
                  <th>Closed by</th>
                  <th>Closed</th>
                  <th>Variance</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((a) => (
                  <tr key={a.till_session_id}>
                    <td>{a.till_name}</td>
                    <td>{a.opened_by}</td>
                    <td>{a.closed_by || "—"}</td>
                    <td>{a.closed_at ? new Date(a.closed_at).toLocaleString() : "—"}</td>
                    <td className="variance-flag">£{Number(a.variance).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
