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
  uploadCatalogue: (file: File, company: string) => {
    const form = new FormData();
    form.append("file", file);
    form.append("company", company);
    return req<AnalysisResult>("/api/analysis/upload", { method: "POST", body: form });
  },

  enrichMolecules: (molecules: string[], company?: string) =>
    req<AnalysisResult>("/api/analysis/enrich", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ molecules, company }),
    }),

  getManufacturers: (molecule: string) =>
    req<ManufacturerBreakdown>(`/api/analysis/manufacturers/${encodeURIComponent(molecule)}`),

  getMoleculeTrend: (molecule: string) =>
    req<MoleculeSlices>(`/api/analysis/trend/${encodeURIComponent(molecule)}`),

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

  savePortfolioUpload: (file: File, company: string) => {
    const form = new FormData();
    form.append("file", file);
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
  // Added by frontend after scoring
  ai_score?: number;
  ai_reasoning?: string;
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
