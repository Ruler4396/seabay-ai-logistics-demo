import {
  createContext,
  startTransition,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { defaultScenarioId } from "../data/scenarios";
import type {
  Locale,
  OcrEngineStatus,
  ParsedShipmentDraft,
  QuoteInput,
  QuoteOption,
  RecentImportRecord,
  RfqAgentPayload,
  Scenario,
  ScenarioId,
  UploadedContactSheet,
  UploadedDemoDocument,
  VendorContact,
  UploadedPriceSheet,
  VendorInquiryTask,
} from "../types";
import {
  buildRfqAgentPayload,
  buildSampleContactSheet,
  buildSamplePriceSheet,
  detectScenarioIdFromPriceSheet,
  buildQuoteInputFromDraft,
  buildQuoteInputFromScenario,
  buildQuoteOptions,
  buildShipmentDraft,
  buildVendorContacts,
  buildVendorQuotes,
  getScenarioById,
  parseContactSheetCsv,
  parsePriceSheetCsv,
} from "../utils/demoEngine";
import { parseDocumentsWithOcr } from "../utils/ocrClient";
import { createImportRecord, fetchRecentRecords } from "../utils/recordsClient";

interface DemoContextValue {
  locale: Locale;
  scenario: Scenario;
  uploadedDocs: UploadedDemoDocument[];
  unmatchedFiles: string[];
  ocrStatus: OcrEngineStatus;
  ocrError: string | null;
  parsedDraft: ParsedShipmentDraft | null;
  uploadedPriceSheet: UploadedPriceSheet | null;
  uploadedContactSheet: UploadedContactSheet | null;
  vendorContacts: VendorContact[];
  quoteInput: QuoteInput;
  quoteOptions: QuoteOption[];
  selectedQuote: QuoteOption | null;
  inquiryTask: VendorInquiryTask | null;
  rfqAgentPayload: RfqAgentPayload | null;
  recentRecords: RecentImportRecord[];
  setLocale: (locale: Locale) => void;
  toggleLocale: () => void;
  setScenarioId: (scenarioId: ScenarioId) => void;
  refreshRecentRecords: () => Promise<void>;
  ingestFiles: (files: FileList | File[]) => Promise<void>;
  clearDocuments: () => void;
  loadSamplePriceSheet: () => void;
  ingestPriceSheet: (files: FileList | File[]) => Promise<void>;
  updatePriceSheetRow: (rowId: string, patch: Record<string, string | number>) => void;
  loadSampleContactSheet: () => void;
  ingestContactSheet: (files: FileList | File[]) => Promise<void>;
  updateQuoteInput: (patch: Partial<QuoteInput>) => void;
  generateQuotes: () => void;
  chooseQuote: (quoteId: string) => void;
  launchInquiry: () => void;
}

const DemoContext = createContext<DemoContextValue | null>(null);

function currentStamp() {
  return new Date().toLocaleString("sv-SE").replace("T", " ");
}

export function DemoProvider({ children }: PropsWithChildren) {
  const [locale, setLocale] = useState<Locale>("zh");
  const [scenarioId, setScenarioIdState] =
    useState<ScenarioId>(defaultScenarioId);
  const scenario = useMemo(() => getScenarioById(scenarioId), [scenarioId]);
  const [uploadedDocs, setUploadedDocs] = useState<UploadedDemoDocument[]>([]);
  const [unmatchedFiles, setUnmatchedFiles] = useState<string[]>([]);
  const [ocrStatus, setOcrStatus] = useState<OcrEngineStatus>("idle");
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [parsedDraft, setParsedDraft] = useState<ParsedShipmentDraft | null>(
    null,
  );
  const [uploadedPriceSheet, setUploadedPriceSheet] =
    useState<UploadedPriceSheet | null>(null);
  const [uploadedContactSheet, setUploadedContactSheet] =
    useState<UploadedContactSheet | null>(null);
  const [quoteInput, setQuoteInput] = useState<QuoteInput>(
    buildQuoteInputFromScenario(scenario),
  );
  const [quoteOptions, setQuoteOptions] = useState<QuoteOption[]>([]);
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null);
  const [inquiryTask, setInquiryTask] = useState<VendorInquiryTask | null>(
    null,
  );
  const [rfqAgentPayload, setRfqAgentPayload] =
    useState<RfqAgentPayload | null>(null);
  const [recentRecords, setRecentRecords] = useState<RecentImportRecord[]>([]);
  const inquiryTimersRef = useRef<number[]>([]);

  useEffect(() => {
    setQuoteInput(buildQuoteInputFromScenario(scenario));
  }, [scenario]);

  useEffect(() => {
    if (!uploadedDocs.length) {
      setParsedDraft(null);
      setQuoteInput(buildQuoteInputFromScenario(scenario));
      return;
    }

    const draft = buildShipmentDraft(uploadedDocs, scenario);
    setParsedDraft(draft);
    setQuoteInput(buildQuoteInputFromDraft(draft));
    setQuoteOptions([]);
    setSelectedQuoteId(null);
    setInquiryTask(null);
    setRfqAgentPayload(null);
  }, [scenario, uploadedDocs]);

  useEffect(() => {
    return () => {
      inquiryTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  useEffect(() => {
    void refreshRecentRecords();
  }, []);

  const selectedQuote = useMemo(
    () => quoteOptions.find((option) => option.id === selectedQuoteId) ?? null,
    [quoteOptions, selectedQuoteId],
  );
  const vendorContacts = useMemo(
    () =>
      uploadedContactSheet?.matched
        ? uploadedContactSheet.contacts.length
          ? uploadedContactSheet.contacts
          : buildVendorContacts(scenario)
        : [],
    [scenario, uploadedContactSheet],
  );

  const refreshRecentRecords = async () => {
    try {
      const records = await fetchRecentRecords();
      setRecentRecords(records);
    } catch {
      setRecentRecords([]);
    }
  };

  const resetStateForScenario = (nextScenarioId: ScenarioId) => {
    inquiryTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    inquiryTimersRef.current = [];
    const nextScenario = getScenarioById(nextScenarioId);
    startTransition(() => {
      setScenarioIdState(nextScenarioId);
      setUploadedDocs([]);
      setUnmatchedFiles([]);
      setOcrStatus("idle");
      setOcrError(null);
      setParsedDraft(null);
      setUploadedPriceSheet(null);
      setUploadedContactSheet(null);
      setQuoteOptions([]);
      setSelectedQuoteId(null);
      setInquiryTask(null);
      setRfqAgentPayload(null);
      setQuoteInput(buildQuoteInputFromScenario(nextScenario));
    });
  };

  const ingestFiles = async (files: FileList | File[]) => {
    const [file] = Array.from(files);
    if (!file) {
      return;
    }

    setOcrStatus("running");
    setOcrError(null);
    try {
      const result = await parseDocumentsWithOcr([file]);
      const nextDocs = result.documents.map((document) => ({
        ...document,
        id: `${document.type}-${document.fileName}-${Date.now()}`,
        scenarioId: document.scenarioId ?? scenario.id,
        source: "upload" as const,
      }));
      const detectedScenarioId = nextDocs[0]?.scenarioId ?? scenario.id;
      const detectedScenario = getScenarioById(detectedScenarioId);

      startTransition(() => {
        setScenarioIdState(detectedScenarioId);
        setUploadedDocs(nextDocs);
        setUnmatchedFiles([]);
        setOcrStatus("done");
        setUploadedPriceSheet(null);
        setUploadedContactSheet(null);
        setQuoteOptions([]);
        setSelectedQuoteId(null);
        setInquiryTask(null);
        setRfqAgentPayload(null);
        setQuoteInput(buildQuoteInputFromScenario(detectedScenario));
      });
      await refreshRecentRecords();
    } catch (error) {
      setOcrStatus("error");
      setOcrError(error instanceof Error ? error.message : "OCR failed");
    }
  };

  const clearDocuments = () => {
    startTransition(() => {
      setUploadedDocs([]);
      setUnmatchedFiles([]);
      setOcrStatus("idle");
      setOcrError(null);
      setParsedDraft(null);
      setQuoteOptions([]);
      setSelectedQuoteId(null);
      setInquiryTask(null);
      setRfqAgentPayload(null);
      setUploadedContactSheet(null);
      setQuoteInput(buildQuoteInputFromScenario(scenario));
    });
  };

  const loadSamplePriceSheet = () => {
    const sampleSheet = buildSamplePriceSheet(scenario);
    setUploadedPriceSheet(sampleSheet);
    void createImportRecord({
      recordType: "price_sheet",
      page: "quote",
      fileName: sampleSheet.fileName,
      source: "sample",
      scenarioId: scenario.id,
      summary: sampleSheet.fileName,
    }).then(refreshRecentRecords).catch(() => undefined);
  };

  const ingestPriceSheet = async (files: FileList | File[]) => {
    const [file] = Array.from(files);
    if (!file) {
      return;
    }
    const csvText = await file.text();
    const parsedSheet = parsePriceSheetCsv(file.name, csvText, scenario);
    const nextScenarioId = detectScenarioIdFromPriceSheet(parsedSheet.rows, scenario.id);
    const nextScenario = getScenarioById(nextScenarioId);

    startTransition(() => {
      setScenarioIdState(nextScenarioId);
      setUploadedPriceSheet(parsedSheet);
      if (!uploadedDocs.length) {
        setQuoteInput(buildQuoteInputFromScenario(nextScenario));
      }
      setQuoteOptions([]);
      setSelectedQuoteId(null);
    });
    void createImportRecord({
      recordType: "price_sheet",
      page: "quote",
      fileName: file.name,
      source: "upload",
      scenarioId: nextScenarioId,
      summary: file.name,
    }).then(refreshRecentRecords).catch(() => undefined);
  };

  const updatePriceSheetRow = (rowId: string, patch: Record<string, string | number>) => {
    setUploadedPriceSheet((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        rows: current.rows.map((row) => (row.id === rowId ? { ...row, ...patch } : row)),
        updatedAt: currentStamp(),
      };
    });
    setQuoteOptions([]);
    setSelectedQuoteId(null);
  };

  const loadSampleContactSheet = () => {
    const sampleSheet = buildSampleContactSheet(scenario);
    setUploadedContactSheet(sampleSheet);
    void createImportRecord({
      recordType: "contact_sheet",
      page: "procurement",
      fileName: sampleSheet.fileName,
      source: "sample",
      scenarioId: scenario.id,
      summary: `${scenario.routeShort}`,
    }).then(refreshRecentRecords).catch(() => undefined);
  };

  const ingestContactSheet = async (files: FileList | File[]) => {
    const [file] = Array.from(files);
    if (!file) {
      return;
    }

    const csvText = await file.text();
    const parsedSheet = parseContactSheetCsv(file.name, csvText, scenario);
    setUploadedContactSheet(parsedSheet);
    void createImportRecord({
      recordType: "contact_sheet",
      page: "procurement",
      fileName: file.name,
      source: "upload",
      scenarioId: scenario.id,
      summary: file.name,
    }).then(refreshRecentRecords).catch(() => undefined);
  };

  const updateQuoteInput = (patch: Partial<QuoteInput>) => {
    setQuoteInput((current) => ({ ...current, ...patch }));
  };

  const generateQuotes = () => {
    if (!uploadedPriceSheet?.matched) {
      return;
    }
    const nextOptions = buildQuoteOptions(quoteInput, scenario, uploadedPriceSheet);
    const recommended =
      nextOptions.find((option) => option.badge === "Best Balance") ??
      nextOptions[0] ??
      null;

    startTransition(() => {
      setQuoteOptions(nextOptions);
      setSelectedQuoteId(recommended?.id ?? null);
      setInquiryTask(null);
      setRfqAgentPayload(null);
    });
  };

  const chooseQuote = (quoteId: string) => {
    setSelectedQuoteId(quoteId);
  };

  const launchInquiry = () => {
    const effectiveOptions =
      quoteOptions.length || !uploadedPriceSheet?.matched
        ? quoteOptions
        : buildQuoteOptions(quoteInput, scenario, uploadedPriceSheet);
    const quote =
      selectedQuote ??
      effectiveOptions.find((option) => option.badge === "Best Balance") ??
      effectiveOptions[0] ??
      null;
    if (!quote || !uploadedContactSheet?.matched || !vendorContacts.length) {
      return;
    }

    if (!quoteOptions.length && effectiveOptions.length) {
      setQuoteOptions(effectiveOptions);
      setSelectedQuoteId(quote.id);
    }

    inquiryTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    inquiryTimersRef.current = [];
    const seededQuotes = buildVendorQuotes(scenario, vendorContacts, quote).map((item) => ({
      ...item,
      status: "sending" as const,
    }));

    const taskId = `${scenario.id}-${quote.id}-rfq`;
    setInquiryTask({
      id: taskId,
      scenarioId: scenario.id,
      basedOnQuoteId: quote.id,
      status: "running",
      startedAt: Date.now(),
      quotes: seededQuotes,
      recommendedVendorId: null,
    });
    setRfqAgentPayload(buildRfqAgentPayload(scenario, vendorContacts, quote));

    seededQuotes.forEach((vendor, index) => {
      const timer = window.setTimeout(() => {
        setInquiryTask((current) => {
          if (!current || current.id !== taskId) {
            return current;
          }
          const quotes = current.quotes.map((item) =>
            item.id === vendor.id ? { ...item, status: "received" as const } : item,
          );
          const completed = quotes.every((item) => item.status === "received");
          const recommendedVendorId =
            quotes.find((item) => item.label === "Best Balance")?.id ?? null;
          return {
            ...current,
            quotes,
            status: completed ? "completed" : "running",
            recommendedVendorId: completed
              ? recommendedVendorId
              : current.recommendedVendorId,
          };
        });
      }, 700 + index * 700);
      inquiryTimersRef.current.push(timer);
    });
  };

  const toggleLocale = () => {
    setLocale((current) => (current === "zh" ? "en" : "zh"));
  };

  return (
    <DemoContext.Provider
      value={{
        locale,
        scenario,
        uploadedDocs,
        unmatchedFiles,
        ocrStatus,
        ocrError,
        parsedDraft,
        uploadedPriceSheet,
        uploadedContactSheet,
        vendorContacts,
        quoteInput,
        quoteOptions,
        selectedQuote,
        inquiryTask,
        rfqAgentPayload,
        recentRecords,
        setLocale,
        toggleLocale,
        setScenarioId: resetStateForScenario,
        refreshRecentRecords,
        ingestFiles,
        clearDocuments,
        loadSamplePriceSheet,
        ingestPriceSheet,
        updatePriceSheetRow,
        loadSampleContactSheet,
        ingestContactSheet,
        updateQuoteInput,
        generateQuotes,
        chooseQuote,
        launchInquiry,
      }}
    >
      {children}
    </DemoContext.Provider>
  );
}

export function useDemo() {
  const value = useContext(DemoContext);
  if (!value) {
    throw new Error("useDemo must be used inside DemoProvider");
  }
  return value;
}

function upsertDocuments(
  current: UploadedDemoDocument[],
  nextDocs: UploadedDemoDocument[],
) {
  const byType = new Map(current.map((item) => [item.type, item]));
  nextDocs.forEach((item) => byType.set(item.type, item));
  return Array.from(byType.values());
}
