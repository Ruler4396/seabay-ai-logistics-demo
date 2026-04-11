import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { OcrHighlight, OcrWarning, Severity } from "../types";
import { useDemo } from "../context/DemoContext";
import { tx } from "../utils/i18n";

const fieldDisplayConfig = [
  { field: "documentNo", zh: "单据号", en: "Document No" },
  { field: "shipper", zh: "发货人", en: "Shipper" },
  { field: "consignee", zh: "收货人", en: "Consignee" },
  { field: "origin", zh: "起运地", en: "Origin" },
  { field: "destination", zh: "目的地", en: "Destination" },
  { field: "commodity", zh: "货物", en: "Commodity" },
  { field: "packages", zh: "箱数", en: "Packages" },
  { field: "grossWeightKg", zh: "毛重", en: "Gross Weight" },
  { field: "volumeCbm", zh: "体积", en: "Volume" },
  { field: "incoterm", zh: "贸易条款", en: "Incoterm" },
  { field: "container", zh: "箱型", en: "Container" },
] as const;

const labelToFieldMap: Record<string, string> = {
  "Document No": "documentNo",
  Shipper: "shipper",
  Consignee: "consignee",
  Origin: "origin",
  Destination: "destination",
  Commodity: "commodity",
  Packages: "packages",
  "Gross Weight": "grossWeightKg",
  Volume: "volumeCbm",
  Incoterm: "incoterm",
};

function formatFieldValue(field: string, value: unknown, locale: "zh" | "en") {
  if (value === "" || value === null || value === undefined || value === 0) {
    return locale === "zh" ? "未识别" : "Not recognized";
  }
  if (field === "packages" && typeof value === "number") {
    return locale === "zh" ? `${value} 箱` : `${value} cartons`;
  }
  if (field === "grossWeightKg" && typeof value === "number") {
    return `${value} KG`;
  }
  if (field === "volumeCbm" && typeof value === "number") {
    return `${value} CBM`;
  }
  return String(value);
}

function dedupeAlerts(alerts: OcrWarning[]) {
  return alerts.filter(
    (alert, index, source) =>
      source.findIndex(
        (item) =>
          item.field === alert.field &&
          item.severity === alert.severity &&
          item.reasonCode === alert.reasonCode &&
          item.detail === alert.detail,
      ) === index,
  );
}

function fieldLabel(field: string, locale: "zh" | "en") {
  const config = fieldDisplayConfig.find((item) => item.field === field);
  if (!config) {
    return field;
  }
  return tx(locale, config.zh, config.en);
}

