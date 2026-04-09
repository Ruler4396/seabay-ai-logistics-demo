export type ScenarioId = "seabay-ocean-la" | "seabay-air-fra";
export type Locale = "zh" | "en";

export type DocumentType =
  | "commercial_invoice"
  | "packing_list"
  | "draft_bill_of_lading";

export type Severity = "info" | "warning" | "critical";

export type InquiryStatus = "idle" | "running" | "completed";

export type VendorQuoteStatus = "queued" | "sending" | "received";

export type ContactChannel = "Email" | "WeChat" | "WhatsApp";
export type OcrEngineStatus = "idle" | "running" | "done" | "error";

export interface OcrBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface OcrLineItem {
  sku: string;
  description: string;
  qty: number;
  unit?: string;
  cartons?: number;
  netWeightKg?: number;
  grossWeightKg?: number;
  unitPriceUsd?: number;
  amountUsd?: number;
}

export interface OcrHighlight {
  label: string;
  text: string;
  confidence: number;
  severity: Severity;
  bbox?: OcrBox | null;
}

export interface OcrRegion {
  text: string;
  confidence: number;
  bbox: OcrBox;
}

export interface OcrWarning {
  field: string;
  severity: Severity;
  message: string;
  detail: string;
  reasonCode: string;
  isKeyField: boolean;
}

export interface SampleDocument {
  id: string;
  type: DocumentType;
  label: string;
  labelEn: string;
  filename: string;
  assetPath: string;
  mimeType: string;
  issuer: string;
  extracted: {
    documentNo: string;
    issueDate: string;
    customer: string;
    shipper: string;
    consignee: string;
    notifyParty?: string;
    origin: string;
    destination: string;
    commodity: string;
    hsCode?: string;
    packages: number;
    grossWeightKg: number;
    volumeCbm: number;
    incoterm: string;
    mode: string;
    container: string;
    vesselVoyage?: string;
    paymentTerm?: string;
    marks?: string;
    sealNo?: string;
    lineItems: OcrLineItem[];
    highlights: OcrHighlight[];
  };
}

export interface QuoteTierConfig {
  id: string;
  label: string;
  labelEn: string;
  carrier: string;
  multiplier: number;
  transitDays: number;
  recommendationZh: string;
  recommendationEn: string;
  badge: "Best Cost" | "Best Balance" | "Fastest";
}

export interface Scenario {
  id: ScenarioId;
  name: string;
  nameEn: string;
  customer: string;
  customerType: string;
  origin: string;
  destination: string;
  routeShort: string;
  mode: string;
  modeEn: string;
  incoterm: string;
  container: string;
  commodity: string;
  packages: number;
  grossWeightKg: number;
  volumeCbm: number;
  laneNote: string;
  sampleDocuments: SampleDocument[];
  kpis: {
    manualHoursSaved: string;
    quoteTurnaround: string;
    vendorCoverage: string;
    dataAccuracy: string;
  };
  quoteConfig: {
    baseLinehaulUsd: number;
    surchargeDefaults: {
      doc: number;
      ams: number;
      fuel: number;
      customs: number;
      delivery: number;
      handling: number;
    };
    tiers: QuoteTierConfig[];
  };
  vendorSeeds: Array<{
    id: string;
    vendorName: string;
    contactName: string;
    channel: ContactChannel;
    contactValue: string;
    organizationType: string;
    laneStrength: string;
    baseDeltaUsd: number;
    transitDays: number;
    freeDays: number;
    validity: string;
    remarks: string;
    label: "Best Cost" | "Best Balance" | "Fastest";
  }>;
}

