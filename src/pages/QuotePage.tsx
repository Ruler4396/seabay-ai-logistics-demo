import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDemo } from "../context/DemoContext";
import { formatUsd } from "../utils/demoEngine";
import { tx } from "../utils/i18n";

function chargeLabel(locale: "zh" | "en", label: string) {
  switch (label) {
    case "Linehaul":
      return tx(locale, "主运费", "Linehaul");
    case "Customs Clearance":
      return tx(locale, "清关", "Customs Clearance");
    case "Final Delivery":
      return tx(locale, "派送", "Final Delivery");
    case "Handling":
      return tx(locale, "操作费", "Handling");
    default:
      return label;
  }
}

function badgeLabel(locale: "zh" | "en", badge: string) {
  switch (badge) {
    case "Best Cost":
      return tx(locale, "成本优先", "Best Cost");
    case "Best Balance":
      return tx(locale, "均衡推荐", "Best Balance");
    case "Fastest":
      return tx(locale, "时效优先", "Fastest");
    default:
      return badge;
  }
}

function modeValue(locale: "zh" | "en", value: string) {
  if (value === "Ocean Freight FCL") {
    return tx(locale, "国际海运整柜", "Ocean Freight FCL");
  }
  if (value === "Air Freight") {
    return tx(locale, "国际空运", "Air Freight");
  }
  if (value === "国际海运整柜") {
    return tx(locale, "国际海运整柜", "Ocean Freight FCL");
  }
  if (value === "国际空运") {
    return tx(locale, "国际空运", "Air Freight");
  }
  return value;
}

