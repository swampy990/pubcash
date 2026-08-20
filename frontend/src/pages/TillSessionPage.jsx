import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api/client";
import { useAuth } from "../context/AuthContext";
import DenominationCounter, { breakdownTotal } from "../components/DenominationCounter";

const EMPTY_BREAKDOWN = {};

export default function TillSessionPage() {
  const { user } = useAuth();
  const [tills, setTills] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [selectedTillId, setSelectedTillId] = useState("");
  const [breakdown, setBreakdown] = useState(EMPTY_BREAKDOWN);
  const [cashSales, setCashSales] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [newTillName, setNewTillName] = useState("");
  const [newTillFloat, setNewTillFloat] = useState("");
  const [creatingTill, setCreatingTill] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [tillList, sessionList] = await Promise.all([api.listTills(), api.listTillSessions()]);
      setTills(tillList);
      setSessions(sessionList);
      if (!selectedTillId && tillList.length > 0) setSelectedTillId(tillList[0].id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load till data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openSessionForSelectedTill = useMemo(
    () => sessions.find((s) => s.till_id === selectedTillId && s.status === "open"),
    [sessions, selectedTillId]
  );

  const closedHistory = useMemo(
    () => sessions.filter((s) => s.status === "closed").slice(0, 15),
    [sessions]
  );

  const resetForm = () => {
    setBreakdown(EMPTY_BREAKDOWN);
    setCashSales("");
    setNote("");
  };

  const handleCreateTill = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setCreatingTill(true);
    try {
      const till = await api.createTill(newTillName, newTillFloat === "" ? 0 : Number(newTillFloat));
      setNewTillName("");
      setNewTillFloat("");
      setSuccess(`Till "${till.name}" created.`);
      await loadAll();
      setSelectedTillId(till.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create till");
    } finally {
      setCreatingTill(false);
    }
  };

  const handleOpen = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setSubmitting(true);
    try {
      await api.openTillSession(selectedTillId, breakdown, note || undefined);
      setSuccess("Till session opened.");
      resetForm();
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to open till session");
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setSubmitting(true);
    try {
      const result = await api.closeTillSession(
        openSessionForSelectedTill.id,
        breakdown,
        cashSales === "" ? undefined : Number(cashSales),
        note || undefined
      );
      setSuccess(
        `Till session closed. Variance: £${Number(result.variance).toFixed(2)}` +
          (Math.abs(Number(result.variance)) > 0 ? " (please double-check the count)" : "")
      );
      resetForm();
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to close till session");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="page">Loading...</div>;

  return (
    <div className="page">
      <h2>Till Session</h2>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {user.role === "admin" && (
        <details className="card">
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>Manage tills</summary>
          <form onSubmit={handleCreateTill}>
            <label htmlFor="new-till-name">New till name</label>
            <input
              id="new-till-name"
              type="text"
              value={newTillName}
              onChange={(e) => setNewTillName(e.target.value)}
              placeholder="e.g. Main Bar"
              required
            />
            <label htmlFor="new-till-float">Standard opening float (£, optional)</label>
            <input
              id="new-till-float"
              type="number"
              min="0"
              step="0.01"
              value={newTillFloat}
              onChange={(e) => setNewTillFloat(e.target.value)}
              placeholder="0.00"
            />
            <button type="submit" disabled={creatingTill}>
              {creatingTill ? "Adding..." : "Add till"}
            </button>
          </form>
        </details>
      )}

      {tills.length === 0 ? (
        <p>No tills have been set up yet. {user.role === "admin" ? "Add one above." : "Ask an admin to add one."}</p>
      ) : (
        <>
          <label htmlFor="till-select">Till</label>
          <select id="till-select" value={selectedTillId} onChange={(e) => setSelectedTillId(e.target.value)}>
            {tills.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} (standard float £{Number(t.standard_float).toFixed(2)})
              </option>
            ))}
          </select>

          {openSessionForSelectedTill ? (
            <form className="card" onSubmit={handleClose}>
              <h3>Close session</h3>
              <p className="muted">
                Opened {new Date(openSessionForSelectedTill.opened_at).toLocaleString()} with opening float £
                {Number(openSessionForSelectedTill.opening_counted_total).toFixed(2)}
              </p>

              <label htmlFor="cash-sales">Cash sales recorded by EPOS/till roll (optional)</label>
              <input
                id="cash-sales"
                type="number"
                min="0"
                step="0.01"
                value={cashSales}
                onChange={(e) => setCashSales(e.target.value)}
                placeholder="0.00"
              />

              <h4>Count the closing cash</h4>
              <DenominationCounter value={breakdown} onChange={setBreakdown} disabled={submitting} />

              <label htmlFor="close-note">Note (optional)</label>
              <textarea id="close-note" value={note} onChange={(e) => setNote(e.target.value)} />

              <button type="submit" disabled={submitting}>
                {submitting ? "Closing..." : `Close session (counted £${breakdownTotal(breakdown).toFixed(2)})`}
              </button>
            </form>
          ) : (
            <form className="card" onSubmit={handleOpen}>
              <h3>Open session</h3>
              <p className="muted">Count the starting float in the till.</p>

              <DenominationCounter value={breakdown} onChange={setBreakdown} disabled={submitting} />

              <label htmlFor="open-note">Note (optional)</label>
              <textarea id="open-note" value={note} onChange={(e) => setNote(e.target.value)} />

              <button type="submit" disabled={submitting}>
                {submitting ? "Opening..." : `Open session (counted £${breakdownTotal(breakdown).toFixed(2)})`}
              </button>
            </form>
          )}
        </>
      )}

      <h3>Recent closed sessions</h3>
      {closedHistory.length === 0 ? (
        <p className="muted">No closed sessions yet.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Closed</th>
              <th>Opening</th>
              <th>Closing</th>
              <th>Cash sales</th>
              <th>Expected</th>
              <th>Variance</th>
            </tr>
          </thead>
          <tbody>
            {closedHistory.map((s) => (
              <tr key={s.id}>
                <td>{new Date(s.closed_at).toLocaleString()}</td>
                <td>£{Number(s.opening_counted_total).toFixed(2)}</td>
                <td>£{Number(s.closing_counted_total).toFixed(2)}</td>
                <td>{s.cash_sales !== null ? `£${Number(s.cash_sales).toFixed(2)}` : "—"}</td>
                <td>£{Number(s.expected_closing_total).toFixed(2)}</td>
                <td className={Math.abs(Number(s.variance)) > 0 ? "variance-flag" : ""}>
                  £{Number(s.variance).toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
