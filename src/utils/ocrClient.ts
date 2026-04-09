import type { UploadedDemoDocument } from "../types";

export interface OcrParseResponse {
  documents: UploadedDemoDocument[];
}

export async function parseDocumentsWithOcr(
  files: FileList | File[],
): Promise<OcrParseResponse> {
  const formData = new FormData();
  Array.from(files).forEach((file) => formData.append("files", file));

  const response = await fetch("/seabay-ai-logistics-demo/api/parse", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "OCR request failed");
  }

  return response.json();
}
