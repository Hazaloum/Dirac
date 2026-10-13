"use client";

import { Fragment, useEffect, useState } from "react";
import { ExternalLink, Loader2, Mail, Phone, Search, Stethoscope, UserPlus } from "lucide-react";
import { api, type DoctorFacets, type DoctorProfile, type DoctorRow, type DoctorSearch, type FieldArea } from "@/lib/api";
import { ddmmyy } from "@/lib/dates";

const PAGE = 50;
const MAIN = ["Physician", "Dentist", "Allied Health", "Nurse and Midwife"];

function Profile({ row, areas, onAdded }: { row: DoctorRow; areas: FieldArea[]; onAdded: (id: number) => void }) {
  const [p, setP] = useState<DoctorProfile | null>(null);
  const [error, setError] = useState("");
  const [area, setArea] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState("");

  useEffect(() => {
    api.getDoctor(row.dha_id).then(setP).catch((e: Error) => setError(e.message));
  }, [row.dha_id]);

  const add = () => {
    setBusy(true); setError("");
    api.addDoctorToFieldForce(row.dha_id, area ? Number(area) : null)
      .then((r) => { setAdded(r.type === "pharmacy" ? "Their pharmacy is now a Field force client." : "Added as a Field force client."); onAdded(r.account_id); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  if (error && !p) return <p className="bg-surface-50 px-4 py-3 text-xs text-rose-700">{error}</p>;
  if (!p) return <p className="bg-surface-50 px-4 py-3 text-xs text-surface-500">Loading…</p>;
  const list = (title: string, items: string[]) => items.length > 0 && (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-surface-500">{title}</p>
      <ul className="text-sm text-surface-800">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
    </div>
  );
  return (
    <div className="grid gap-4 bg-surface-50 px-4 py-4 md:grid-cols-3">
      <div className="space-y-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-surface-500">Contact</p>
          {!p.emails.length && !p.phones.length && <p className="text-sm text-surface-500">None listed</p>}
          {p.emails.map((e) => <a key={e} href={`mailto:${e}`} className="flex items-center gap-1.5 text-sm text-pharma-900"><Mail className="h-3.5 w-3.5" />{e}</a>)}
          {p.phones.map((t) => <a key={t} href={`tel:${t}`} className="flex items-center gap-1.5 text-sm text-pharma-900"><Phone className="h-3.5 w-3.5" />{t}</a>)}
          {p.linkedin && <a href={p.linkedin} target="_blank" rel="noreferrer" className="block text-sm text-pharma-900">LinkedIn</a>}
        </div>
        {list("Languages", p.languages)}
        {p.nationality && <p className="text-sm text-surface-700">Nationality: {p.nationality}</p>}
        {p.profile_url && (
          <a href={p.profile_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-surface-500 hover:text-surface-800">
            DHA profile <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
      <div className="space-y-3">
        {list("Specialties", p.specialties)}
        {list("Licensed at", p.licensed_facilities)}
        {p.experience.length > 0 && (
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-surface-500">Experience</p>
            <ul className="text-sm text-surface-800">{p.experience.slice(0, 6).map(([role, place], i) => <li key={i}>{role}{place ? ` · ${place}` : ""}</li>)}</ul>
          </div>
        )}
      </div>
      <div className="space-y-3">
        {list("Qualifications", p.qualifications)}
        {list("Education", p.education.slice(0, 4))}
        <div className="rounded-lg border border-surface-200 bg-white p-3">
          {row.account_id || added ? (
            <p className="text-sm text-emerald-700">{added || "Already a Field force client."}</p>
          ) : (
            <>
              <p className="mb-2 text-xs text-surface-600">Make this a client in Curie, the reps&apos; app{(p.specialty ?? "").toLowerCase().startsWith("pharmacist") ? " (adds their pharmacy)" : ""}.</p>
              <div className="flex gap-2">
                <select value={area} onChange={(e) => setArea(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-surface-300 px-2 py-1.5 text-sm">
                  <option value="">No area yet</option>
                  {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <button onClick={add} disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-pharma-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />} Add to field force
                </button>
              </div>
            </>
          )}
          {error && <p className="mt-1 text-xs text-rose-700">{error}</p>}
        </div>
      </div>
    </div>
  );
}

export default function DoctorsPage() {
  const [facets, setFacets] = useState<DoctorFacets | null>(null);
  const [areas, setAreas] = useState<FieldArea[]>([]);
  const [profession, setProfession] = useState("Physician");
  const [specialty, setSpecialty] = useState("");
  const [grade, setGrade] = useState("");
  const [withContact, setWithContact] = useState(false);
  const [query, setQuery] = useState("");
  const [term, setTerm] = useState("");
  const [offset, setOffset] = useState(0);
  const [result, setResult] = useState<DoctorSearch | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    api.getDoctorFacets().then(setFacets).catch((e: Error) => setError(e.message));
    api.getFieldForceSetup().then((s) => setAreas(s.areas)).catch(() => setAreas([]));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { setTerm(query.trim()); setOffset(0); }, 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError("");
    api.searchDoctors({ q: term, profession: profession || undefined, specialty: specialty || undefined, grade: grade || undefined, withContact, offset })
      .then((r) => { if (!cancelled) setResult(r); })
      .catch((e: Error) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [term, profession, specialty, grade, withContact, offset]);

  const pick = (p: string) => { setProfession(p); setSpecialty(""); setGrade(""); setOffset(0); setOpen(null); };
  const specialties = (facets?.specialties ?? []).filter((s) => !profession || s.profession === profession);
  const grades = (facets?.grades ?? []).filter((g) => !profession || g.profession === profession);
  const professions = [...(facets?.professions ?? [])].sort((a, b) => {
    const ia = MAIN.indexOf(a.profession), ib = MAIN.indexOf(b.profession);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const total = result?.total ?? 0;
  const markAdded = (dhaId: string, accountId: number) =>
    setResult((r) => r && { ...r, rows: r.rows.map((x) => (x.dha_id === dhaId ? { ...x, account_id: accountId } : x)) });

  return (
    <main className="mx-auto max-w-6xl px-5 py-10">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <Stethoscope className="h-7 w-7 text-pharma-700" />
        <h1 className="text-3xl font-semibold text-surface-900">Doctors</h1>
      </div>
      <p className="mb-6 text-xs text-surface-500">
        Dubai Health Authority register of licensed professionals
        {facets && <> · {facets.total.toLocaleString()} people{facets.snapshot ? ` · as of ${ddmmyy(facets.snapshot)}` : ""}</>}.
        Dubai only (Abu Dhabi and the northern emirates license separately).
      </p>

      {error && <div role="alert" className="mb-5 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <div className="mb-4 flex flex-wrap gap-2">
        {professions.map((p) => (
          <button key={p.profession} onClick={() => pick(p.profession)}
            className={`rounded-xl border px-3 py-1.5 text-sm ${profession === p.profession ? "border-pharma-300 bg-pharma-50 font-medium text-pharma-900" : "border-surface-200 bg-white text-surface-700"}`}>
            {p.profession} <span className="text-xs text-surface-500">{p.n.toLocaleString()}</span>
          </button>
        ))}
        <button onClick={() => pick("")}
          className={`rounded-xl border px-3 py-1.5 text-sm ${!profession ? "border-pharma-300 bg-pharma-50 font-medium text-pharma-900" : "border-surface-200 bg-white text-surface-700"}`}>
          All
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-surface-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, facility, specialty or DHA ID"
            className="w-full rounded-xl border border-surface-300 bg-white py-2 pl-9 pr-3 text-sm focus:border-pharma-300 focus:outline-none" />
        </div>
        <select value={specialty} onChange={(e) => { setSpecialty(e.target.value); setOffset(0); }}
          className="max-w-[260px] rounded-xl border border-surface-300 bg-white px-3 py-2 text-sm">
          <option value="">All specialties</option>
          {specialties.map((s) => <option key={`${s.profession}-${s.specialty}`} value={s.specialty}>{s.specialty} ({s.n.toLocaleString()})</option>)}
        </select>
        <select value={grade} onChange={(e) => { setGrade(e.target.value); setOffset(0); }}
          className="rounded-xl border border-surface-300 bg-white px-3 py-2 text-sm">
          <option value="">All grades</option>
          {grades.map((g) => <option key={`${g.profession}-${g.grade}`} value={g.grade}>{g.grade} ({g.n.toLocaleString()})</option>)}
        </select>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-surface-700">
          <input type="checkbox" checked={withContact} onChange={(e) => { setWithContact(e.target.checked); setOffset(0); }} />
          With contact details only
        </label>
      </div>

      <div className="mb-2 flex items-center gap-2 text-xs text-surface-500">
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {result && <span>{total.toLocaleString()} found{total > PAGE ? ` · showing ${offset + 1}–${Math.min(offset + PAGE, total)}` : ""}</span>}
      </div>

      {result && result.rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-surface-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-surface-50 text-left text-xs text-surface-500">
              <tr>{["Name", "Specialty", "Facility", "Contact", ""].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-surface-100">
              {result.rows.map((r) => (
                <Fragment key={r.dha_id}>
                  <tr onClick={() => setOpen(open === r.dha_id ? null : r.dha_id)} className="cursor-pointer hover:bg-surface-50">
                    <td className="px-3 py-2 text-surface-900">{r.name}</td>
                    <td className="px-3 py-2 text-surface-700">
                      {r.specialty ?? r.profession ?? "—"}
                      {r.grade && r.grade !== r.specialty && <span className="text-xs text-surface-500"> · {r.grade}</span>}
                    </td>
                    <td className="px-3 py-2 text-surface-600">{r.facility ?? <span className="text-surface-400">Not linked to a facility</span>}</td>
                    <td className="px-3 py-2 text-surface-500">
                      <span className="inline-flex gap-1.5">
                        {r.has_email && <Mail className="h-4 w-4" aria-label="Email" />}
                        {r.has_mobile && <Phone className="h-4 w-4" aria-label="Phone" />}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {r.account_id && <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">Client</span>}
                    </td>
                  </tr>
                  {open === r.dha_id && (
                    <tr><td colSpan={5}><Profile row={r} areas={areas} onAdded={(id) => markAdded(r.dha_id, id)} /></td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {result && !result.rows.length && !loading && <p className="text-sm text-surface-500">Nobody matches.</p>}

      {total > PAGE && (
        <div className="mt-4 flex items-center gap-3">
          <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}
            className="rounded-lg border border-surface-300 bg-white px-3 py-1.5 text-sm disabled:opacity-40">Previous</button>
          <button disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}
            className="rounded-lg border border-surface-300 bg-white px-3 py-1.5 text-sm disabled:opacity-40">Next</button>
        </div>
      )}
    </main>
  );
}
