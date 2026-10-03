export type AccountType = "doctor" | "pharmacy" | "hospital";

export interface Rep {
  id: string;
  name: string;
  email: string;
  role: "rep" | "manager";
  active: boolean;
}

export interface Area {
  id: number;
  name: string;
  emirate: string | null;
}

export interface AccountStatus {
  id: number;
  type: AccountType;
  name: string;
  specialty: string | null;
  parent_id: number | null;
  area_id: number | null;
  assigned_rep_id: string | null;
  phone: string | null;
  address: string | null;
  visit_every_days: number | null;
  area_name: string | null;
  last_visited_at: string | null;
  last_note: string | null;
  cadence_days: number | null;
  due_on: string | null;
}

export interface Sku {
  pack_key: string;
  molecule: string;
  strength: string | null;
  form: string | null;
  pack_size: string | null;
  stock_quantity: number | null;
}

export interface VisitRow {
  id: number;
  account_id: number;
  visited_at: string;
  note: string | null;
  molecules: string[] | null;
  outcome: Outcome;
}

export type ShelfStatus = "in" | "low" | "out";

export type Outcome = "met" | "not_available" | "cancelled" | "order_taken" | "no_order";
export type Stance = "prescribing" | "will_try" | "not_interested";
export type Reason = "price" | "efficacy" | "side_effects" | "competitor" | "not_stocked";

export const OUTCOMES: Record<"clinic" | "pharmacy", { v: Outcome; label: string }[]> = {
  clinic: [
    { v: "met", label: "Met" },
    { v: "not_available", label: "Not available" },
    { v: "cancelled", label: "Cancelled" },
  ],
  pharmacy: [
    { v: "order_taken", label: "Order taken" },
    { v: "no_order", label: "No order" },
    { v: "not_available", label: "Not available" },
  ],
};

export const OUTCOME_LABEL: Record<Outcome, string> = {
  met: "Met",
  not_available: "Not available",
  cancelled: "Cancelled",
  order_taken: "Order taken",
  no_order: "No order",
};

export const STANCES: { v: Stance; label: string }[] = [
  { v: "prescribing", label: "Prescribing" },
  { v: "will_try", label: "Will try" },
  { v: "not_interested", label: "Not interested" },
];

export const REASONS: { v: Reason; label: string }[] = [
  { v: "price", label: "Price" },
  { v: "efficacy", label: "Efficacy" },
  { v: "side_effects", label: "Side effects" },
  { v: "competitor", label: "Uses competitor" },
  { v: "not_stocked", label: "Not stocked nearby" },
];

export interface Feedback {
  molecule: string;
  stance: Stance;
  reason: Reason | null;
}

/** A recent paper on a molecule, summarised for reps (written by the backend). */
export interface ResearchCard {
  id: number;
  molecule: string;
  pmid: string;
  title: string;
  journal: string | null;
  published_on: string | null;
  study: string | null;
  finding: string;
  say: string | null;
  caution: string | null;
  rank: number;
  created_at: string;
}