function describeAlert(alert: OcrWarning, locale: "zh" | "en") {
  const label = fieldLabel(alert.field, locale);
  switch (alert.reasonCode) {
    case "package-mismatch":
      return {
        message: tx(locale, "箱数冲突", "Package count mismatch"),
        detail: tx(locale, "发票与装箱单的箱数不一致，需先人工核对后再录入。", "Invoice and packing list carton counts do not match and should be checked manually."),
      };
    case "missing-bl":
      return {
        message: tx(locale, "提单草稿缺失", "Draft B/L missing"),
        detail: tx(locale, "当前仍可生成订单草稿，但录入 TMS 前应补齐提单信息。", "A draft can still be created, but B/L details should be confirmed before TMS entry."),
      };
    case "missing_key_field":
      return {
        message: tx(locale, `${label}缺失`, `${label} missing`),
        detail: tx(locale, `OCR 未可靠识别 ${label}。`, `OCR could not confidently extract ${label}.`),
      };
    case "semantic_mismatch":
      return {
        message: tx(locale, `${label}识别疑似错位`, `${label} may be wrong`),
        detail: tx(locale, `${label}内容疑似混入其他字段语义，需人工复核。`, `${label} contains text from another field and should be reviewed.`),
      };
    case "fallback_inferred":
      return {
        message: tx(locale, `${label}需要复核`, `${label} requires review`),
        detail: tx(locale, `${label}由 fallback 逻辑补全，不能直接当作可靠录入结果。`, `${label} was inferred by fallback logic and should be verified.`),
      };
    case "low_confidence":
      return {
        message: tx(locale, `${label}置信度偏低`, `${label} low confidence`),
        detail: tx(locale, `${label}可能受模糊、遮挡或污损影响。`, `${label} may be affected by blur, occlusion, or damage.`),
      };
    case "low_confidence_key_field":
      return {
        message: tx(locale, `${label}疑似污损`, `${label} may be damaged`),
        detail: tx(locale, `${label}是关键字段，当前置信度不足，建议人工确认。`, `${label} is a key field with low confidence and should be reviewed.`),
      };
    case "ocr_low_confidence":
      return {
        message: tx(locale, "整页 OCR 质量偏低", "OCR confidence is low"),
        detail: tx(locale, "整页识别质量偏低，建议更换更清晰的 PDF 或重新拍照。", "Overall OCR confidence is low. Use a clearer PDF or capture again."),
      };
    default:
      if (alert.reasonCode.endsWith("-missing")) {
        return {
          message: tx(locale, `${label}缺失`, `${label} missing`),
          detail: tx(locale, `${label}当前未被可靠识别，建议人工补录。`, `${label} was not reliably extracted and should be checked manually.`),
        };
      }
      if (alert.message.endsWith("needs review")) {
        return {
          message: tx(locale, `${label}需要复核`, `${label} requires review`),
          detail: tx(locale, `${label}识别结果存在不确定性，请人工确认。`, `${label} contains uncertain OCR output and should be reviewed.`),
        };
      }
      return {
        message: alert.message,
        detail: alert.detail,
      };
  }
}

function severityIcon(severity: Severity) {
  if (severity === "critical") {
    return "!";
  }
  if (severity === "warning") {
    return "!";
  }
  return "·";
}

