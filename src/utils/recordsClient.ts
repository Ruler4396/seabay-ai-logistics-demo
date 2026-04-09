import type { RecentImportRecord, ScenarioId } from "../types";

interface RecentRecordsResponse {
  records: RecentImportRecord[];
}

interface ImportRecordPayload {
  recordType: "ocr_document" | "price_sheet" | "contact_sheet";
  page: "intake" | "quote" | "procurement";
  fileName: string;
  source: "upload" | "sample";
  scenarioId: ScenarioId;
  summary: string;
}

export async function fetchRecentRecords(limit = 8): Promise<RecentImportRecord[]> {
  const response = await fetch(`/seabay-ai-logistics-demo/api/records?limit=${limit}`);
  if (!response.ok) {
    throw new Error("Failed to fetch recent records");
  }
  const payload: RecentRecordsResponse = await response.json();
  return payload.records;
}

export async function createImportRecord(payload: ImportRecordPayload): Promise<void> {
  const response = await fetch("/seabay-ai-logistics-demo/api/records", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error("Failed to create import record");
  }
}
