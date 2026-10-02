"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import type { AccountStatus, AccountType, Area } from "@/lib/types";

export default function NewAccountPage() {
  const router = useRouter();
  const { rep } = useAuth();
  const [type, setType] = useState<AccountType>("doctor");
  const [name, setName] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [parentId, setParentId] = useState("");
  const [areaId, setAreaId] = useState("");
  const [phone, setPhone] = useState("");
  const [areas, setAreas] = useState<Area[]>([]);
  const [hospitals, setHospitals] = useState<AccountStatus[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sb = supabase();
    sb.from("areas").select("id, name, emirate").order("name").then(({ data }) => setAreas((data ?? []) as Area[]));
    sb.from("account_status")
      .select("id, name")
      .eq("type", "hospital")
      .order("name")
      .then(({ data }) => setHospitals((data ?? []) as AccountStatus[]));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!rep) return;
    if (!areaId) {
      setError("Pick an area.");
      return;
    }
    setBusy(true);
    setError(null);
    const { data, error } = await supabase()
      .from("accounts")
      .insert({
        type,
        name: name.trim(),
        specialty: type === "doctor" && specialty.trim() ? specialty.trim() : null,
        parent_id: type === "doctor" && parentId ? Number(parentId) : null,
        area_id: Number(areaId),
        assigned_rep_id: rep.id,
        phone: phone.trim() || null,
      })
      .select("id")
      .single();
    if (error || !data) {
      setError(error?.message ?? "Could not save the account.");
      setBusy(false);
      return;
    }
    router.replace(`/accounts/${data.id}`);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex items-center gap-2">
        <button type="button" aria-label="Back" onClick={() => router.back()} className="flex h-11 w-11 items-center justify-center">
          <ArrowLeft size={22} />
        </button>
        <h1 className="text-2xl font-bold text-surface-900">Add account</h1>
      </div>

      <div className="flex gap-2">
        {(["doctor", "pharmacy", "hospital"] as AccountType[]).map((t) => (
          <button
            type="button"
            key={t}
            className={`chip flex-1 capitalize ${type === t ? "chip-on" : ""}`}
            onClick={() => setType(t)}
          >
            {t}
          </button>
        ))}
      </div>

      <input className="field" placeholder="Name" required value={name} onChange={(e) => setName(e.target.value)} />
      {type === "doctor" && (
        <>
          <input className="field" placeholder="Specialty" value={specialty} onChange={(e) => setSpecialty(e.target.value)} />
          <select className="field" value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">Hospital (optional)</option>
            {hospitals.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </>
      )}
      <select className="field" required value={areaId} onChange={(e) => setAreaId(e.target.value)}>
        <option value="">Area</option>
        {areas.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
            {a.emirate ? ` · ${a.emirate}` : ""}
          </option>
        ))}
      </select>
      <input className="field" type="tel" inputMode="tel" placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />

      {error && <p className="text-sm text-red-700">{error}</p>}
      <button className="btn-primary" disabled={busy || !name.trim()}>
        {busy ? "Saving…" : "Save account"}
      </button>
    </form>
  );
}
