import type { FilamentSource } from '../domain/filamentSource.ts';

export type ProjectState =
  | "INTAKE"
  | "REVIEW"
  | "QUOTE"
  | "AWAITING_PAYMENT"
  | "READY_FOR_PRINTING"
  | "IN_PRODUCTION"
  | "READY_FOR_COLLECTION"
  | "PARTIALLY_COLLECTED"
  | "CLOSED"
  | "CANCELLED";

export type PrintStatus =
  | "DRAFT"
  | "VERIFIED"
  | "READY"
  | "PRINTING"
  | "PRINTED"
  | "FAILED"
  | "POST_PROCESSING"
  | "COLLECTED";

export interface PrintRun {
  id: number;
  part_id: string;
  project_id: string;
  machine_id?: string | null;
  machine_name?: string | null;
  started_by: string;
  ended_by?: string | null;
  started_at: string;
  finished_at?: string | null;
  failed_at?: string | null;
  failure_reason?: string | null;
  outcome?: "PRINTED" | "FAILED" | null;
}

export interface Part {
  id: string;
  partNumber: number;
  partName: string;
  sourceFilePath?: string;

  printerName?: string;
  primaryMaterial: string;
  primaryBrand: string;
  primaryFilamentSource?: FilamentSource;
  primaryOwnFilament: boolean;

  secondaryMaterial?: string;
  secondaryBrand?: string;
  secondaryFilamentSource?: FilamentSource;
  secondaryOwnFilament?: boolean;
  secondaryWeight?: number;
  secondaryEstimatedWeight?: number;
  secondaryMaterialCost?: number;
  secondaryServiceCost?: number;
  secondaryLength?: number;

  imageUrl?: string;

  specialInstruction: string;

  primaryWeight?: number;
  primaryEstimatedWeight: number;
  primaryLength?: number;
  printingTime?: string;

  expanded?: boolean;

  primaryMaterialCost: number;
  primaryServiceCost: number;

  checkedBy?: string;
  startedBy?: string;
  removedBy?: string;
  collectedBy?: string;
  collectedByStudentNumber?: string;
  collectedAt?: string;

  printStatus: PrintStatus;
  printRuns?: PrintRun[];
  
  materials?: unknown[]; // Allow optional parsed materials array
}

export interface QuoteSnapshotMaterialLine {
  slot: "primary" | "secondary";
  material_bucket: string;
  filament_source?: FilamentSource;
  material: string;
  grams: number;
  cost: number;
}

export interface QuoteSnapshotLine {
  part_id: string;
  part_number: number;
  part_name: string;
  total_grams: number;
  total_cost: number;
  materials: QuoteSnapshotMaterialLine[];
}

export interface QuoteSnapshot {
  snapshot_version: number;
  status: "ISSUED" | "SUPERSEDED";
  currency: string;
  total_cost: number;
  generated_at: string;
  line_summary: QuoteSnapshotLine[];
}

export interface Project {
  id: string;
  priorityNumber: number;
  studentName: string;
  studentNumber: string;
  email: string;
  course: string;
  lecturer: string;
  needsPayment: boolean;
  moduleOrLecturerPays?: boolean;
  defaultFilamentSource?: FilamentSource;
  receiptNumber?: string;
  paymentNote?: string;
  paymentOverrideNote?: string;
  state: ProjectState;
  printLabel?: string;
  quoteSnapshot?: QuoteSnapshot;
  quoteSnapshots?: QuoteSnapshot[];
  parts: Part[];
  createdAt: string;
  archived: boolean;
}
