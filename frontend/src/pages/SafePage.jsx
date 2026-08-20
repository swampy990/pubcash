import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import { useAuth } from "../context/AuthContext";
import DenominationCounter, { breakdownTotal } from "../components/DenominationCounter";

const EMPTY_BREAKDOWN = {};

export default function SafePage() {
  const { user } = useAuth();
  const [balance, setBalance] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [openSessions, setOpenSessions] = useState([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(true);

  const [type, setType] = useState("drop");
  const [breakdown, setBreakdown] = useState(EMPTY_BREAKDOWN);
  const [amount, setAmount] = useState("");
  const [tillSessionId, setTillSessionId] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [balanceRes, txRes, sessionsRes] = await Promise.all([
        api.getSafeBalance(),
        api.listSafeTransactions(),
        api.listTillSessions({ status_filter: "open" }),
      ]);
      setBalance(balanceRes.balance);
      setTransactions(txRes);
      setOpenSessions(sessionsRes);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load safe data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

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
                <td>{t.type}</td>
                <td className={Number(t.amount) < 0 ? "variance-flag" : ""}>£{Number(t.amount).toFixed(2)}</td>
                <td>{t.note || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
