import { useEffect } from "react";
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

  useEffect(() => {
    if (!uploadedPriceSheet) {
      loadSamplePriceSheet();
    }
  }, [uploadedPriceSheet, loadSamplePriceSheet]);

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
      <section className="panel stack-md quote-portal-shell">
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
            <div className="info-chip">
              {uploadedPriceSheet.rows.length} {tx(locale, "条价格规则", "pricing rules")}
            </div>
          </section>
        ) : null}

        <article className="quote-request-card quote-request-card--flat">
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
          </div>
        </article>
      </section>

      <section className="panel stack-md">
        <div className="panel__header">
          <h3>{tx(locale, "报价方案", "Quote Options")}</h3>
        </div>

        {quoteOptions.length ? (
          <div className="quote-portal-results">
            {quoteOptions.map((option) => (
              <article
                key={option.id}
                className={selectedQuote?.id === option.id ? "quote-portal-card is-selected" : "quote-portal-card"}
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

                <div className="charge-list quote-charge-list--compact">
                  {option.breakdown.map((charge) => (
                    <div key={charge.label}>
                      <span>{chargeLabel(locale, charge.label)}</span>
                      <strong>USD {formatUsd(charge.amountUsd)}</strong>
                    </div>
                  ))}
                </div>

                <div className="button-row">
                  <button className="button button--secondary" onClick={() => chooseQuote(option.id)}>
                    {selectedQuote?.id === option.id
                      ? tx(locale, "当前方案", "Selected")
                      : tx(locale, "选用", "Use")}
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <h3>{tx(locale, "等待报价", "Waiting")}</h3>
          </div>
        )}
      </section>

      {selectedQuote ? (
        <section className="panel stack-md">
          <div className="panel__header">
            <h3>{tx(locale, "英文报价输出", "English Quote Output")}</h3>
          </div>

          <article className="quote-english-card">
            <p>{selectedQuote.summaryEn}</p>
          </article>

          <div className="button-row">
            <button className="button" onClick={() => navigate("/procurement")}>
              {tx(locale, "转入询价核价", "Continue to RFQ")}
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
