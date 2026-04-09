import { scenarios } from "../data/scenarios";
import type {
  FieldValidationIssue,
  ParsedShipmentDraft,
  PriceSheetRow,
  QuoteInput,
  QuoteOption,
  RfqAgentPayload,
  Scenario,
  ScenarioId,
  UploadedContactSheet,
  UploadedDemoDocument,
  UploadedPriceSheet,
  VendorContact,
  VendorQuote,
} from "../types";

function laneToken(routeShort: string) {
  return routeShort.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function currentStamp() {
  return new Date().toLocaleString("sv-SE").replace("T", " ");
}

export function getScenarioById(scenarioId: ScenarioId): Scenario {
  const scenario = scenarios.find((item) => item.id === scenarioId);
  if (!scenario) {
    throw new Error(`Unknown scenario: ${scenarioId}`);
  }
  return scenario;
}

export function buildQuoteInputFromScenario(scenario: Scenario): QuoteInput {
  return {
    scenarioId: scenario.id,
    origin: scenario.origin,
    destination: scenario.destination,
    mode: scenario.modeEn,
    container: scenario.container,
    commodity: scenario.commodity,
    packages: scenario.packages,
    grossWeightKg: scenario.grossWeightKg,
    volumeCbm: scenario.volumeCbm,
    incoterm: scenario.incoterm,
    includeCustoms: true,
    includeDelivery: true,
  };
}

export function buildQuoteInputFromDraft(
  draft: ParsedShipmentDraft,
): QuoteInput {
  return {
    scenarioId: draft.scenarioId,
    origin: draft.origin,
    destination: draft.destination,
    mode: draft.mode,
    container: draft.container,
    commodity: draft.commodity,
    packages: draft.packages,
    grossWeightKg: draft.grossWeightKg,
    volumeCbm: draft.volumeCbm,
    incoterm: draft.incoterm,
    includeCustoms: true,
    includeDelivery: true,
  };
}

export function matchPriceSheetFileName(fileName: string, scenario: Scenario) {
  const normalized = fileName.toLowerCase();
  const token = laneToken(scenario.routeShort);
  const routeHints = [
    scenario.routeShort.toLowerCase().replaceAll(" ", ""),
    scenario.routeShort.toLowerCase().replaceAll(" ", "-"),
    token,
    "rate-sheet",
    "price-sheet",
    "pricing",
  ];
  return routeHints.some((token) => normalized.includes(token));
}

export function buildSamplePriceSheet(scenario: Scenario): UploadedPriceSheet {
  return {
    fileName:
      scenario.id === "seabay-air-fra"
        ? "air-eu-westbound-rate-sheet-apr-2026.csv"
        : "ocean-fcl-uswc-rate-sheet-apr-2026.csv",
    source: "sample",
    matched: true,
    lane: scenario.routeShort,
    serviceMode: scenario.modeEn,
    updatedAt: currentStamp(),
    rows: buildPriceSheetRowsFromScenario(scenario),
  };
}

export function buildPriceSheetRowsFromScenario(scenario: Scenario): PriceSheetRow[] {
  return scenario.quoteConfig.tiers.map((tier) => ({
    id: `${scenario.id}-${tier.id}`,
    lane: scenario.routeShort,
    originLabel: scenario.origin,
    destinationLabel: scenario.destination,
    mode: scenario.modeEn,
    container: scenario.container,
    serviceTier: tier.labelEn,
    carrier: tier.carrier,
    transitDays: tier.transitDays,
    validity: "2026-04-15",
    baseUsd: roundUsd(scenario.quoteConfig.baseLinehaulUsd * tier.multiplier),
    doc: scenario.quoteConfig.surchargeDefaults.doc,
    ams: scenario.quoteConfig.surchargeDefaults.ams,
    fuel: roundUsd(scenario.quoteConfig.surchargeDefaults.fuel * tier.multiplier),
    customs: scenario.quoteConfig.surchargeDefaults.customs,
    delivery: scenario.quoteConfig.surchargeDefaults.delivery,
    handling: scenario.quoteConfig.surchargeDefaults.handling,
    remarks: tier.recommendationEn,
  }));
}

export function parsePriceSheetCsv(fileName: string, csvText: string, scenario: Scenario): UploadedPriceSheet {
  const rows = csvText
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  if (rows.length < 2) {
    return {
      fileName,
      source: "upload",
      matched: false,
      lane: scenario.routeShort,
      serviceMode: scenario.modeEn,
      updatedAt: currentStamp(),
      rows: [],
    };
  }

  const headers = rows[0].split(",").map((item) => item.trim());
  const dataRows: PriceSheetRow[] = rows.slice(1).map((line, index) => {
    const values = line.split(",").map((item) => item.trim());
    const row = Object.fromEntries(headers.map((header, headerIndex) => [header, values[headerIndex] ?? ""]));
    return {
      id: `${fileName}-${index}`,
      lane: row.lane || scenario.routeShort,
      originLabel: row.origin_label || scenario.origin,
      destinationLabel: row.destination_label || scenario.destination,
      mode: row.mode || scenario.modeEn,
      container: row.container || scenario.container,
      serviceTier: row.service_tier || `Tier ${index + 1}`,
      carrier: row.carrier || "Seabay Contract Carrier",
      transitDays: Number(row.transit_days || 0),
      validity: row.validity || "2026-04-15",
      baseUsd: Number(row.base_usd || 0),
      doc: Number(row.doc || 0),
      ams: Number(row.ams || 0),
      fuel: Number(row.fuel || 0),
      customs: Number(row.customs || 0),
      delivery: Number(row.delivery || 0),
      handling: Number(row.handling || 0),
      remarks: row.remarks || "",
    };
  });

  const matched = dataRows.length > 0;
  const first = dataRows[0];
  return {
    fileName,
    source: "upload",
    matched,
    lane: first?.lane || scenario.routeShort,
    serviceMode: first?.mode || scenario.modeEn,
    updatedAt: currentStamp(),
    rows: dataRows,
  };
}

export function detectScenarioIdFromPriceSheet(
  rows: PriceSheetRow[],
  fallback: ScenarioId,
): ScenarioId {
  const sample = rows.map((row) => `${row.lane} ${row.originLabel} ${row.destinationLabel} ${row.mode}`.toLowerCase()).join(" ");
  if (sample.includes("pvg") || sample.includes("frankfurt") || sample.includes("air freight")) {
    return "seabay-air-fra";
  }
  if (sample.includes("ytn") || sample.includes("yantian") || sample.includes("los angeles") || sample.includes("ocean freight")) {
    return "seabay-ocean-la";
  }
  return fallback;
}

export function matchContactSheetFileName(fileName: string, scenario: Scenario) {
  const normalized = fileName.toLowerCase();
  const routeToken = laneToken(scenario.routeShort);
  const hints = [
    routeToken,
    "vendor-contact",
    "supplier-contact",
    "contact-list",
    "rfq-contact",
    "contact-book",
    "uswc-rfq",
    "eu-air-rfq",
  ];
  return hints.some((token) => normalized.includes(token));
}

export function buildSampleContactSheet(
  scenario: Scenario,
): UploadedContactSheet {
  return {
    fileName:
      scenario.id === "seabay-air-fra"
        ? "eu-air-rfq-contact-book-apr-2026.csv"
        : "uswc-rfq-contact-book-apr-2026.csv",
    source: "sample",
    matched: true,
    contactCount: scenario.vendorSeeds.length,
    updatedAt: currentStamp(),
    contacts: buildVendorContacts(scenario),
  };
}

export function buildVendorContacts(scenario: Scenario): VendorContact[] {
  return scenario.vendorSeeds.map((seed) => ({
    vendorId: seed.id,
    vendorName: seed.vendorName,
    contactName: seed.contactName,
    channel: seed.channel,
    contactValue: seed.contactValue,
    organizationType: seed.organizationType,
    laneStrength: seed.laneStrength,
  }));
}

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function normalizeChannel(value: string): VendorContact["channel"] {
  const normalized = value.trim().toLowerCase();
  if (normalized.includes("wechat") || normalized.includes("微信")) {
    return "WeChat";
  }
  if (normalized.includes("whatsapp") || normalized.includes("wa")) {
    return "WhatsApp";
  }
  return "Email";
}

export function parseContactSheetCsv(
  fileName: string,
  csvText: string,
  scenario: Scenario,
): UploadedContactSheet {
  const lines = csvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    return {
      fileName,
      source: "upload",
      matched: false,
      contactCount: 0,
      updatedAt: currentStamp(),
      contacts: [],
    };
  }

  const [headerLine, ...bodyLines] = lines;
  const headers = parseCsvLine(headerLine).map((item) => item.toLowerCase());
  const contacts: VendorContact[] = bodyLines
    .map((line, index) => {
      const cells = parseCsvLine(line);
      const read = (field: string) => {
        const headerIndex = headers.indexOf(field);
        return headerIndex >= 0 ? (cells[headerIndex] ?? "").trim() : "";
      };

      const vendorName = read("vendor_name");
      const contactName = read("contact_name");
      const contactValue = read("contact_value");

      if (!vendorName || !contactName || !contactValue) {
        return null;
      }

      return {
        vendorId: `vendor-import-${index + 1}-${vendorName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        vendorName,
        contactName,
        channel: normalizeChannel(read("channel")),
        contactValue,
        organizationType: read("organization_type") || "供应商",
        laneStrength:
          read("lane_strength") ||
          read("service_scope") ||
          read("remarks") ||
          scenario.routeShort,
      } satisfies VendorContact;
    })
    .filter((item): item is VendorContact => Boolean(item));

  return {
    fileName,
    source: "upload",
    matched: contacts.length > 0,
    contactCount: contacts.length,
    updatedAt: currentStamp(),
    contacts,
  };
}

export function matchFileNameToSample(
  fileName: string,
  scenario: Scenario,
) {
  const normalized = fileName.toLowerCase();
  return scenario.sampleDocuments.find((sample) => {
    const tokens = [
      sample.filename.toLowerCase(),
      sample.labelEn.toLowerCase().replaceAll(" ", "-"),
      sample.labelEn.toLowerCase().replaceAll(" ", "_"),
      sample.type.replaceAll("_", "-"),
    ];
    return tokens.some((token) => normalized.includes(token));
  });
}

export function buildShipmentDraft(
  documents: UploadedDemoDocument[],
  scenario: Scenario,
): ParsedShipmentDraft {
  const issues: FieldValidationIssue[] = [];
  const invoice = documents.find((item) => item.type === "commercial_invoice");
  const packing = documents.find((item) => item.type === "packing_list");
  const bill = documents.find(
    (item) => item.type === "draft_bill_of_lading",
  );

  if (invoice && packing && invoice.extracted.packages !== packing.extracted.packages) {
    issues.push({
      id: "package-mismatch",
      field: "packages",
      severity: "critical",
      message: "package count mismatch",
      detail: `Invoice shows ${invoice.extracted.packages} cartons while Packing List shows ${packing.extracted.packages} cartons.`,
    });
  }

  if (!bill) {
    issues.push({
      id: "missing-bl",
      field: "draft bill of lading",
      severity: "warning",
      message: "draft B/L missing",
      detail: "Shipment draft can still be created, but B/L details should be verified before TMS entry.",
    });
  }

  documents.forEach((document) => {
    const requiredChecks = [
      ["customer", document.extracted.customer],
      ["origin", document.extracted.origin],
      ["destination", document.extracted.destination],
      ["commodity", document.extracted.commodity],
      ["packages", String(document.extracted.packages || "")],
    ];

    requiredChecks.forEach(([field, value]) => {
      if (!value) {
        issues.push({
          id: `${document.id}-${field}-missing`,
          field,
          severity: "warning",
          message: `${field} missing`,
          detail: `${document.labelEn} is missing required field: ${field}.`,
        });
      }
    });

    document.extracted.highlights
      .filter((item) => item.severity !== "info")
      .forEach((item) => {
        issues.push({
          id: `${document.id}-${item.label}`,
          field: item.label,
          severity: item.severity,
          message: `${item.label} needs review`,
          detail: `${document.labelEn} confidence ${Math.round(item.confidence * 100)}% for "${item.text}".`,
        });
      });
  });

  const packages = packing?.extracted.packages ?? bill?.extracted.packages ?? scenario.packages;
  const grossWeightKg =
    packing?.extracted.grossWeightKg ??
    invoice?.extracted.grossWeightKg ??
    scenario.grossWeightKg;
  const volumeCbm =
    packing?.extracted.volumeCbm ??
    invoice?.extracted.volumeCbm ??
    scenario.volumeCbm;

  return {
    scenarioId: scenario.id,
    customer: invoice?.extracted.customer ?? scenario.customer,
    shipper: bill?.extracted.shipper ?? invoice?.extracted.shipper ?? "Shenzhen Seabay Export Team",
    consignee: bill?.extracted.consignee ?? invoice?.extracted.consignee ?? scenario.customer,
    notifyParty: bill?.extracted.notifyParty ?? invoice?.extracted.notifyParty,
    origin: bill?.extracted.origin ?? scenario.origin,
    destination: bill?.extracted.destination ?? scenario.destination,
    mode: scenario.modeEn,
    container: bill?.extracted.container ?? scenario.container,
    commodity: invoice?.extracted.commodity ?? scenario.commodity,
    lineItems: invoice?.extracted.lineItems ?? packing?.extracted.lineItems ?? [],
    packages,
    grossWeightKg,
    volumeCbm,
    incoterm: invoice?.extracted.incoterm ?? scenario.incoterm,
    documentIds: documents.map((item) => item.id),
    issues,
  };
}

export function buildQuoteOptions(
  input: QuoteInput,
  scenario: Scenario,
  priceSheet: UploadedPriceSheet,
): QuoteOption[] {
  const matchedRows =
    priceSheet.rows.filter((row) => {
      const rowMode = row.mode.toLowerCase();
      const inputMode = input.mode.toLowerCase();
      const rowContainer = row.container.toLowerCase();
      const inputContainer = input.container.toLowerCase();
      return (
        (!rowMode || inputMode.includes(rowMode) || rowMode.includes(inputMode)) &&
        (!rowContainer || inputContainer.includes(rowContainer) || rowContainer.includes(inputContainer))
      );
    }) || [];

  const rows = matchedRows.length ? matchedRows : priceSheet.rows;

  return rows.slice(0, 3).map((row, index) => {
    const fallbackTier = scenario.quoteConfig.tiers[index] ?? scenario.quoteConfig.tiers[0];
    const breakdown = [
      { label: "Linehaul", amountUsd: row.baseUsd },
      { label: "DOC", amountUsd: row.doc },
      { label: "AMS / Filing", amountUsd: row.ams },
      { label: "Fuel", amountUsd: row.fuel },
      { label: "Handling", amountUsd: row.handling },
    ];

    if (input.includeCustoms) {
      breakdown.push({
        label: "Customs Clearance",
        amountUsd: row.customs,
      });
    }

    if (input.includeDelivery) {
      breakdown.push({
        label: "Final Delivery",
        amountUsd: row.delivery,
      });
    }

    const totalUsd = roundUsd(
      breakdown.reduce((sum, item) => sum + item.amountUsd, 0),
    );

    return {
      id: row.id,
      tierId: row.serviceTier.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      label: fallbackTier.label,
      labelEn: row.serviceTier,
      badge: fallbackTier.badge,
      carrier: row.carrier,
      totalUsd,
      transitDays: row.transitDays,
      recommendationZh: fallbackTier.recommendationZh,
      recommendationEn: row.remarks || fallbackTier.recommendationEn,
      breakdown,
      summaryEn: `${row.serviceTier} via ${row.carrier}, ${row.transitDays} transit days, total USD ${formatUsd(
        totalUsd,
      )} for ${input.container} from ${input.origin} to ${input.destination}.`,
    };
  });
}

export function buildVendorQuotes(
  scenario: Scenario,
  contacts: VendorContact[],
  selectedQuote: QuoteOption,
): VendorQuote[] {
  return contacts.map((contact, index) => {
    const seed =
      scenario.vendorSeeds.find((item) => item.vendorName === contact.vendorName) ??
      scenario.vendorSeeds[index % scenario.vendorSeeds.length];

    return {
      id: contact.vendorId,
      vendorName: contact.vendorName,
      laneStrength: contact.laneStrength,
      totalUsd: roundUsd(selectedQuote.totalUsd + seed.baseDeltaUsd),
      transitDays: seed.transitDays,
      freeDays: seed.freeDays,
      validity: seed.validity,
      remarks: seed.remarks,
      label: seed.label,
      status: "sending",
    };
  });
}

export function buildRfqAgentPayload(
  scenario: Scenario,
  contacts: VendorContact[],
  selectedQuote: QuoteOption,
): RfqAgentPayload {
  return {
    lane: `${scenario.origin} -> ${scenario.destination}`,
    cargo: scenario.commodity,
    targetContacts: contacts.map((item) => ({
      vendorName: item.vendorName,
      contactName: item.contactName,
      channel: item.channel,
      contactValue: item.contactValue,
    })),
    benchmarkQuoteUsd: selectedQuote.totalUsd,
    requirements: {
      mode: scenario.modeEn,
      incoterm: scenario.incoterm,
      container: scenario.container,
    },
  };
}

export function formatUsd(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

export function roundUsd(value: number): number {
  return Math.round(value);
}