export function IntakePage() {
  const navigate = useNavigate();
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const {
    locale,
    uploadedDocs,
    ocrStatus,
    ocrError,
    parsedDraft,
    ingestFiles,
    clearDocuments,
  } = useDemo();
  const [isOcrModalOpen, setOcrModalOpen] = useState(false);

  const activeDoc = uploadedDocs[0] ?? null;

  useEffect(() => {
    if (activeDoc) {
      setOcrModalOpen(true);
    }
  }, [activeDoc?.id]);

  const keyRiskAlerts = useMemo(
    () => dedupeAlerts(activeDoc?.riskAlerts ?? []),
    [activeDoc],
  );

  const ocrQualityWarnings = useMemo(
    () => dedupeAlerts(activeDoc?.ocrWarnings ?? []),
    [activeDoc],
  );

  const secondaryIssues = useMemo(() => {
    const draftIssues = (parsedDraft?.issues ?? []).map((issue) => ({
      field: issue.field,
      severity: issue.severity,
      message: issue.message,
      detail: issue.detail,
      reasonCode: issue.id,
      isKeyField: false,
    }));
    return dedupeAlerts([...draftIssues, ...ocrQualityWarnings]);
  }, [ocrQualityWarnings, parsedDraft]);

  const fieldCards = useMemo(() => {
    if (!activeDoc) {
      return [];
    }

    const extracted = activeDoc.extracted as Record<string, unknown>;
    const highlightMap = new Map<string, OcrHighlight>();
    activeDoc.extracted.highlights.forEach((item) => {
      const field = labelToFieldMap[item.label];
      if (field && !highlightMap.has(field)) {
        highlightMap.set(field, item);
      }
    });

    const riskMap = new Map<string, OcrWarning>();
    keyRiskAlerts.forEach((item) => {
      const current = riskMap.get(item.field);
      const currentRank = current?.severity === "critical" ? 2 : current?.severity === "warning" ? 1 : 0;
      const nextRank = item.severity === "critical" ? 2 : item.severity === "warning" ? 1 : 0;
      if (!current || nextRank > currentRank) {
        riskMap.set(item.field, item);
      }
    });

    return fieldDisplayConfig
      .map((config) => {
        const highlight = highlightMap.get(config.field);
        const risk = riskMap.get(config.field);
        const rawValue = extracted[config.field];
        const value = formatFieldValue(config.field, rawValue, locale);
        const shouldRender =
          value !== (locale === "zh" ? "未识别" : "Not recognized") || Boolean(risk) || Boolean(highlight);
        if (!shouldRender) {
          return null;
        }
        const severity: Severity = risk?.severity ?? highlight?.severity ?? "info";
        const localizedRisk = risk ? describeAlert(risk, locale) : null;
        return {
          field: config.field,
          label: tx(locale, config.zh, config.en),
          value,
          severity,
          confidence: highlight?.confidence,
          detail: localizedRisk?.detail ?? "",
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
  }, [activeDoc, keyRiskAlerts, locale]);

  const criticalRiskCount = keyRiskAlerts.filter((item) => item.severity === "critical").length;
  const warningRiskCount = keyRiskAlerts.filter((item) => item.severity === "warning").length;
  const hasReviewRisk = keyRiskAlerts.length > 0 || secondaryIssues.some((item) => item.severity !== "info");

  return (
    <div className="stack-lg">
      <section className="panel intake-entry">
        <div className="panel__header">
          <h3>{tx(locale, "导入单据", "Import Document")}</h3>
        </div>

        <div className="intake-entry__actions">
          <button
            className="launch-card launch-card--camera"
            onClick={() => cameraInputRef.current?.click()}
          >
            <strong>{tx(locale, "拍照录单", "Capture")}</strong>
          </button>

          <button
            className="launch-card"
            onClick={() => uploadInputRef.current?.click()}
          >
            <strong>{tx(locale, "导入图片 / PDF", "Import Image / PDF")}</strong>
          </button>

          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={async (event) => {
              if (event.target.files?.length) {
                await ingestFiles(event.target.files);
              }
              event.currentTarget.value = "";
            }}
          />
          <input
            ref={uploadInputRef}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
            hidden
            onChange={async (event) => {
              if (event.target.files?.length) {
                await ingestFiles(event.target.files);
              }
              event.currentTarget.value = "";
            }}
          />
        </div>

        {ocrStatus === "running" && (
          <div className="ocr-running">
            <div className="ocr-running__bar" />
            <span>{tx(locale, "OCR 识别中", "OCR running")}</span>
          </div>
        )}

        {ocrError && (
          <div className="alert alert--critical">
            <strong>{tx(locale, "OCR 调用失败", "OCR request failed")}</strong>
            <span>{ocrError}</span>
          </div>
        )}
      </section>

      <section className="panel stack-md">
        <div className="panel__header">
          <h3>{tx(locale, "订单结果", "Shipment Result")}</h3>
        </div>

        {parsedDraft ? (
          <>
            <div className={`risk-summary-strip${criticalRiskCount ? " is-critical" : hasReviewRisk ? " is-warning" : ""}`}>
              <div className="risk-summary-strip__row">
                <span className={`risk-summary-strip__icon${criticalRiskCount ? " is-critical" : hasReviewRisk ? " is-warning" : ""}`}>
                  {criticalRiskCount ? "!" : hasReviewRisk ? "▲" : "✓"}
                </span>
                <div className="stack-sm">
                  <strong>
                    {criticalRiskCount
                      ? tx(locale, "关键字段需要人工复核", "Critical fields require review")
                      : hasReviewRisk
                        ? tx(locale, "识别已完成，建议复核", "Recognition completed, review advised")
                        : tx(locale, "识别完成，可继续报价", "Recognition completed, ready for quote")}
                  </strong>
                  <span className="muted">
                    {criticalRiskCount
                      ? tx(locale, "高风险字段可能影响订舱、合规或录入准确性。", "High-risk fields may affect booking, compliance, or TMS accuracy.")
                      : hasReviewRisk
                        ? tx(locale, "已生成订单草稿，但仍有字段需要确认。", "Draft is ready, but some fields still need confirmation.")
                        : tx(locale, "未发现影响流程的关键字段风险。", "No key-field risks detected.")}
                  </span>
                </div>

                <div className="risk-summary-strip__stats">
                  {criticalRiskCount > 0 && (
                    <span className="status-pill status-pill--blocked">
                      {tx(locale, `${criticalRiskCount} 个高风险`, `${criticalRiskCount} critical`)}
                    </span>
                  )}
                  {warningRiskCount > 0 && (
                    <span className="status-pill status-pill--review">
                      {tx(locale, `${warningRiskCount} 个待确认`, `${warningRiskCount} warning`)}
                    </span>
                  )}
                  <span className={hasReviewRisk ? "status-pill status-pill--review" : "status-pill status-pill--ready"}>
                    {hasReviewRisk ? tx(locale, "需人工复核", "Manual review") : tx(locale, "可继续", "Ready")}
                  </span>
                </div>
              </div>
            </div>

            {keyRiskAlerts.length > 0 && (
              <div className="issue-list">
                {keyRiskAlerts.map((issue, index) => (
                  <div key={`${issue.field}-${issue.reasonCode}-${index}`} className={`alert alert--${issue.severity}`}>
                    <span className="alert__icon" aria-hidden="true">{severityIcon(issue.severity)}</span>
                    <div className="alert__content">
                      <strong>{describeAlert(issue, locale).message}</strong>
                      <span>{describeAlert(issue, locale).detail}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {secondaryIssues.length > 0 && (
              <div className="issue-list">
                {secondaryIssues.map((issue, index) => (
                  <div key={`${issue.field}-${issue.reasonCode}-${index}`} className={`alert alert--${issue.severity}`}>
                    <span className="alert__icon" aria-hidden="true">{severityIcon(issue.severity)}</span>
                    <div className="alert__content">
                      <strong>{describeAlert(issue, locale).message}</strong>
                      <span>{describeAlert(issue, locale).detail}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="field-grid">
              <div className="field-card">
                <span>{tx(locale, "客户 / 发货人", "Customer / Shipper")}</span>
                <strong>{parsedDraft.customer} / {parsedDraft.shipper}</strong>
              </div>
              <div className="field-card">
                <span>{tx(locale, "收货人", "Consignee")}</span>
                <strong>{parsedDraft.consignee}</strong>
              </div>
              <div className="field-card">
                <span>{tx(locale, "线路", "Lane")}</span>
                <strong>{parsedDraft.origin} {"->"} {parsedDraft.destination}</strong>
              </div>
              <div className="field-card">
                <span>{tx(locale, "模式 / 箱型", "Mode / Container")}</span>
                <strong>{parsedDraft.mode} / {parsedDraft.container}</strong>
              </div>
              <div className="field-card">
                <span>{tx(locale, "货物", "Commodity")}</span>
                <strong>{parsedDraft.commodity}</strong>
              </div>
              <div className="field-card">
                <span>{tx(locale, "件毛体", "Packages / GW / CBM")}</span>
                <strong>
                  {parsedDraft.packages} / {parsedDraft.grossWeightKg} KG / {parsedDraft.volumeCbm} CBM
                </strong>
              </div>
            </div>

            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{tx(locale, "SKU", "SKU")}</th>
                    <th>{tx(locale, "描述", "Description")}</th>
                    <th>{tx(locale, "数量", "Qty")}</th>
                    <th>{tx(locale, "箱数", "Cartons")}</th>
                    <th>{tx(locale, "金额", "Amount")}</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedDraft.lineItems.length ? (
                    parsedDraft.lineItems.map((item) => (
                      <tr key={`draft-${item.sku}`}>
                        <td>{item.sku}</td>
                        <td>{item.description}</td>
                        <td>{item.qty} {item.unit ?? ""}</td>
                        <td>{item.cartons ?? "-"}</td>
                        <td>{item.amountUsd ? `USD ${item.amountUsd.toLocaleString("en-US")}` : "-"}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="muted">
                        {tx(locale, "当前未识别出货品明细。", "No line items recognized yet.")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="button-row">
              <button className="button" onClick={() => setOcrModalOpen(true)}>
                {tx(locale, "查看 OCR 结果", "View OCR Result")}
              </button>
              <button className="button button--secondary" onClick={() => navigate("/quote")}>
                {tx(locale, "继续到报价", "Continue to Quote")}
              </button>
              <span className={hasReviewRisk ? "status-pill status-pill--review" : "status-pill status-pill--ready"}>
                {hasReviewRisk ? tx(locale, "需人工复核", "Manual review") : tx(locale, "可继续", "Ready")}
              </span>
              <button className="button button--ghost" onClick={clearDocuments}>
                {tx(locale, "重新导入", "Import Again")}
              </button>
            </div>
          </>
        ) : (
          <div className="empty-state intake-empty">
            <h3>{tx(locale, "等待导入", "Waiting")}</h3>
          </div>
        )}
      </section>

      {activeDoc && isOcrModalOpen && (
        <>
          <button className="sidebar-backdrop modal-backdrop" onClick={() => setOcrModalOpen(false)} />
          <section className="ocr-modal panel">
            <div className="ocr-modal__header">
              <div className="stack-sm">
                <h3>{locale === "zh" ? activeDoc.labelZh : activeDoc.labelEn}</h3>
                <span className={keyRiskAlerts.length ? "status-pill status-pill--review" : "status-pill status-pill--ready"}>
                  {keyRiskAlerts.length ? tx(locale, "关键字段待确认", "Key fields under review") : tx(locale, "识别正常", "Recognition ready")}
                </span>
              </div>
              <button className="button button--ghost" onClick={() => setOcrModalOpen(false)}>
                {tx(locale, "关闭", "Close")}
              </button>
            </div>

            <div className="ocr-modal__body">
              <div className="ocr-canvas">
                <img src={activeDoc.previewUrl} alt={activeDoc.labelEn} />
                {(activeDoc.ocrRegions ?? []).map((region, index) =>
                  activeDoc.previewWidth && activeDoc.previewHeight ? (
                    <div
                      key={`${activeDoc.id}-${index}-${region.text}`}
                      className={region.confidence < 0.8 ? "ocr-box ocr-box--low" : "ocr-box"}
                      title={region.text}
                      style={{
                        left: `${(region.bbox.left / activeDoc.previewWidth) * 100}%`,
                        top: `${(region.bbox.top / activeDoc.previewHeight) * 100}%`,
                        width: `${(region.bbox.width / activeDoc.previewWidth) * 100}%`,
                        height: `${(region.bbox.height / activeDoc.previewHeight) * 100}%`,
                      }}
                    />
                  ) : null,
                )}
              </div>

              <div className="stack-md">
                <div className="ocr-section">
                  <div className="ocr-section__header">
                    <strong>{tx(locale, "关键字段", "Key Fields")}</strong>
                  </div>
                  <div className="field-grid">
                    {fieldCards.map((item) => (
                      <div key={item.field} className={`field-card field-card--${item.severity}`}>
                        <span>{item.label}</span>
                        <strong>{item.value}</strong>
                        {typeof item.confidence === "number" ? (
                          <small>{Math.round(item.confidence * 100)}%</small>
                        ) : (
                          <small>{tx(locale, "需人工确认", "Manual review")}</small>
                        )}
                        {item.detail ? <small>{item.detail}</small> : null}
                      </div>
                    ))}
                  </div>
                </div>

                {ocrQualityWarnings.length > 0 && (
                  <div className="ocr-section">
                    <div className="ocr-section__header">
                      <strong>{tx(locale, "OCR 质量问题", "OCR Quality Warnings")}</strong>
                    </div>
                    <div className="issue-list">
                      {ocrQualityWarnings.map((item, index) => (
                        <div
                          key={`${activeDoc.id}-${item.reasonCode}-${index}`}
                          className={`alert alert--${item.severity}`}
                        >
                          <span className="alert__icon" aria-hidden="true">{severityIcon(item.severity)}</span>
                          <div className="alert__content">
                            <strong>{describeAlert(item, locale).message}</strong>
                            <span>{describeAlert(item, locale).detail}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
