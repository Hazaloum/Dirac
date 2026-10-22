const API = process.env.NEXT_PUBLIC_API_URL || "";

async function req<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    credentials: "include",
    ...options,
  });
  if (res.status === 401) {
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Request failed");
  }
  return res.json();
}

export const api = {
  // Auth
  login: (password: string) =>
    req("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    }),

  logout: () => req("/api/auth/logout", { method: "POST" }),

  me: () => req<{ authenticated: boolean }>("/api/auth/me"),

  // Molecules
  getMolecules: () => req<{ molecules: string[] }>("/api/molecules"),

  // Market discovery hierarchy. ATC1 has no parent; deeper levels do.
  getMarketDiscovery: (level = "ATC1", parentCode?: string, source = "IQVIA") => {
    const query = new URLSearchParams({ level });
    if (parentCode) query.set("parent", parentCode);
    query.set("source", source);
    return req<MarketDiscoveryResponse>(`/api/market-discovery?${query.toString()}`);
  },

  getMarketDiscoveryMolecules: (atc4: string, source = "IQVIA") =>
    req<MarketDiscoveryResponse>(`/api/market-discovery/molecules?atc4=${encodeURIComponent(atc4)}&source=${encodeURIComponent(source)}`),

  getMarketDiscoveryCompetitors: (atc4: string, molecule: string) =>
    req<MarketDiscoveryResponse>(`/api/market-discovery/competitors?atc4=${encodeURIComponent(atc4)}&molecule=${encodeURIComponent(molecule)}`),

  // Analysis
  uploadCatalogue: (files: File | File[], company: string, pick?: CompanyPick | null) => {
    const form = new FormData();
    appendFiles(form, files);
    form.append("company", company);
    if (pick) {
      form.append("company_id", String(pick.company_id));
      form.append("whole_group", String(pick.whole_group));
    }
    return req<AnalysisResult>("/api/analysis/upload", { method: "POST", body: form });
  },

  refreshCatalogue: (items: { molecule: string; catalogue: CatalogueInfo }[]) =>
    req<{ molecule: string; catalogue: CatalogueInfo }[]>("/api/analysis/refresh-catalogue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    }),

  enrichMolecules: (molecules: string[], company?: string) =>
    req<AnalysisResult>("/api/analysis/enrich", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ molecules, company }),
    }),

  getManufacturers: (molecule: string) =>
    req<ManufacturerBreakdown>(`/api/analysis/manufacturers/${encodeURIComponent(molecule)}`),

  getMoleculeTrend: (molecule: string, filters: { nfc3?: string | null; strength?: string | null } = {}) => {
    const qs = new URLSearchParams();
    if (filters.nfc3) qs.set("nfc3", filters.nfc3);
    if (filters.strength) qs.set("strength", filters.strength);
    const q = qs.toString();
    return req<MoleculeSlices>(`/api/analysis/trend/${encodeURIComponent(molecule)}${q ? `?${q}` : ""}`);
  },

  getMoleculeLineage: (molecule: string) =>
    req<MoleculeLineage>(`/api/analysis/lineage/${encodeURIComponent(molecule)}`),

  getCompanyProducts: (mohapName: string) =>
    req<{ molecules: MoleculeCard[]; total: number }>(
      `/api/outreach/company-products?mohap_name=${encodeURIComponent(mohapName)}`
    ),

  draftLinkedInMessage: (payload: {
    contact_name: string;
    contact_title: string;
    company_name: string;
    company_overview: string;
    model?: string;
  }) =>
    req<{ message: string }>("/api/outreach/draft-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),

  // Analysis history
  saveAnalysis: (payload: {
    source_name: string;
    source_type: string;
    model: string;
    result: AnalysisResult;
    report: string;
    run_id?: string | null;   // update this run instead of adding one
  }) => req<{ run_id: string }>("/api/analysis/history", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }),

  listHistory: () => req<{ runs: AnalysisRun[] }>("/api/analysis/history"),

  getHistoryRun: (runId: string) =>
    req<AnalysisRun & { result: AnalysisResult; report: string }>(`/api/analysis/history/${runId}`),

  deleteHistoryRun: (runId: string) =>
    req(`/api/analysis/history/${runId}`, { method: "DELETE" }),

  // Forecast
  getForecast: (molecules: string[], growthRate: number) =>
    req<ForecastResult>("/api/analysis/forecast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ molecules, growth_rate: growthRate }),
    }),

  // Outreach
  getOutreachRuns: () => req<{ runs: OutreachRun[] }>("/api/outreach/runs"),

  getOutreachRun: (runId: string) =>
    req<OutreachRunDetail>(`/api/outreach/runs/${runId}`),

  deleteOutreachRun: (runId: string) =>
    req(`/api/outreach/runs/${runId}`, { method: "DELETE" }),

  // My Portfolio
  getMyPortfolio: () => req<{ portfolio: MyPortfolio | null }>("/api/portfolio"),

  getPortfolioHierarchy: () => req<PortfolioHierarchy>("/api/portfolio/hierarchy"),

  savePortfolioUpload: (files: File | File[], company: string) => {
    const form = new FormData();
    appendFiles(form, files);
    form.append("company", company);
    return req<AnalysisResult>("/api/portfolio/upload", { method: "POST", body: form });
  },

  savePortfolioEnrich: (molecules: string[], company: string) =>
    req<AnalysisResult>("/api/portfolio/enrich", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ molecules, company }),
    }),

  savePortfolioReport: (report: string) =>
    req("/api/portfolio/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ report }),
    }),

  clearMyPortfolio: () => req("/api/portfolio", { method: "DELETE" }),

  // Inventory — carried SKUs per My Portfolio molecule
  getInventory: () => req<InventoryResponse>("/api/inventory"),
  getInventoryOptions: (molecule: string) =>
    req<SkuOptions>(`/api/inventory/options/${encodeURIComponent(molecule)}`),
  setInventorySkus: (molecule: string, packKeys: string[]) =>
    req<SkuOptions>(`/api/inventory/skus/${encodeURIComponent(molecule)}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pack_keys: packKeys }),
    }),
  setInventoryStock: (packKey: string, stockQuantity: number) => req<InventorySku>(`/api/inventory/${packKey}`, {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stock_quantity: stockQuantity }),
  }),

  // Events (CPHI exhibitor lists)
  getEvents: () => req<{ events: EventSummary[] }>("/api/events"),
  getEvent: (key: string) => req<EventDetail>(`/api/events/${encodeURIComponent(key)}`),
  getExhibitorPortfolio: (id: number) => req<ExhibitorPortfolio>(`/api/events/exhibitors/${id}/portfolio`),

  // Master registry
  getRegistryReview: () => req<RegistryReview>("/api/registry/review"),
  runRegistryReview: () => req<{ started: boolean }>("/api/registry/review/run", { method: "POST" }),
  decideCompanyPair: (a: number, b: number, verdict: "same" | "different") =>
    req<unknown>("/api/registry/review/company", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ a, b, verdict }) }),
  decideGroup: (clusterId: number, groups: { name: string; member_ids: number[] }[]) =>
    req<unknown>("/api/registry/review/group", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cluster_id: clusterId, groups }) }),
  decideMolecule: (alias: string, inn: string | null) =>
    req<unknown>("/api/registry/review/molecule", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ alias, inn }) }),
  getRunChanges: (runId: number, kind?: string) =>
    req<RegistryChange[]>(`/api/registry/runs/${runId}/changes${kind ? `?kind=${kind}` : ""}`),
  getRegistries: () => req<RegistrySource[]>("/api/registry/registries"),
  searchRegistry: (registry: string, q: string, status: string, offset: number, limit = 50) =>
    req<RegistrySearch>(`/api/registry/search?registry=${encodeURIComponent(registry)}&q=${encodeURIComponent(q)}&status=${status}&offset=${offset}&limit=${limit}`),
  searchRegistryMolecules: (q: string) => req<RegistryMolecule[]>(`/api/registry/molecules?q=${encodeURIComponent(q)}`),
  getCompanyPortfolio: (companyId: number, wholeGroup = true) =>
    req<ExhibitorPortfolio>(`/api/registry/company-portfolio/${companyId}?whole_group=${wholeGroup}`),
  addToRegistry: (body: { company_id: number; source: string;
                          items: { name: string; form?: string; strengths?: string; catalogue_status?: string }[] }) =>
    req<{ added: number; updated: number }>("/api/registry/uploaded", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  searchRegistryCompanies: (q: string) => req<RegistryCompany[]>(`/api/registry/companies?q=${encodeURIComponent(q)}`),
  getMoleculeHolders: (molecule: string) =>
    req<MoleculeHolders>(`/api/registry/molecule-companies?molecule=${encodeURIComponent(molecule)}`),

  // Deal Tracker
  getDeals: () => req<DealBoard>("/api/deals"),
  getDeal: (id: number) => req<DealDetail>(`/api/deals/${id}`),
  getDealForMolecule: (molecule: string) =>
    req<{ deal: DealRef | null }>(`/api/deals/by-molecule/${encodeURIComponent(molecule)}`),
  createDeal: (body: { molecule: string; partner?: string; stage?: string }) =>
    req<DealDetail>("/api/deals", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }),
  updateDeal: (id: number, body: DealUpdate) =>
    req<DealDetail>(`/api/deals/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }),
  moveDeal: (id: number, stage: string) =>
    req<DealDetail & { portfolio: DealPortfolioResult }>(`/api/deals/${id}/move`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage }),
    }),
  deleteDeal: (id: number) => req<{ ok: boolean }>(`/api/deals/${id}`, { method: "DELETE" }),
  uploadDealDocument: (id: number, stage: string, file: File) => {
    const form = new FormData();
    form.append("stage", stage);
    form.append("file", file);
    return req<DealDetail>(`/api/deals/${id}/documents`, { method: "POST", body: form });
  },
  dealDocumentUrl: (docId: number) => `${API}/api/deals/documents/${docId}`,
  deleteDealDocument: (docId: number) => req<{ ok: boolean }>(`/api/deals/documents/${docId}`, { method: "DELETE" }),

  // Purchase orders (stock in when received) and sales orders (stock out when delivered)
  getPoTracker: () => req<PoTracker>("/api/po-tracker"),
  setPoMolecule: (ref: string, molecule: string | null) =>
    req<{ ref: string; molecule: string | null }>("/api/po-tracker/molecule", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ref, molecule }),
    }),
  syncPoTracker: () => req<{ lines: number; open: number; closed: number }>("/api/po-tracker/sync", { method: "POST" }),
  getOrders: () => req<{ purchase: StockOrder[]; sales: StockOrder[] }>("/api/inventory/orders"),
  createOrder: (kind: OrderKind, body: { party: string; order_date?: string; note?: string; lines: { pack_key: string; quantity: number }[] }) =>
    req(`/api/inventory/orders/${kind}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }),
  closeOrder: (kind: OrderKind, id: number) => req(`/api/inventory/orders/${kind}/${id}/close`, { method: "POST" }),
  cancelOrder: (kind: OrderKind, id: number) => req(`/api/inventory/orders/${kind}/${id}/cancel`, { method: "POST" }),

  // Field force (medical rep CRM) — setup + dashboard
  getDoctorFacets: () => req<DoctorFacets>("/api/doctors/facets"),
  searchDoctors: (p: { q: string; profession?: string; specialty?: string; grade?: string; withContact?: boolean; offset: number }) => {
    const qs = new URLSearchParams({ q: p.q, offset: String(p.offset), limit: "50", with_contact: String(!!p.withContact) });
    if (p.profession) qs.set("profession", p.profession);
    if (p.specialty) qs.set("specialty", p.specialty);
    if (p.grade) qs.set("grade", p.grade);
    return req<DoctorSearch>(`/api/doctors?${qs}`);
  },
  getDoctor: (dhaId: string) => req<DoctorProfile>(`/api/doctors/${encodeURIComponent(dhaId)}`),
  addDoctorToFieldForce: (dhaId: string, areaId: number | null) =>
    req<{ account_id: number; created: boolean; type: "doctor" | "pharmacy" }>(`/api/doctors/${encodeURIComponent(dhaId)}/field-force`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ area_id: areaId }) }),
  getFieldForceSetup: () => req<FieldForceSetup>("/api/field-force/setup"),
  createRep: (payload: { name: string; email: string; password: string; role: RepRole; area_ids: number[] }) =>
    req<FieldRep>("/api/field-force/reps", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    }),
  updateRep: (repId: string, payload: Partial<{ name: string; role: RepRole; active: boolean; area_ids: number[]; password: string }>) =>
    req(`/api/field-force/reps/${repId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    }),
  createArea: (name: string, emirate?: string) =>
    req<FieldArea>("/api/field-force/areas", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, emirate }),
    }),
  deleteArea: (areaId: number) => req(`/api/field-force/areas/${areaId}`, { method: "DELETE" }),
  getFieldAccounts: () => req<{ accounts: FieldAccount[] }>("/api/field-force/accounts"),
  updateFieldAccount: (accountId: number, changes: Partial<FieldAccount>) =>
    req(`/api/field-force/accounts/${accountId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(changes),
    }),
  importFieldAccounts: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return req<{ created: number; skipped: number; errors: string[] }>("/api/field-force/accounts/import", { method: "POST", body: form });
  },
  getFieldDashboard: (days = 30) => req<FieldDashboard>(`/api/field-force/dashboard?days=${days}`),

  // Cross-catalogue evaluation pipeline
  getPipeline: () => req<{ decisions: PipelineDecision[] }>("/api/pipeline"),

  setPipelineDecision: (payload: {
    molecule: string;
    decision: PipelineDecisionValue;
    source_type?: string;   // Analysis mode; "upload" = ticked in a supplier's catalogue
    source_name: string;
    snapshot: MoleculeCard;
  }) => req<PipelineDecision>("/api/pipeline", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }),

  clearPipelineDecision: (molecule: string) =>
    req(`/api/pipeline/${encodeURIComponent(molecule)}`, { method: "DELETE" }),
};

// ─── SSE helpers ─────────────────────────────────────────────────────────────

export type UploadProgress =
  | { molecule: string; count: number }
  | { stage: "reading"; pages: number; image_pages: number }
  | { stage: "fallback"; reason: string }
  | { stage: "registry" };

/** Catalogue files: the first as `file`, any others as `files` (the backend reads them all as one catalogue). */
function appendFiles(form: FormData, files: File | File[]) {
  (Array.isArray(files) ? files : [files]).forEach((f, i) => form.append(i ? "files" : "file", f));
}

/** Upload catalogue with progress: onProgress per molecule found (running count), then the registry check. */
export async function uploadCatalogueStream(
  files: File | File[],
  company: string,
  pick: CompanyPick | null,
  onProgress: (p: UploadProgress) => void,
): Promise<AnalysisResult> {
  const form = new FormData();
  appendFiles(form, files);
  form.append("company", company);
  if (pick) {
    form.append("company_id", String(pick.company_id));
    form.append("whole_group", String(pick.whole_group));
  }
  const dropped = "The connection to the server dropped (it may be restarting). Upload the file again in a minute: " +
    "pages already read are reused, so they aren't paid for twice.";
  let res: Response;
  try {
    res = await fetch(`${API}/api/analysis/upload-stream`, { method: "POST", credentials: "include", body: form });
  } catch {
    throw new Error(dropped);
  }
  if (res.status === 502 || res.status === 503 || res.status === 504) throw new Error(dropped);
  if (!res.ok || !res.body) throw new Error(`Upload failed (${res.status})`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch {
      throw new Error(dropped);
    }
    const { done, value } = chunk;
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const raw = line.slice(6).trim();
      if (raw === "[DONE]") continue;
      const msg = JSON.parse(raw);
      if (msg.error) throw new Error(msg.error);
      if (msg.result) return msg.result as AnalysisResult;
      onProgress(msg);
    }
  }
  throw new Error(dropped);
}

export function streamScore(
  payload: ScorePayload,
  onChunk: (text: string) => void,
  onDone: () => void,
  onError: (e: string) => void,
): AbortController {
  const controller = new AbortController();

  fetch(`${API}/api/analysis/score`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: controller.signal,
  }).then(async (res) => {
    if (!res.ok || !res.body) {
      onError("Failed to start scoring");
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (raw === "[DONE]") { onDone(); return; }
        try {
          const msg = JSON.parse(raw);
          if (msg.text) onChunk(msg.text);
          if (msg.error) onError(msg.error);
        } catch { /* ignore parse errors */ }
      }
    }
    onDone();
  }).catch((e) => {
    if (e.name !== "AbortError") onError(e.message);
  });

  return controller;
}

export function streamOutreach(
  country: string,
  model: string,
  onEvent: (event: OutreachEvent) => void,
  onDone: () => void,
  onError: (e: string) => void,
): AbortController {
  const controller = new AbortController();

  fetch(`${API}/api/outreach/run`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ country, model }),
    signal: controller.signal,
  }).then(async (res) => {
    if (!res.ok || !res.body) {
      onError("Failed to start outreach run");
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (raw === "[DONE]") { onDone(); return; }
        try {
          const event = JSON.parse(raw);
          onEvent(event);
        } catch { /* ignore */ }
      }
    }
    onDone();
  }).catch((e) => {
    if (e.name !== "AbortError") onError(e.message);
  });

  return controller;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MoleculeCard {
  molecule: string;
  in_iqvia: boolean;
  context?: string;
  market_value_aed?: number;
  value_cagr_pct?: number;
  unit_cagr_pct?: number;
  num_competitors?: number;
  market_leader?: string;
  leader_share_pct?: number;
  leader_share_change?: number;
  second_player?: string;
  private_pct?: number;
  lpo_pct?: number;
  launch_year?: number;
  atc1_class?: string;
  atc3_class?: string;
  atc4_class?: string;
  cagr_delta?: number;
  top3_company_share?: number;
  upp_manufacturers?: number;
  mohap_manufacturers?: number;
  atc4_class_value_aed?: number;
  atc4_class_cagr?: number;
  atc4_molecule_count?: number;
  atc4_value_rank?: string;
  atc4_value_pct?: number;
  atc3_class_value_aed?: number;
  atc3_class_cagr?: number;
  atc3_molecule_count?: number;
  atc3_value_rank?: string;
  atc3_value_pct?: number;
  /** Upload catalogue only: vs the picked company's registry portfolio. in_registry = it already holds it;
   *  already_uploaded = added from an earlier catalogue; new = not in its registries; unmatched = no registry
   *  molecule found for the name. Nothing is written until the review screen's "Add to registries". */
  registry_status?: "in_registry" | "already_uploaded" | "new" | "unmatched" | null;
  /** Upload catalogue: the ingredients as the catalogue wrote them (the registry check's name). */
  registry_name?: string;
  /** Upload catalogue read by AI: the catalogue's products for this molecule. */
  catalogue?: CatalogueInfo;
  // Added by frontend after scoring
  ai_score?: number;
  ai_reasoning?: string;
}

export interface CatalogueProduct {
  brand: string;
  dosage_form: string;
  /** Every UAE strength of this form plus the catalogue's. offered: the catalogue has it (missing on runs saved
   *  before 22/10/26, where every strength is the catalogue's); in_uae: the UAE market (IQVIA) sells it, null when
   *  the molecule isn't in IQVIA. */
  strengths: { label: string; in_uae: boolean | null; offered?: boolean }[];
  /** The UAE form group the strengths were compared within, e.g. "Skin (gel, cream, spray)"; "" = all forms. */
  uae_form?: string;
  countries: string[];
  status: "approved" | "submitted" | "unknown";
  expected_date: string;
  pages: number[];
  from_image: boolean;
}

export interface CatalogueInfo {
  status: "approved" | "submitted" | "unknown";
  products: CatalogueProduct[];
  /** UAE forms the catalogue doesn't offer, with their strengths. */
  other_forms?: { form: string; strengths: string[] }[];
  /** Runs saved before 22/10/26: UAE strengths the catalogue doesn't offer, all forms together. */
  uae_only?: string[];
}

export interface MarketDiscoveryNode {
  code: string;
  name: string;
  level: "ATC1" | "ATC2" | "ATC3" | "ATC4" | string;
  value: number;
  units: number;
  cagr: number | null;
  top_company: string | null;
  top_company_share: number | null;
  molecule_count?: number;
  has_children?: boolean;
  source?: "IQVIA" | "WHO";
  source_status?: "iqvia_with_who" | "iqvia_only" | "who_only";
  market_data_available?: boolean;
  atc5_code?: string;
  who_codes?: string[];
  who_classes?: Array<{ code: string; name: string; status: string; confidence?: string | null }>;
}

export interface MarketDiscoveryResponse {
  level: string;
  parent_code?: string | null;
  parent_name?: string | null;
  year?: number;
  analysis_year?: number;
  cagr_period?: string;
  source_label?: string;
  total_value?: number;
  total_units?: number;
  cagr?: number | null;
  who_only_count?: number;
  who_classes?: Array<{ code: string; name: string; status: string; confidence?: string | null }>;
  nodes: MarketDiscoveryNode[];
}

export type PipelineDecisionValue = "yes" | "maybe" | "no";

export interface PipelineDecision {
  molecule: string;
  decision: PipelineDecisionValue;
  source_name: string;
  snapshot: MoleculeCard;
  updated_at: string;
}

export interface MoleculeMetrics {
  value: number;
  cagr: number | null;
  num_manufacturers?: number;
  upp_manufacturers?: number;
  mohap_manufacturers?: number;
  private_pct?: number;
  lpo_pct?: number;
}

export interface HierarchyMolecule {
  name: string;
  value: number;
}

export interface HierarchyClass {
  code: string;
  name: string;
  value: number;
  children?: HierarchyClass[];
  molecules?: HierarchyMolecule[];
}

export interface PortfolioHierarchy {
  year: number;
  classes: HierarchyClass[];
}

export interface AnalysisResult {
  companies: { name: string; molecules: string[] }[];
  molecules: MoleculeCard[];
  molecules_by_atc1: Record<string, string[]>;
  molecule_metrics: Record<string, MoleculeMetrics>;
  enriched_data: string;
  atc4_context: string;
  stats: { total: number; matched_iqvia: number };
  /** Upload catalogue with a registry company: the check against its registry portfolio. */
  registry_check?: { company_id?: number; whole_group?: boolean; in_registry?: number; already_uploaded?: number;
                     new?: number; unmatched?: number; error?: string };
  /** Upload catalogue: how the products were read. keyword = the AI failed (reason) and keyword matching ran. */
  extraction?: { method: "ai" | "keyword"; model?: string; pages?: number; image_pages?: number;
                 products?: number; dropped?: number; reason?: string };
}

export interface ManufacturerBreakdown {
  manufacturers: { name: string; value: number; share_pct: number }[];
  total: number;
  year: string;
}

export interface SliceSeries {
  name: string;
  values: number[];   // full years, aligned with MoleculeSlices.years
  partial: number;    // trailing partial year (years[-2] rule)
}

export type SliceMetrics = Record<"value" | "units", SliceSeries[]>;

export interface MoleculeSlices {
  found: boolean;
  molecule: string;
  years: number[];
  partial_year: number;
  competitor: Record<"total" | "private" | "lpo", SliceMetrics>;
  dims: Partial<Record<"channel" | "product" | "strength" | "nfc3", SliceMetrics>>;
  filters: { nfc3: string | null; strength: string | null };
  options: { nfc3: string[]; strength: string[] };   // strengths narrowed to the chosen NFC3
  profile: MoleculeProfile;                           // always the whole molecule, unfiltered
}

export interface ProfileCompany {
  product: string;
  manufacturer: string | null;
  corporation: string | null;   // IQVIA MIDAS Corporation (parent)
}

export interface CompetitorRow {
  manufacturer: string;
  product: string;           // its biggest product
  originator: boolean;       // same corporation as the first launch
  launch: string | null;     // MM/YYYY
  new: boolean;              // launched in the last two years
  value: number;             // end year
  start_value: number;       // first year
  units: number;
  cagr: number | null;       // over the full window only
  private_pct: number | null;
  share_pct: number;
}

export interface Competition {
  end_year: number;
  start_year: number;
  manufacturers: CompetitorRow[];   // selling in the end year, biggest first
  hhi: number | null;
  top3_pct: number | null;
  generic_pct: number | null;
  generics_selling: number;
  generics_ever: number;
  to_80_pct: number | null;          // manufacturers needed to reach 80% of value
  exits: { manufacturer: string; product: string; last_value: number }[];
}

export interface MoleculeProfile {
  competition?: Competition;
  leading_brand: (ProfileCompany & { share_pct: number | null }) | null;  // highest end-year value; share of the molecule's value
  first_launch: (ProfileCompany & { date: string }) | null;   // date MM/YYYY
  first_generic: (ProfileCompany & { date: string }) | null;  // earliest launch by another corporation
  market: {
    end_year: number;
    competitors?: number;          // IQVIA manufacturers (same as num_competitors)
    competitors_selling?: number;  // … with end-year sales
    value: number;
    value_cagr: number | null;
    value_cagr_since: number | null;
    units: number;
    units_cagr: number | null;
    units_cagr_since: number | null;
    private_value_pct: number | null;
    private_units_pct: number | null;
  };
}

export interface LineageLevel {
  level: string;             // "ATC1" … "ATC4"
  code: string;              // e.g. "N06A4"
  name: string;              // e.g. "SSRI ANTIDEPRESSANTS"
  value: number;
  cagr_pct: number | null;
  molecule_count: number;
  rank: number | null;
  share_pct: number | null;        // this molecule's share of the level
  child_share_pct: number | null;  // next level's share of this level
}

export interface MoleculeLineage {
  found: boolean;
  molecule: string;
  year: number;
  levels: LineageLevel[];
  molecule_value: number;
  molecule_cagr_pct: number | null;
}

export interface ScorePayload {
  companies: { name: string; molecules: string[] }[];
  enriched_data: string;
  source_name: string;
  model: string;
  market_context?: string;
  atc4_context?: string;
}

export interface AnalysisRun {
  run_id:      string;
  source_name: string;
  source_type: string;
  model:       string;
  saved_at:    string;
  has_report:  boolean;
  stats:       { total: number; matched_iqvia: number };
}

export interface OutreachRun {
  run_id:          string;
  country:         string;
  model:           string;
  run_date:        string;
  companies_found: number;
  contacts_found:  number;
}

export interface OutreachRunDetail extends OutreachRun {
  companies: {
    company:  string;
    website:  string;
    overview: string;
    uae_presence: {
      mohap:        string | null;
      upp:          string | null;
      mohap_agents: string[];
      upp_agents:   string[];
    };
    contacts: { name: string; title: string; email?: string; linkedin_url?: string }[];
  }[];
}

export interface MyPortfolio {
  company_name: string;
  result:       AnalysisResult;
  report:       string;
  saved_at:     string;
}

export interface ForecastPackData {
  manufacturer: string;
  pack: string;
  pack_units: number;
  pack_share: number;
  y1_units: number;
  y2_units: number;
  y3_units: number;
  retail_price: number;
  cif_price: number;
  retail_price_usd: number;
  cif_price_usd: number;
  y1_revenue: number;
  y2_revenue: number;
  y3_revenue: number;
}

export interface MoleculeForecast {
  molecule: string;
  product: string;
  competitors: number;
  penetration: number;
  penetration_pct: string;
  analysis_year: number;
  growth_rate: number;
  total_market_units: number;
  total_market_value: number;
  summary: {
    total_y1_units: number;
    total_y2_units: number;
    total_y3_units: number;
    total_y1_revenue: number;
    total_y2_revenue: number;
    total_y3_revenue: number;
  };
  packs: ForecastPackData[];
}

export interface ForecastResult {
  forecasts: MoleculeForecast[];
  errors: { molecule: string; error: string }[];
  growth_rate: number;
}

export interface OutreachEvent {
  type: "status" | "company" | "result_row" | "saved" | "complete" | "error";
  message?: string;
  data?: {
    company: string;
    website: string;
    overview: string;
    uae_presence: {
      mohap: string | null;
      upp: string | null;
      mohap_agents: string[];
      upp_agents: string[];
    };
    contacts: { name: string; title: string; email?: string; linkedin_url?: string }[];
  };
  run_id?: string;
  country?: string;
  companies_found?: number;
}

export interface InventorySku {
  pack_key: string;
  molecule: string;
  strength: string;
  form: string;
  pack_size: string;
  stock_quantity: number;
  /** Open purchase orders (incoming) and open sales orders (promised out). */
  on_order: number;
  committed: number;
}

export type OrderKind = "purchase" | "sales";

/** A line from a supplier's own portal (synced by scripts/sync_tecnimede.py). */
export interface SupplierOrderLine {
  id: number;
  supplier: string;
  order_line: string;
  customer_reference: string | null;
  item_description: string;
  order_quantity: number | null;
  pending_quantity: number | null;
  status: string | null;
  factory_order_number: string | null;
  accepted_at: string | null;
  requested_delivery: string | null;
  factory_confirmation: string | null;
  open: boolean;
  synced_at: string;
  /** Index into PoTracker.stages; null for a status we don't know. */
  stage: number | null;
  /** Portal status → date the sync first saw the line reach it (YYYY-MM-DD). */
  stage_seen: Record<string, string>;
}

export interface SupplierOrder {
  ref: string;                      // COMIX PO number, tidied (P-039/2026)
  items: string[];
  accepted_at: string | null;       // when COMIX placed it
  requested_delivery: string | null;
  stage: number | null;             // furthest-behind line
  completed: boolean;
  molecule: string | null;          // portfolio molecule the order is linked to
  lines: SupplierOrderLine[];
}

export interface PoTracker {
  stages: string[];
  synced_at: string | null;
  /** Latest sync attempt since the backend started (button or 09:00 schedule). */
  last_sync: { at: string; ok: boolean; trigger: "button" | "schedule"; error?: string } | null;
  /** My Portfolio molecules, for linking an order. */
  portfolio: string[];
  orders: SupplierOrder[];
}

export interface StockOrder {
  id: number;
  number: string;       // PO-0001 / SO-0001
  party: string;        // supplier or customer
  order_date: string;
  note: string | null;
  status: "open" | "received" | "delivered" | "cancelled";
  closed_at: string | null;
  lines: { pack_key: string; sku_label: string; quantity: number }[];
}

export interface InventoryMolecule {
  molecule: string;
  option_count: number;
  skus: InventorySku[];
}

export interface InventoryResponse {
  molecules: InventoryMolecule[];
  unmatched_molecules: string[];
}

export interface SkuOption {
  pack_key: string;
  strength: string;
  form: string;
  pack_size: string;
  carried: boolean;
}

export interface SkuOptions {
  molecule: string;
  forms: { form: string; packs: SkuOption[] }[];
}

export type RepRole = "rep" | "manager";

export interface FieldArea {
  id: number;
  name: string;
  emirate: string | null;
}

export interface FieldRep {
  id: string;
  name: string;
  email: string;
  role: RepRole;
  active: boolean;
  area_ids: number[];
}

// ─── Doctors (DHA professional register) ─────────────────────────────────────

export interface DoctorFacets {
  total: number;
  snapshot: string | null;
  professions: { profession: string; n: number }[];
  specialties: { profession: string; specialty: string; n: number }[];
  grades: { profession: string; grade: string; n: number }[];
}

export interface DoctorRow {
  dha_id: string; name: string; profession: string | null; grade: string | null; specialty: string | null;
  facility: string | null; nationality: string | null; license_type: string | null;
  has_email: boolean; has_mobile: boolean; account_id: number | null;
}

export interface DoctorSearch { total: number; offset: number; rows: DoctorRow[] }

export interface DoctorProfile {
  dha_id: string; name: string; profession: string | null; grade: string | null; specialty: string | null;
  category_raw: string | null; facility: string | null; nationality: string | null; license_type: string | null;
  profile_status: string | null; profile_url: string | null; linkedin: string | null; twitter: string | null;
  account_id: number | null; snapshot_date: string | null;
  emails: string[]; phones: string[]; specialties: string[]; licensed_facilities: string[];
  experience: [string, string][]; qualifications: string[]; education: string[]; languages: string[];
}

export interface FieldForceSetup {
  reps: FieldRep[];
  areas: FieldArea[];
}

export interface FieldAccount {
  id: number;
  type: "doctor" | "pharmacy" | "hospital";
  name: string;
  specialty: string | null;
  area_id: number | null;
  area_name: string | null;
  assigned_rep_id: string | null;
  assigned_rep_name: string | null;
  created_by_name: string | null;
  phone: string | null;
  last_visited_at: string | null;
  due_on: string;
}

export interface FieldDashboard {
  days: number;
  totals: { reps: number; accounts: number; on_track: number; visits: number; reached: number; samples: number; orders: number; stock_alerts: number };
  reps: { rep_id: string; name: string; accounts: number; on_track: number; coverage_pct: number | null; visits_7d: number; visits: number; reached: number; samples: number; orders: number }[];
  stock_alerts: { account: string; sku: string; status: "low" | "out"; checked_at: string }[];
  feedback: { molecule: string; prescribing: number; will_try: number; not_interested: number; reasons: { reason: string; count: number }[] }[];
  samples_by_sku: { sku: string; quantity: number }[];
  orders_by_sku: { sku: string; quantity: number }[];
  overdue: { name: string; type: string; area: string | null; last_visited_at: string | null }[];
}

// ─── Deal Tracker ─────────────────────────────────────────────────────────────
/** text | longtext | date | dirac (filled from Dirac's data) | "choice:A|B|C" */
export interface DealField { key: string; label: string; type: string }

export interface DealStage {
  key: string;
  name: string;
  phase: string;
  /** The event that moves a deal on; null for the last stage. */
  trigger: string | null;
  /** Typical document for this stage (all documents are optional). */
  doc?: string;
  fields: DealField[];
}

export type DealStatus = "active" | "on_hold" | "dropped";
/** "" (not decided), "comix" or "partner_agent". */
export type DealMah = "" | "comix" | "partner_agent";

export interface Deal {
  id: number;
  molecule: string;
  partner: string;
  mah: DealMah;
  stage: string;
  stage_entered_at: string;
  status: DealStatus;
  status_reason: string;
  area: string | null;
  /** Filled field count per stage key. */
  filled: Record<string, number>;
  documents: number;
  updated_at: string;
}

export interface DealDocument { id: number; stage: string; file_name: string; size_bytes: number; uploaded_at: string }
/** Moving to Launched adds the molecule to My Portfolio: "added" | "already" | "not_in_iqvia" | "failed: …"; null otherwise. */
export type DealPortfolioResult = string | null;
export interface DealEvent { kind: "stage" | "status" | "portfolio"; from_value: string | null; to_value: string | null; at: string }

export interface DealDetail extends Deal {
  info: Record<string, string>;
  dirac: Record<string, string | null>;
  notes: string;
  document_list: DealDocument[];
  events: DealEvent[];
}

export interface DealRef { id: number; stage: string; stage_name: string; partner: string; status: string }

export interface DealBoard { stages: DealStage[]; reasons: string[]; deals: Deal[] }

export interface DealUpdate {
  partner?: string;
  mah?: DealMah;
  status?: DealStatus;
  status_reason?: string;
  notes?: string;
  info?: Record<string, string>;
}

// ─── Events ───────────────────────────────────────────────────────────────────
export interface EventSummary {
  key: string;
  name: string;
  city: string;
  venue: string;
  starts_on: string | null;
  ends_on: string | null;
  source_url: string;
  exhibitor_count: number;
  synced_at: string | null;
}

export interface EventExhibitor {
  id: number;
  external_id: string;
  name: string;
  country: string;
  booth: string;
  /** The organiser's zone, e.g. "Finished Dosage & Formulation". */
  zone: string;
  org_types: string[];
  business_activities: string[];
  /** e.g. "Middle East Region (e.g. UAE)" */
  markets: string[];
  certifications: string[];
  categories: string[];
  description: string;
  profile_url: string;
  logo_url: string;
  is_new: boolean;
  years_exhibiting: number | null;
  employees: string;
  /** Master-registry company this exhibitor was matched to (null = not found in any registry). */
  company_id: number | null;
}

export interface PortfolioMolecule {
  /** INN or combination ("amlodipine+valsartan"); unmatched ingredient text keeps its raw spelling. */
  molecule: string;
  matched: boolean;
  combination: boolean;
  countries: string[];
  products: number;
  in_uae: boolean;
  atc1: string | null;
  /** UAE IQVIA market value (AED, latest full year); null when not found in IQVIA. */
  market_value_aed: number | null;
}

export interface ExhibitorPortfolio {
  matched: boolean;
  company: { id: number; name: string; entities?: string[]; countries: string[]; products: number; molecules: number } | null;
  /** ATC1 sections A..V, unclassified last. */
  groups: { atc1: string | null; name: string; market_value_aed: number; molecules: PortfolioMolecule[] }[];
  iqvia_year: number | null;
}

export interface EventDetail extends EventSummary {
  zones: { zone: string; exhibitors: EventExhibitor[] }[];
}

// ─── Master registry ─────────────────────────────────────────────────────────

export interface RegistryMolecule { combo_key: string; products: number; companies: number; countries: number; in_uae: boolean }

/** The registry company a catalogue belongs to: a whole group (validated against all its companies), or one company. */
export interface CompanyPick { company_id: number; whole_group: boolean }

export interface RegistryCompanyMember { id: number; name: string; products: number; countries: string[] }

/** A company group (or a company with no group: one member). */
export interface RegistryCompany {
  group_key: string;
  group_id: number | null;
  name: string;
  products: number;
  countries: string[];
  members: RegistryCompanyMember[];
}

export interface MoleculeHolder {
  company_id: number;
  name: string;
  countries: string[];
  products: number;
  in_uae: boolean;
  product_names: string[];
  combos: string[] | null;   // for combination holders: which combinations
  group_key: string;
  members: { company_id: number; name: string; countries: string[]; products: number; in_uae: boolean }[];
}

export interface MoleculeHolders {
  molecule: string;
  combo_key: string | null;
  companies: MoleculeHolder[];              // same molecule / combination
  combination_companies: MoleculeHolder[];  // combinations that contain it
  countries: string[];
  in_uae: number;
}

export interface RegistrySource {
  key: string;
  country: string;
  name: string;
  source_url: string | null;
  company_field: string | null;
  snapshot_date: string | null;
  row_count: number | null;
}

export interface RegistryRow {
  id: number;
  registration_no: string | null;
  product_name: string | null;
  company_raw: string | null;
  company_id: number | null;
  company_name: string | null;
  molecule_raw: string | null;
  combo_key: string | null;
  strength_raw: string | null;
  form_raw: string | null;
  atc: string | null;
  status: "active" | "withdrawn" | "unknown";
}

export interface RegistrySearch { total: number; offset: number; rows: RegistryRow[] }

export interface RegistryRun {
  id: number;
  registry: string;
  started_at: string;
  finished_at: string | null;
  status: "running" | "applied" | "skipped" | "failed";
  snapshot_date: string | null;
  incoming: number | null;
  added: number | null;
  changed: number | null;
  withdrawn: number | null;
  reactivated: number | null;
  unchanged: number | null;
  new_companies: number | null;
  note: string | null;
}

export interface RegistryReviewLog {
  id: number;
  started_at: string;
  finished_at: string | null;
  trigger: string | null;
  companies_judged: number;
  companies_merged: number;
  companies_unsure: number;
  molecules_judged: number;
  molecules_matched: number;
  molecules_unsure: number;
  groups_judged: number | null;
  groups_applied: number | null;
  groups_unsure: number | null;
  error: string | null;
}

export interface GroupClusterMember {
  id: number; name: string; group: string | null; countries: string | null; products: number; examples: string | null;
}

export interface GroupCluster {
  id: number;
  brand: string;
  proposal: { name: string; member_ids: number[]; confidence?: number }[] | null;
  members: GroupClusterMember[];
}

export interface CompanyPair {
  a: number; b: number; a_name: string; b_name: string; sim: number;
  a_countries: string | null; b_countries: string | null; a_products: number; b_products: number;
  a_examples: string | null; b_examples: string | null;
}

export interface UnmatchedIngredient {
  alias: string; products: number; example: string; countries: string | null; ai_answer: string | null; ai_status: string | null;
}

export interface RegistryReview {
  runs: RegistryRun[];
  reviews: RegistryReviewLog[];
  running: boolean;
  counts: {
    companies_waiting: number; companies_unsure: number; molecules_waiting: number; molecules_unsure: number;
    groups_waiting: number; groups_unsure: number; groups: number; queue_refreshed_at: string | null;
  };
  company_pairs: CompanyPair[];
  group_clusters: GroupCluster[];
  molecules: UnmatchedIngredient[];
}

export interface RegistryChange {
  kind: "new" | "changed" | "withdrawn" | "reactivated";
  changes: Record<string, [string | null, string | null]> | null;
  registration_id: number;
  product_name?: string | null;
  company_raw?: string | null;
  molecule_raw?: string | null;
  combo_key?: string | null;
  strength_raw?: string | null;
  status?: string | null;
}
