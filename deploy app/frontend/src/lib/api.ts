const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

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

  // Outreach
  getOutreachRuns: () => req<{ runs: OutreachRun[] }>("/api/outreach/runs"),

  getOutreachRun: (runId: string) =>
    req<OutreachRunDetail>(`/api/outreach/runs/${runId}`),

  deleteOutreachRun: (runId: string) =>
    req(`/api/outreach/runs/${runId}`, { method: "DELETE" }),
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
  // Added by frontend after scoring
  ai_score?: number;
  ai_reasoning?: string;
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
