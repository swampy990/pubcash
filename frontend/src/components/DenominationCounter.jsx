const DENOMINATIONS = [
  { key: "50.00", label: "£50 note" },
  { key: "20.00", label: "£20 note" },
  { key: "10.00", label: "£10 note" },
  { key: "5.00", label: "£5 note" },
  { key: "2.00", label: "£2 coin" },
  { key: "1.00", label: "£1 coin" },
  { key: "0.50", label: "50p coin" },
  { key: "0.20", label: "20p coin" },
  { key: "0.10", label: "10p coin" },
  { key: "0.05", label: "5p coin" },
  { key: "0.02", label: "2p coin" },
  { key: "0.01", label: "1p coin" },
];

export function breakdownTotal(breakdown) {
  return DENOMINATIONS.reduce((sum, d) => {
    const count = Number(breakdown[d.key]) || 0;
    return sum + count * Number(d.key);
  }, 0);
}

export default function DenominationCounter({ value, onChange, disabled }) {
  const handleChange = (key, raw) => {
    const count = raw === "" ? 0 : Math.max(0, parseInt(raw, 10) || 0);
    onChange({ ...value, [key]: count });
  };

  return (
    <div className="denomination-counter">
      <table className="table">
        <thead>
          <tr>
            <th>Denomination</th>
            <th>Count</th>
            <th>Subtotal</th>
          </tr>
        </thead>
        <tbody>
          {DENOMINATIONS.map((d) => {
            const count = Number(value[d.key]) || 0;
            const subtotal = count * Number(d.key);
            return (
              <tr key={d.key}>
                <td>{d.label}</td>
                <td>
                  <input
                    type="number"
                    min="0"
                    inputMode="numeric"
                    value={value[d.key] ?? ""}
                    onChange={(e) => handleChange(d.key, e.target.value)}
                    disabled={disabled}
                  />
                </td>
                <td>£{subtotal.toFixed(2)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2}>
              <strong>Total</strong>
            </td>
            <td>
              <strong>£{breakdownTotal(value).toFixed(2)}</strong>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