export interface UploadedDemoDocument {
  id: string;
  scenarioId: ScenarioId;
  source: "sample" | "upload";
  type: DocumentType;
  labelZh: string;
  labelEn: string;
  fileName: string;
  mimeType: string;
  previewUrl: string;
  previewWidth?: number;
  previewHeight?: number;
  matched: boolean;
  rawText?: string;
  ocrRegions?: OcrRegion[];
  riskAlerts?: OcrWarning[];
  ocrWarnings?: OcrWarning[];
  warnings?: OcrWarning[];
  extracted: SampleDocument["extracted"];
}

export interface FieldValidationIssue {
  id: string;
  field: string;
  severity: Severity;
  message: string;
  detail: string;
}

export interface ParsedShipmentDraft {
  scenarioId: ScenarioId;
  customer: string;
  shipper: string;
  consignee: string;
  notifyParty?: string;
  origin: string;
  destination: string;
  mode: string;
  container: string;
  commodity: string;
  lineItems: OcrLineItem[];
  packages: number;
  grossWeightKg: number;
  volumeCbm: number;
  incoterm: string;
  documentIds: string[];
  issues: FieldValidationIssue[];
}

export interface QuoteInput {
  scenarioId: ScenarioId;
  origin: string;
  destination: string;
  mode: string;
  container: string;
  commodity: string;
  packages: number;
  grossWeightKg: number;
  volumeCbm: number;
  incoterm: string;
  includeCustoms: boolean;
  includeDelivery: boolean;
}

export interface UploadedPriceSheet {
  fileName: string;
  source: "sample" | "upload";
  matched: boolean;
  lane: string;
  serviceMode: string;
  updatedAt: string;
  rows: PriceSheetRow[];
}

export interface PriceSheetRow {
  id: string;
  lane: string;
  originLabel: string;
  destinationLabel: string;
  mode: string;
  container: string;
  serviceTier: string;
  carrier: string;
  transitDays: number;
  validity: string;
  baseUsd: number;
  doc: number;
  ams: number;
  fuel: number;
  customs: number;
  delivery: number;
  handling: number;
  remarks: string;
}

export interface RecentImportRecord {
  id: number;
  recordType: "ocr_document" | "price_sheet" | "contact_sheet";
  page: "intake" | "quote" | "procurement";
  fileName: string;
  source: "upload" | "sample";
  scenarioId: ScenarioId;
  summary: string;
  createdAt: string;
}

export interface UploadedContactSheet {
  fileName: string;
  source: "sample" | "upload";
  matched: boolean;
  contactCount: number;
  updatedAt: string;
  contacts: VendorContact[];
}

export interface VendorContact {
  vendorId: string;
  vendorName: string;
  contactName: string;
  channel: ContactChannel;
  contactValue: string;
  organizationType: string;
  laneStrength: string;
}

export interface QuoteChargeItem {
  label: string;
  amountUsd: number;
}

export interface QuoteOption {
  id: string;
  tierId: string;
  label: string;
  labelEn: string;
  badge: "Best Cost" | "Best Balance" | "Fastest";
  carrier: string;
  totalUsd: number;
  transitDays: number;
  recommendationZh: string;
  recommendationEn: string;
  breakdown: QuoteChargeItem[];
  summaryEn: string;
}

export interface VendorQuote {
  id: string;
  vendorName: string;
  laneStrength: string;
  totalUsd: number;
  transitDays: number;
  freeDays: number;
  validity: string;
  remarks: string;
  label: "Best Cost" | "Best Balance" | "Fastest";
  status: VendorQuoteStatus;
}

export interface VendorInquiryTask {
  id: string;
  scenarioId: ScenarioId;
  basedOnQuoteId: string;
  status: InquiryStatus;
  startedAt: number;
  quotes: VendorQuote[];
  recommendedVendorId: string | null;
}

export interface RfqAgentPayload {
  lane: string;
  cargo: string;
  targetContacts: Array<{
    vendorName: string;
    contactName: string;
    channel: ContactChannel;
    contactValue: string;
  }>;
  benchmarkQuoteUsd: number;
  requirements: {
    mode: string;
    incoterm: string;
    container: string;
  };
}
