import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api/client";
import { useAuth } from "../context/AuthContext";
import DenominationCounter, { breakdownTotal } from "../components/DenominationCounter";

const EMPTY_BREAKDOWN = {};

export default function SafePage() {
  const { user } = useAuth();
  const [balance, setBalance] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [openSessions, setOpenSessions] = useState([]);
  const [closedSessions, setClosedSessions] = useState([]);
  const [tills, setTills] = useState([]);
  const [dayCloses, setDayCloses] = useState([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(true);

  const [type, setType] = useState("drop");
  const [breakdown, setBreakdown] = useState(EMPTY_BREAKDOWN);
  const [amount, setAmount] = useState("");
  const [tillSessionId, setTillSessionId] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [importingId, setImportingId] = useState(null);

  const [showDayClose, setShowDayClose] = useState(false);
  const [dayCloseBreakdown, setDayCloseBreakdown] = useState(EMPTY_BREAKDOWN);
  const [dayCloseNote, setDayCloseNote] = useState("");
  const [closingDay, setClosingDay] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const calls = [
        api.getSafeBalance(),
        api.listSafeTransactions(),
        api.listTillSessions({ status_filter: "open" }),
        api.listTillSessions({ status_filter: "closed" }),
        api.listTills(),
      ];
      if (user.role === "admin") calls.push(api.listDayCloses());

      const [balanceRes, txRes, openRes, closedRes, tillsRes, dayClosesRes] = await Promise.all(calls);
      setBalance(balanceRes.balance);
      setTransactions(txRes);
      setOpenSessions(openRes);
      setClosedSessions(closedRes);
      setTills(tillsRes);
      if (user.role === "admin") setDayCloses(dayClosesRes || []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load safe data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tillNameById = useMemo(() => {
    const map = {};
    tills.forEach((t) => {
      map[t.id] = t.name;
    });
    return map;
  }, [tills]);

  const tillById = useMemo(() => {
    const map = {};
    tills.forEach((t) => {
      map[t.id] = t;
    });
    return map;
  }, [tills]);

  // The standard float stays physically in the till overnight - only the takings above it
  // actually get walked to the safe. Mirrors the backend's import-to-safe calculation exactly so
  // the amount shown here is the amount that will really be recorded.
  const takingsFor = (session) => {
    const till = tillById[session.till_id];
    const standardFloat = till ? Number(till.standard_float) : 0;
    const closingTotal = Number(session.closing_counted_total) || 0;
    return standardFloat > 0 ? Math.max(0, closingTotal - standardFloat) : closingTotal;
  };

  const pendingImport = useMemo(
    () => closedSessions.filter((s) => !s.imported_to_safe),
    [closedSessions]
  );

  // Server enforces this too, but mirroring it client-side lets the button be disabled up front
  // with an explanation, rather than the admin filling in a whole count only to be told no.
  const dayCloseBlockers = [];
  if (openSessions.length > 0) {
    dayCloseBlockers.push(`${openSessions.length} till session(s) still open`);
  }
  if (pendingImport.length > 0) {
    dayCloseBlockers.push(`${pendingImport.length} closed till session(s) not yet imported to the safe`);
  }
  const canCloseDay = dayCloseBlockers.length === 0;

  const resetForm = () => {
    setBreakdown(EMPTY_BREAKDOWN);
    setAmount("");
    setTillSessionId("");
    setNote("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    const effectiveAmount = type === "drop" ? breakdownTotal(breakdown) : Number(amount);
    if (!effectiveAmount || effectiveAmount === 0) {
      setError("Enter a non-zero amount");
      return;
    }

    setSubmitting(true);
    try {
      await api.createSafeTransaction({
        type,
        amount: effectiveAmount,
        breakdown: type === "drop" ? breakdown : undefined,
        till_session_id: type === "drop" && tillSessionId ? tillSessionId : undefined,
        note: note || undefined,
      });
      setSuccess("Transaction recorded.");
      resetForm();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to record transaction");
    } finally {
      setSubmitting(false);
    }
  };

  const handleImport = async (session) => {
    const tillName = tillNameById[session.till_id] || "this till";
    const till = tillById[session.till_id];
    const standardFloat = till ? Number(till.standard_float) : 0;
    const takings = takingsFor(session);
    const confirmMessage =
      standardFloat > 0
        ? `Import £${takings.toFixed(2)} of takings from ${tillName} into the safe, leaving the £` +
          `${standardFloat.toFixed(2)} standard float in the till? Take the takings out and put them in the ` +
          "safe now."
        : `Import £${takings.toFixed(2)} from ${tillName} into the safe? Take that cash out of the till and put ` +
          "it in the safe now.";
    if (!window.confirm(confirmMessage)) {
      return;
    }
    setError("");
    setSuccess("");
    setImportingId(session.id);
    try {
      await api.importTillSessionToSafe(session.id);
      setSuccess(
        takings > 0
          ? `£${takings.toFixed(2)} of ${tillName}'s takings has been added to the safe.`
          : `${tillName} marked as imported — nothing to add to the safe this time.`
      );
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to import till cash to safe");
    } finally {
      setImportingId(null);
    }
  };

  const handleCloseDay = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setClosingDay(true);
    try {
      const result = await api.closeBusinessDay(dayCloseBreakdown, dayCloseNote || undefined);
      setSuccess(
        `Business day closed. Counted £${Number(result.counted_total).toFixed(2)} against an expected £` +
          `${Number(result.expected_balance).toFixed(2)} (variance £${Number(result.variance).toFixed(2)}` +
          (Math.abs(Number(result.variance)) > 0 ? " - please double-check the count" : "") +
          ")."
      );
      setDayCloseBreakdown(EMPTY_BREAKDOWN);
      setDayCloseNote("");
      setShowDayClose(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to close business day");
    } finally {
      setClosingDay(false);
    }
  };

  if (loading) return <div className="page">Loading...</div>;

  return (
    <div className="page">
      <h2>Safe</h2>

      <div className="card safe-balance">
        <span>Current safe balance</span>
        <strong>£{Number(balance).toFixed(2)}</strong>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <h3>Tills ready to import</h3>
      {pendingImport.length === 0 ? (
        <p className="muted">No closed tills waiting to be imported into the safe.</p>
      ) : (
        <div className="till-import-grid">
          {pendingImport.map((s) => {
            const till = tillById[s.till_id];
            const standardFloat = till ? Number(till.standard_float) : 0;
            const takings = takingsFor(s);
            return (
              <div className="card till-import-card" key={s.id}>
                <div className="till-import-name">{tillNameById[s.till_id] || "Unknown till"}</div>
                <div className="till-import-total">£{takings.toFixed(2)}</div>
                <p className="muted">{standardFloat > 0 ? "takings to import" : "to import"}</p>
                <p className="muted">
                  Closed £{Number(s.closing_counted_total).toFixed(2)}
                  {standardFloat > 0 && ` — £${standardFloat.toFixed(2)} float stays in the till`}
                </p>
                <p className="muted">Closed {new Date(s.closed_at).toLocaleString()}</p>
                {user.role === "admin" ? (
                  <button onClick={() => handleImport(s)} disabled={importingId === s.id}>
                    {importingId === s.id
                      ? "Importing..."
                      : takings > 0
                      ? "Import to safe"
                      : "Mark imported"}
                  </button>
                ) : (
                  <p className="muted">Ask an admin to import this.</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {user.role === "admin" && (
        <div className="card">
          <h3>Close business day</h3>
          {!canCloseDay && (
            <div className="alert alert-warning">
              Not ready to close yet: {dayCloseBlockers.join("; ")}.
            </div>
          )}
          {!showDayClose ? (
            <button disabled={!canCloseDay} onClick={() => setShowDayClose(true)}>
              Close business day
            </button>
          ) : (
            <form onSubmit={handleCloseDay}>
              <p className="muted">
                Take all the cash out of the safe and count it in full, then enter the count below to
                reconcile against the ledger (expected balance £{Number(balance).toFixed(2)}).
              </p>
              <DenominationCounter value={dayCloseBreakdown} onChange={setDayCloseBreakdown} disabled={closingDay} />

              <label htmlFor="day-close-note">Note (optional)</label>
              <textarea
                id="day-close-note"
                value={dayCloseNote}
                onChange={(e) => setDayCloseNote(e.target.value)}
              />

              <div className="actions">
                <button type="submit" disabled={closingDay}>
                  {closingDay
                    ? "Closing..."
                    : `Confirm close (counted £${breakdownTotal(dayCloseBreakdown).toFixed(2)})`}
                </button>
                <button type="button" disabled={closingDay} onClick={() => setShowDayClose(false)}>
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      <form className="card" onSubmit={handleSubmit}>
        <h3>New transaction</h3>

        <label htmlFor="tx-type">Type</label>
        <select id="tx-type" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="drop">Drop (till → safe)</option>
          {user.role === "admin" && <option value="withdrawal">Withdrawal (safe → bank/out)</option>}
          {user.role === "admin" && <option value="adjustment">Adjustment (manual correction)</option>}
        </select>

        {type === "drop" && (
          <>
            <label htmlFor="tx-session">Link to your open till session (optional)</label>
            <select id="tx-session" value={tillSessionId} onChange={(e) => setTillSessionId(e.target.value)}>
              <option value="">— none —</option>
              {openSessions.map((s) => (
                <option key={s.id} value={s.id}>
                  Session opened {new Date(s.opened_at).toLocaleString()}
                </option>
              ))}
            </select>

            <h4>Count the cash being dropped</h4>
            <DenominationCounter value={breakdown} onChange={setBreakdown} disabled={submitting} />
          </>
        )}

        {type === "withdrawal" && (
          <>
            <label htmlFor="tx-amount">Amount withdrawn</label>
            <input
              id="tx-amount"
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </>
        )}

        {type === "adjustment" && (
          <>
            <label htmlFor="tx-amount">Adjustment amount (use a negative number to remove cash)</label>
            <input
              id="tx-amount"
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </>
        )}

        <label htmlFor="tx-note">Note {type === "adjustment" ? "(explain the reason)" : "(optional)"}</label>
        <textarea
          id="tx-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          required={type === "adjustment"}
        />

        <button type="submit" disabled={submitting}>
          {submitting ? "Recording..." : "Record transaction"}
        </button>
      </form>

      <h3>Recent transactions</h3>
      {transactions.length === 0 ? (
        <p className="muted">No transactions yet.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Amount</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {transactions.slice(0, 20).map((t) => (
              <tr key={t.id}>
                <td>{new Date(t.created_at).toLocaleString()}</td>
                <td>
                  {t.type}
                  {t.is_automatic ? " (auto)" : ""}
                </td>
                <td className={Number(t.amount) < 0 ? "variance-flag" : ""}>£{Number(t.amount).toFixed(2)}</td>
                <td>{t.note || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {user.role === "admin" && (
        <>
          <h3>Business day close history</h3>
          {dayCloses.length === 0 ? (
            <p className="muted">No business days closed yet.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Closed</th>
                  <th>Expected</th>
                  <th>Counted</th>
                  <th>Variance</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {dayCloses.map((d) => (
                  <tr key={d.id}>
                    <td>{new Date(d.closed_at).toLocaleString()}</td>
                    <td>£{Number(d.expected_balance).toFixed(2)}</td>
                    <td>£{Number(d.counted_total).toFixed(2)}</td>
                    <td className={Math.abs(Number(d.variance)) > 0 ? "variance-flag" : ""}>
                      £{Number(d.variance).toFixed(2)}
                    </td>
                    <td>{d.note || "—"}</td>
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
