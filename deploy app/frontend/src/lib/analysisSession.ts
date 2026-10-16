import type { AnalysisResult, CompanyPick } from "@/lib/api";

/** The Analysis page's working state, kept in localStorage so leaving the page (or a reload)
 *  doesn't lose an uploaded catalogue that hasn't been saved. Cleared by "New analysis". */
export const ANALYSIS_SESSION_KEY = "comix_analysis_session";

export interface AnalysisSession {
  mode: "upload" | "craft" | "molecule";
  phase: "portfolio" | "report";
  companyName: string;
  companyPick: CompanyPick | null;
  scoringModel: string;
  result: AnalysisResult;
  reportText: string;
  reportDone: boolean;
  savedAt: string;
}

export function readAnalysisSession(): AnalysisSession | null {
  try {
    const raw = localStorage.getItem(ANALYSIS_SESSION_KEY);
    return raw ? (JSON.parse(raw) as AnalysisSession) : null;
  } catch {
    return null;
  }
}

export function writeAnalysisSession(s: AnalysisSession | null) {
  try {
    if (s) localStorage.setItem(ANALYSIS_SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(ANALYSIS_SESSION_KEY);
  } catch {
    // full or blocked storage: the page still works, it just won't survive leaving it
  }
}
