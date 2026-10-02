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
}

export type ShelfStatus = "in" | "low" | "out";