export function QuotePage() {
  const navigate = useNavigate();
  const {
    locale,
    uploadedPriceSheet,
    quoteInput,
    quoteOptions,
    selectedQuote,
    updateQuoteInput,
    generateQuotes,
    chooseQuote,
    loadSamplePriceSheet,
    ingestPriceSheet,
  } = useDemo();
  const [isOptionsModalOpen, setOptionsModalOpen] = useState(false);
  const [isDetailModalOpen, setDetailModalOpen] = useState(false);

  useEffect(() => {
    if (!uploadedPriceSheet) {
      loadSamplePriceSheet();
    }
  }, [uploadedPriceSheet, loadSamplePriceSheet]);

  useEffect(() => {
    if (quoteOptions.length) {
      setOptionsModalOpen(true);
      setDetailModalOpen(false);
    }
  }, [quoteOptions.length]);

  const requestRows = [
    {
      labelZh: "起运地",
      labelEn: "Origin",
      value: quoteInput.origin,
      onChange: (value: string) => updateQuoteInput({ origin: value }),
    },
    {
      labelZh: "目的地",
      labelEn: "Destination",
      value: quoteInput.destination,
      onChange: (value: string) => updateQuoteInput({ destination: value }),
    },
    {
      labelZh: "运输方式",
      labelEn: "Mode",
      value: modeValue(locale, quoteInput.mode),
      onChange: (value: string) => updateQuoteInput({ mode: value }),
    },
    {
      labelZh: "箱型 / 计费单位",
      labelEn: "Container / Charge Basis",
      value: quoteInput.container,
      onChange: (value: string) => updateQuoteInput({ container: value }),
    },
    {
      labelZh: "货物",
      labelEn: "Commodity",
      value: quoteInput.commodity,
      onChange: (value: string) => updateQuoteInput({ commodity: value }),
    },
    {
      labelZh: "贸易条款",
      labelEn: "Incoterm",
      value: quoteInput.incoterm,
      onChange: (value: string) => updateQuoteInput({ incoterm: value }),
    },
  ];

  return (
    <div className="stack-lg">
      <section className="panel stack-md quote-portal-shell quote-page-shell">
        <div className="quote-portal-header">
          <h3>{tx(locale, "AI 智能报价", "AI Quote")}</h3>
          <label className="button button--ghost quote-source-button">
            <input
              type="file"
              accept=".csv,text/csv"
              hidden
              onChange={async (event) => {
                if (event.target.files?.length) {
                  await ingestPriceSheet(event.target.files);
                }
                event.currentTarget.value = "";
              }}
            />
            {tx(locale, "导入价格表", "Import Price Sheet")}
          </label>
        </div>

        {uploadedPriceSheet ? (
          <section className="quote-source-strip quote-source-strip--compact">
            <div className="info-chip">{uploadedPriceSheet.fileName}</div>
            <div className="info-chip">{uploadedPriceSheet.updatedAt}</div>
          </section>
        ) : null}

        <article className="quote-request-card quote-request-card--flat quote-request-card--compact">
          {requestRows.map((row) => (
            <label key={row.labelZh} className="quote-request-row">
              <span>{tx(locale, row.labelZh, row.labelEn)}</span>
              <input value={row.value} onChange={(event) => row.onChange(event.target.value)} />
            </label>
          ))}

          <div className="quote-inline-status">
            <div className="info-chip">{quoteInput.packages} CTNS</div>
            <div className="info-chip">{quoteInput.grossWeightKg} KG</div>
            <div className="info-chip">{quoteInput.volumeCbm} CBM</div>
          </div>

          <div className="toggle-row">
            <label className="toggle-card">
              <input
                type="checkbox"
                checked={quoteInput.includeCustoms}
                onChange={(event) => updateQuoteInput({ includeCustoms: event.target.checked })}
              />
              <span>{tx(locale, "含清关", "Include Customs")}</span>
            </label>
            <label className="toggle-card">
              <input
                type="checkbox"
                checked={quoteInput.includeDelivery}
                onChange={(event) => updateQuoteInput({ includeDelivery: event.target.checked })}
              />
              <span>{tx(locale, "含派送", "Include Delivery")}</span>
            </label>
          </div>

          <div className="button-row">
            <button className="button quote-primary-action" onClick={generateQuotes} disabled={!uploadedPriceSheet?.rows.length}>
              {tx(locale, "生成报价", "Generate Quote")}
            </button>
            {quoteOptions.length ? (
              <button className="button button--secondary" onClick={() => setOptionsModalOpen(true)}>
                {tx(locale, "查看方案", "View Options")}
              </button>
            ) : null}
          </div>
        </article>
      </section>

      {isOptionsModalOpen ? (
        <>
          <button className="sidebar-backdrop modal-backdrop" onClick={() => setOptionsModalOpen(false)} />
          <section className="workspace-modal workspace-modal--quote panel">
            <div className="workspace-modal__header">
              <div>
                <h3>{tx(locale, "报价方案", "Quote Options")}</h3>
                <p className="muted">{tx(locale, "先选择一个报价方案。", "Choose one quote option first.")}</p>
              </div>
              <button className="modal-close-button" aria-label={tx(locale, "关闭", "Close")} onClick={() => setOptionsModalOpen(false)}>
                ×
              </button>
            </div>

            {quoteOptions.length ? (
              <div className="workspace-modal__body workspace-modal__body--quote-picker">
                <div className="workspace-modal__scroll quote-options-stack">
                  {quoteOptions.map((option) => (
                    <article
                      key={option.id}
                      className={selectedQuote?.id === option.id ? "quote-portal-card is-selected quote-option-card" : "quote-portal-card quote-option-card"}
                    >
                      <div className="quote-portal-card__top">
                        <div>
                          <span className="quote-badge">{badgeLabel(locale, option.badge)}</span>
                          <h3>{locale === "zh" ? option.label : option.labelEn}</h3>
                        </div>
                        <div className="quote-price">USD {formatUsd(option.totalUsd)}</div>
                      </div>

                      <div className="quote-inline-status">
                        <div className="info-chip">{option.carrier}</div>
                        <div className="info-chip">{option.transitDays} {tx(locale, "天", "days")}</div>
                      </div>

                      <div className="button-row">
                        <button
                          className="button quote-primary-action"
                          onClick={() => {
                            chooseQuote(option.id);
                            setOptionsModalOpen(false);
                            setDetailModalOpen(true);
                          }}
                        >
                          {tx(locale, "查看方案信息", "Open details")}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            ) : (
              <div className="empty-state workspace-modal__empty">
                <h3>{tx(locale, "等待报价", "Waiting")}</h3>
              </div>
            )}
          </section>
        </>
      ) : null}

      {isDetailModalOpen && selectedQuote ? (
        <>
          <button className="sidebar-backdrop modal-backdrop" onClick={() => setDetailModalOpen(false)} />
          <section className="workspace-modal workspace-modal--quote-detail panel">
            <div className="workspace-modal__header">
              <div>
                <h3>{tx(locale, "方案信息", "Quote details")}</h3>
                <p className="muted">{tx(locale, "确认方案信息后转入询价核价。", "Review the details, then continue to RFQ.")}</p>
              </div>
              <button className="modal-close-button" aria-label={tx(locale, "关闭", "Close")} onClick={() => setDetailModalOpen(false)}>
                ×
              </button>
            </div>

            <div className="workspace-modal__body workspace-modal__body--quote-detail">
              <div className="quote-english-card quote-english-card--compact">
                <span className="quote-badge">{badgeLabel(locale, selectedQuote.badge)}</span>
                <strong>{locale === "zh" ? selectedQuote.label : selectedQuote.labelEn}</strong>
                <div className="quote-inline-status">
                  <div className="info-chip">{selectedQuote.carrier}</div>
                  <div className="info-chip">USD {formatUsd(selectedQuote.totalUsd)}</div>
                  <div className="info-chip">{selectedQuote.transitDays} {tx(locale, "天", "days")}</div>
                </div>
                <p>{selectedQuote.summaryEn}</p>
              </div>

              <div className="charge-list quote-charge-list--compact">
                {selectedQuote.breakdown.map((charge) => (
                  <div key={charge.label}>
                    <span>{chargeLabel(locale, charge.label)}</span>
                    <strong>USD {formatUsd(charge.amountUsd)}</strong>
                  </div>
                ))}
              </div>
            </div>

            <div className="workspace-modal__footer quote-modal__footer">
              <button
                className="button button--secondary"
                onClick={() => {
                  setDetailModalOpen(false);
                  setOptionsModalOpen(true);
                }}
              >
                {tx(locale, "返回方案选择", "Back to options")}
              </button>
              <button className="button quote-primary-action" onClick={() => navigate("/procurement")}>
                {tx(locale, "转入询价核价", "Continue to RFQ")}
              </button>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
