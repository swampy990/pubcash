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
  const [deletingTillId, setDeletingTillId] = useState(null);
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

  const tillNameById = useMemo(() => {
    const map = {};
    tills.forEach((t) => {
      map[t.id] = t.name;
    });
    return map;
  }, [tills]);

  const selectedTill = useMemo(
    () => tills.find((t) => t.id === selectedTillId),
    [tills, selectedTillId]
  );

  // A till with no standard float configured is left at the 0 default, which isn't a real
  // target to compare against - only warn when one's actually been set.
  const standardFloat = selectedTill ? Number(selectedTill.standard_float) : 0;
  const openingCountedSoFar = breakdownTotal(breakdown);
  const openingFloatVariance =
    standardFloat > 0 ? openingCountedSoFar - standardFloat : 0;
  const openingFloatMismatch = standardFloat > 0 && Math.abs(openingFloatVariance) >= 0.005;

  const tillHasOpenSession = (tillId) => sessions.some((s) => s.till_id === tillId && s.status === "open");

  // When the open session for the selected till changes (switching tills, or a session just got
  // opened/reopened), pre-fill the close form from any existing closing count. For a session
  // that's been reopened after a previous close, this means editing/correcting that count rather
  // than recounting the whole till from scratch. For a session that's never been closed before,
  // closing_breakdown is null and this just clears the form as before.
  // Keyed only on the session id (not the whole object) so an unrelated data refresh elsewhere on
  // this page doesn't overwrite whatever the admin is part-way through typing.
  useEffect(() => {
    if (openSessionForSelectedTill && openSessionForSelectedTill.closing_breakdown) {
      setBreakdown(openSessionForSelectedTill.closing_breakdown);
      setCashSales(
        openSessionForSelectedTill.cash_sales !== null && openSessionForSelectedTill.cash_sales !== undefined
          ? String(openSessionForSelectedTill.cash_sales)
          : ""
      );
    } else {
      setBreakdown(EMPTY_BREAKDOWN);
      setCashSales("");
    }
    setNote("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSessionForSelectedTill?.id]);

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
      const result = await api.openTillSession(selectedTillId, breakdown, note || undefined);
      let message;
      if (standardFloat > 0) {
        const toppedUp = Number(result.opening_counted_total) - breakdownTotal(breakdown);
        message =
          toppedUp > 0.005
            ? `Till session opened. The safe topped the float up by £${toppedUp.toFixed(2)} to reach the ` +
              `standard float of £${standardFloat.toFixed(2)}.`
            : "Till session opened. No safe withdrawal was needed — the float was already there.";
      } else {
        message =
          breakdownTotal(breakdown) > 0
            ? "Till session opened. The float has been recorded as a withdrawal from the safe."
            : "Till session opened.";
      }
      setSuccess(message);
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

  const handleCancel = async (session) => {
    const tillName = tillNameById[session.till_id] || "this till";
    if (
      !window.confirm(
        `Cancel the open session on ${tillName}? This reverses any automatic float top-up that was ` +
          "drawn from the safe when it was opened (if the float was already sitting in the till, " +
          "there may be nothing to reverse). Any manual drops already made during this session will " +
          "NOT be reversed - they stay recorded as real cash movements."
      )
    ) {
      return;
    }
    const reason = window.prompt("Optional: why are you cancelling this session? (recorded in the session's note)");

    setError("");
    setSuccess("");
    try {
      await api.cancelTillSession(session.id, reason || undefined);
      setSuccess("Session cancelled.");
      resetForm();
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to cancel session");
    }
  };

  const handleDeleteTill = async (till) => {
    if (
      !window.confirm(
        `Delete till "${till.name}"? This only works if it has no session history - ` +
          "a till that's ever been opened will be refused."
      )
    ) {
      return;
    }
    setError("");
    setSuccess("");
    setDeletingTillId(till.id);
    try {
      await api.deleteTill(till.id);
      setSuccess(`Till "${till.name}" deleted.`);
      if (selectedTillId === till.id) setSelectedTillId("");
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete till");
    } finally {
      setDeletingTillId(null);
    }
  };

  const handleReopen = async (session) => {
    const tillName = tillNameById[session.till_id] || "this till";
    if (
      !window.confirm(
        `Reopen the session on ${tillName} closed ${new Date(session.closed_at).toLocaleString()}? ` +
          "Its previous count stays in place so you can correct it, rather than recounting from scratch."
      )
    ) {
      return;
    }
    const reason = window.prompt("Optional: why are you reopening this session? (recorded in the session's note)");

    setError("");
    setSuccess("");
    try {
      await api.reopenTillSession(session.id, reason || undefined);
      setSuccess("Session reopened - its previous count is ready to edit below.");
      setSelectedTillId(session.till_id);
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to reopen session");
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

          {tills.length > 0 && (
            <table className="table">
              <thead>
                <tr>
                  <th>Till</th>
                  <th>Standard float</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {tills.map((t) => (
                  <tr key={t.id}>
                    <td>{t.name}</td>
                    <td>£{Number(t.standard_float).toFixed(2)}</td>
                    <td className="actions">
                      <button
                        className="danger"
                        disabled={deletingTillId === t.id}
                        onClick={() => handleDeleteTill(t)}
                      >
                        {deletingTillId === t.id ? "Deleting..." : "Delete"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
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
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <h3>Close session</h3>
                {(user.role === "admin" || openSessionForSelectedTill.opened_by_id === user.id) && (
                  <button
                    type="button"
                    className="danger"
                    onClick={() => handleCancel(openSessionForSelectedTill)}
                    disabled={submitting}
                  >
                    Cancel session
                  </button>
                )}
              </div>
              <p className="muted">
                Opened by {openSessionForSelectedTill.opened_by_username || "someone else"}{" "}
                {new Date(openSessionForSelectedTill.opened_at).toLocaleString()} with a till float of £
                {Number(openSessionForSelectedTill.opening_counted_total).toFixed(2)}.
                {openSessionForSelectedTill.opened_by_id !== user.id && user.role !== "admin" && (
                  <> Only {openSessionForSelectedTill.opened_by_username || "they"} or an admin can cancel it, but
                  anyone can close it below.</>
                )}
              </p>

              {openSessionForSelectedTill.closing_breakdown && (
                <div className="alert alert-warning">
                  This session was reopened — the count below is what was previously recorded.
                  Correct whatever was wrong, then close it again.
                </div>
              )}

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
              <p className="muted">
                Count the float currently sitting in the till.
                {standardFloat > 0
                  ? ` This till's standard float is £${standardFloat.toFixed(2)} — if it's meant to have stayed ` +
                    "in the drawer overnight, count what's actually there. Coming up short will automatically " +
                    "top it back up from the safe; at or above standard, nothing is drawn."
                  : " This amount will automatically be recorded as a withdrawal from the safe."}
              </p>

              {openingFloatMismatch && (
                <div className="alert alert-warning">
                  {openingFloatVariance < 0 ? (
                    <>
                      Counted £{openingCountedSoFar.toFixed(2)} is £{Math.abs(openingFloatVariance).toFixed(2)} short
                      of this till's standard float of £{standardFloat.toFixed(2)}. Opening will automatically draw
                      that shortfall from the safe to top it back up.
                    </>
                  ) : (
                    <>
                      Counted £{openingCountedSoFar.toFixed(2)} is £{Math.abs(openingFloatVariance).toFixed(2)} over
                      this till's standard float of £{standardFloat.toFixed(2)}. No safe action is taken
                      automatically for this — worth checking why there's extra cash in the drawer.
                    </>
                  )}
                </div>
              )}

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
              <th>Till</th>
              <th>Opened by</th>
              <th>Closed by</th>
              <th>Closed</th>
              <th>Opening</th>
              <th>Closing</th>
              <th>Cash sales</th>
              <th>Expected</th>
              <th>Variance</th>
              {user.role === "admin" && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {closedHistory.map((s) => (
              <tr key={s.id}>
                <td>{tillNameById[s.till_id] || "—"}</td>
                <td>{s.opened_by_username || "—"}</td>
                <td>{s.closed_by_username || "—"}</td>
                <td>{new Date(s.closed_at).toLocaleString()}</td>
                <td>£{Number(s.opening_counted_total).toFixed(2)}</td>
                <td>£{Number(s.closing_counted_total).toFixed(2)}</td>
                <td>{s.cash_sales !== null ? `£${Number(s.cash_sales).toFixed(2)}` : "—"}</td>
                <td>£{Number(s.expected_closing_total).toFixed(2)}</td>
                <td className={Math.abs(Number(s.variance)) > 0 ? "variance-flag" : ""}>
                  £{Number(s.variance).toFixed(2)}
                </td>
                {user.role === "admin" && (
                  <td className="actions">
                    <button
                      disabled={tillHasOpenSession(s.till_id)}
                      title={
                        tillHasOpenSession(s.till_id)
                          ? "This till already has an open session - close that one first"
                          : undefined
                      }
                      onClick={() => handleReopen(s)}
                    >
                      Reopen
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
