import { useEffect, useMemo, useState } from "react";
import { ensureSupabaseClient } from "../lib/auth";

type PhoneRow = {
  id: string;
  approved_phone: string;
  approved_name: string | null;
  max_per_tx: number | null;
  max_per_day: number | null;
  is_active: boolean;
  created_at: string;
};

export function normalizePhoneKE(input: string) {
  let p = (input || "").trim().replace(/\s+/g, "");
  if (p.startsWith("+")) p = p.slice(1);
  if (p.startsWith("07") && p.length === 10) return "254" + p.slice(1);
  if (p.startsWith("01") && p.length === 10) return "254" + p.slice(1);
  if (p.startsWith("254") && p.length >= 12) return p;
  return p;
}

export default function WithdrawalPhones({ matatuWalletId }: { matatuWalletId: string }) {
  const supabase = useMemo(() => ensureSupabaseClient(), []);
  const [rows, setRows] = useState<PhoneRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [phone, setPhone] = useState("");
  const [label, setLabel] = useState("");
  const [maxTx, setMaxTx] = useState<string>("");
  const [maxDay, setMaxDay] = useState<string>("");

  const activeCount = useMemo(() => rows.filter((r) => r.is_active).length, [rows]);

  async function load() {
    if (!supabase) {
      setErr("Supabase not configured");
      return;
    }
    if (!matatuWalletId) return;
    setLoading(true);
    setErr(null);
    try {
      const { data, error } = await supabase
        .from("withdrawal_authorizations")
        .select("id, approved_phone, approved_name, max_per_tx, max_per_day, is_active, created_at")
        .eq("domain", "teketeke")
        .eq("matatu_wallet_id", matatuWalletId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setRows((data || []) as any);
    } catch (e: any) {
      setErr(e?.message || "Failed to load withdrawal phones");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matatuWalletId, supabase]);

  async function addPhone() {
    if (!supabase) {
      setErr("Supabase not configured");
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const { data: sessionData, error: sErr } = await supabase.auth.getSession();
      if (sErr) throw sErr;
      const uid = sessionData.session?.user?.id;
      if (!uid) throw new Error("Not authenticated");

      const approved_phone = normalizePhoneKE(phone);
      const max_per_tx = maxTx.trim() ? Number(maxTx) : null;
      const max_per_day = maxDay.trim() ? Number(maxDay) : null;

      if (approved_phone.length < 12) throw new Error("Phone looks invalid. Use 07... or 2547... format.");
      if (max_per_tx !== null && (!Number.isFinite(max_per_tx) || max_per_tx <= 0))
        throw new Error("max_per_tx must be a number > 0");
      if (max_per_day !== null && (!Number.isFinite(max_per_day) || max_per_day <= 0))
        throw new Error("max_per_day must be a number > 0");

      const { error } = await supabase.from("withdrawal_authorizations").insert({
        domain: "teketeke",
        matatu_wallet_id: matatuWalletId,
        approved_phone,
        approved_name: label.trim() || null,
        max_per_tx,
        max_per_day,
        is_active: true,
        approved_by_user_id: uid,
      });

      if (error) throw error;

      setPhone("");
      setLabel("");
      setMaxTx("");
      setMaxDay("");
      await load();
    } catch (e: any) {
      setErr(e?.message || "Failed to add phone");
    } finally {
      setLoading(false);
    }
  }

  async function toggleActive(row: PhoneRow) {
    if (!supabase) {
      setErr("Supabase not configured");
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const { error } = await supabase
        .from("withdrawal_authorizations")
        .update({ is_active: !row.is_active })
        .eq("id", row.id);

      if (error) throw error;
      await load();
    } catch (e: any) {
      setErr(e?.message || "Failed to update status");
    } finally {
      setLoading(false);
    }
  }

  async function updateLimits(
    row: PhoneRow,
    max_per_tx: number | null,
    max_per_day: number | null,
    approved_name: string | null
  ) {
    if (!supabase) {
      setErr("Supabase not configured");
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const { error } = await supabase
        .from("withdrawal_authorizations")
        .update({ max_per_tx, max_per_day, approved_name })
        .eq("id", row.id);

      if (error) throw error;
      await load();
    } catch (e: any) {
      setErr(e?.message || "Failed to update limits");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Withdrawal Phones</h1>
          <p className="text-sm text-gray-600">Only these phone numbers can receive withdrawals (strict mode).</p>
        </div>
        <div className="text-sm">
          <div className="text-gray-600">Active phones</div>
          <div className="font-semibold">{activeCount}</div>
        </div>
      </div>

      {err && (
        <div className="p-3 rounded border border-red-200 bg-red-50 text-red-800 text-sm">
          {err}
        </div>
      )}

      <div className="rounded border bg-white p-4 space-y-3">
        <div className="font-semibold">Add approved phone</div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="md:col-span-1">
            <label className="text-xs text-gray-600">Phone</label>
            <input
              className="w-full border rounded p-2 text-sm"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="07XXXXXXXX or 2547XXXXXXXX"
            />
          </div>

          <div className="md:col-span-1">
            <label className="text-xs text-gray-600">Label (optional)</label>
            <input
              className="w-full border rounded p-2 text-sm"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Owner main / Proxy"
            />
          </div>

          <div className="md:col-span-1">
            <label className="text-xs text-gray-600">Max per Tx (optional)</label>
            <input
              className="w-full border rounded p-2 text-sm"
              value={maxTx}
              onChange={(e) => setMaxTx(e.target.value)}
              placeholder="e.g. 50000"
              inputMode="numeric"
            />
          </div>

          <div className="md:col-span-1">
            <label className="text-xs text-gray-600">Max per Day (optional)</label>
            <input
              className="w-full border rounded p-2 text-sm"
              value={maxDay}
              onChange={(e) => setMaxDay(e.target.value)}
              placeholder="e.g. 200000"
              inputMode="numeric"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <button className="px-3 py-2 rounded bg-black text-white text-sm" onClick={addPhone} disabled={loading}>
            {loading ? "Saving..." : "Add Phone"}
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded border bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-gray-700">
            <tr>
              <th className="text-left p-3">Phone</th>
              <th className="text-left p-3">Label</th>
              <th className="text-left p-3">Max/Tx</th>
              <th className="text-left p-3">Max/Day</th>
              <th className="text-left p-3">Status</th>
              <th className="text-left p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <tr>
                <td className="p-4 text-gray-500" colSpan={6}>
                  Loading...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td className="p-4 text-gray-500" colSpan={6}>
                  No phones yet. Add at least one to allow withdrawals.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <PhoneRowView
                  key={r.id}
                  row={r}
                  onToggle={() => toggleActive(r)}
                  onUpdate={updateLimits}
                  disabled={loading}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PhoneRowView({
  row,
  onToggle,
  onUpdate,
  disabled,
}: {
  row: PhoneRow;
  onToggle: () => void;
  onUpdate: (
    row: PhoneRow,
    max_per_tx: number | null,
    max_per_day: number | null,
    approved_name: string | null
  ) => Promise<void>;
  disabled: boolean;
}) {
  const [edit, setEdit] = useState(false);
  const [name, setName] = useState(row.approved_name || "");
  const [tx, setTx] = useState(row.max_per_tx?.toString() || "");
  const [day, setDay] = useState(row.max_per_day?.toString() || "");

  function parseNum(s: string) {
    const v = s.trim();
    if (!v) return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n;
  }

  async function save() {
    await onUpdate(row, parseNum(tx), parseNum(day), name.trim() || null);
    setEdit(false);
  }

  return (
    <tr className="border-t">
      <td className="p-3 font-semibold">{row.approved_phone}</td>
      <td className="p-3">
        {edit ? (
          <input className="border rounded p-1.5 text-sm w-full" value={name} onChange={(e) => setName(e.target.value)} />
        ) : (
          row.approved_name || "N/A"
        )}
      </td>
      <td className="p-3">
        {edit ? (
          <input className="border rounded p-1.5 text-sm w-full" value={tx} onChange={(e) => setTx(e.target.value)} inputMode="numeric" />
        ) : (
          row.max_per_tx ?? "N/A"
        )}
      </td>
      <td className="p-3">
        {edit ? (
          <input className="border rounded p-1.5 text-sm w-full" value={day} onChange={(e) => setDay(e.target.value)} inputMode="numeric" />
        ) : (
          row.max_per_day ?? "N/A"
        )}
      </td>
      <td className="p-3">
        <span className={`px-2 py-1 rounded text-xs ${row.is_active ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-700"}`}>
          {row.is_active ? "Active" : "Disabled"}
        </span>
      </td>
      <td className="p-3">
        <div className="flex gap-2">
          <button className="px-3 py-1.5 rounded border text-sm" onClick={() => setEdit((v) => !v)} disabled={disabled}>
            {edit ? "Cancel" : "Edit"}
          </button>

          {edit ? (
            <button className="px-3 py-1.5 rounded bg-black text-white text-sm" onClick={save} disabled={disabled}>
              Save
            </button>
          ) : (
            <button
              className={`px-3 py-1.5 rounded text-white text-sm ${row.is_active ? "bg-red-600" : "bg-green-600"}`}
              onClick={onToggle}
              disabled={disabled}
            >
              {row.is_active ? "Disable" : "Enable"}
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}
