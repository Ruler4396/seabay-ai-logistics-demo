import { useEffect, useState } from "react";
import { useDemo } from "../context/DemoContext";
import { formatUsd } from "../utils/demoEngine";
import { tx } from "../utils/i18n";
import { defaultRfqAgentAdapter, serializeRfqAgentPayload } from "../utils/rfqAgent";

interface LiveReplyParsed {
  totalUsd: number | null;
  transitDays: number | null;
  freeDays: number | null;
  validity: string;
}

interface LiveRfqTask {
  taskId: string;
  targetUser: string;
  status: "sent" | "replied";
  createdAt: string;
  repliedAt?: string | null;
  outboundMessage: string;
  replyRaw?: string | null;
  replyParsed?: LiveReplyParsed | null;
}

function taskStatusLabel(locale: "zh" | "en", status: string) {
  switch (status) {
    case "queued":
      return tx(locale, "待发送", "Queued");
    case "sending":
      return tx(locale, "触达中", "Sending");
    case "received":
      return tx(locale, "已回传", "Received");
    case "sent":
      return tx(locale, "已发送", "Sent");
    case "replied":
      return tx(locale, "已回传", "Replied");
    default:
      return tx(locale, "未启动", "Idle");
  }
}

export function ProcurementPage() {
  const {
    locale,
    scenario,
    uploadedPriceSheet,
    quoteInput,
    selectedQuote,
    quoteOptions,
    uploadedContactSheet,
    vendorContacts,
    rfqAgentPayload,
    loadSamplePriceSheet,
    ingestContactSheet,
    generateQuotes,
  } = useDemo();
  const [liveTask, setLiveTask] = useState<LiveRfqTask | null>(null);
  const [liveError, setLiveError] = useState<string>("");
  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    if (!uploadedPriceSheet) {
      loadSamplePriceSheet();
    }
  }, [uploadedPriceSheet, loadSamplePriceSheet]);

  useEffect(() => {
    if (uploadedPriceSheet?.matched && !quoteOptions.length) {
      generateQuotes();
    }
  }, [uploadedPriceSheet, quoteOptions.length, generateQuotes]);

  useEffect(() => {
    if (!liveTask?.taskId || liveTask.status === "replied") {
      return undefined;
    }

    const timer = window.setInterval(async () => {
      const response = await fetch(
        `/seabay-ai-logistics-demo/api/rfq-live/task?task_id=${encodeURIComponent(liveTask.taskId)}`,
      );
      if (!response.ok) {
        return;
      }
      const payload = await response.json();
      if (payload.task) {
        setLiveTask(payload.task);
      }
    }, 3000);

    return () => window.clearInterval(timer);
  }, [liveTask?.taskId, liveTask?.status]);

  const benchmarkQuote =
    selectedQuote ??
    quoteOptions.find((option) => option.badge === "Best Balance") ??
    quoteOptions[0] ??
    null;
  const contactSheetAsset =
    scenario.id === "seabay-air-fra"
      ? `${import.meta.env.BASE_URL}demo-assets/eu-air-rfq-contact-book-apr-2026.csv`
      : `${import.meta.env.BASE_URL}demo-assets/uswc-rfq-contact-book-apr-2026.csv`;
  const contactChannels = Array.from(new Set(vendorContacts.map((item) => item.channel)));
  const robotSteps = [
    {
      id: "contacts",
      label: tx(locale, "联系人已载入", "Contacts Loaded"),
      active: Boolean(uploadedContactSheet?.matched && vendorContacts.length),
    },
    {
      id: "dispatch",
      label: tx(locale, "已发企业微信", "WeCom Sent"),
      active: Boolean(liveTask),
    },
    {
      id: "replies",
      label: tx(locale, "手机回传", "Phone Reply"),
      active: liveTask?.status === "replied",
    },
    {
      id: "normalize",
      label: tx(locale, "结果解析", "Parsed"),
      active: Boolean(liveTask?.replyParsed),
    },
  ];

  const contactBoard = vendorContacts.map((contact, index) => ({
    ...contact,
    stage:
      index === 0
        ? liveTask?.status === "replied"
          ? "received"
          : liveTask
            ? "sending"
            : "queued"
        : "queued",
  }));

  async function launchLiveRfq() {
    if (!uploadedContactSheet?.matched || !vendorContacts.length) {
      return;
    }
    setIsSending(true);
    setLiveError("");
    try {
      const response = await fetch("/seabay-ai-logistics-demo/api/rfq-live/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          scenarioId: scenario.id,
          origin: quoteInput.origin,
          destination: quoteInput.destination,
          commodity: quoteInput.commodity,
          mode: quoteInput.mode,
          container: quoteInput.container,
          packages: quoteInput.packages,
          grossWeightKg: quoteInput.grossWeightKg,
          volumeCbm: quoteInput.volumeCbm,
          incoterm: quoteInput.incoterm,
          includeCustoms: quoteInput.includeCustoms,
          includeDelivery: quoteInput.includeDelivery,
          benchmarkQuoteUsd: benchmarkQuote?.totalUsd ?? null,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "rfq send failed");
      }
      setLiveTask(payload);
    } catch (error) {
      setLiveError(error instanceof Error ? error.message : "rfq send failed");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div className="stack-lg">
      <section className="panel stack-md procurement-shell">
        <div className="quote-portal-header">
          <h3>{tx(locale, "智能询价", "RFQ Automation")}</h3>
          <label className="button button--ghost quote-source-button">
            <input
              type="file"
              accept=".csv,text/csv"
              hidden
              onChange={(event) => {
                if (event.target.files?.length) {
                  void ingestContactSheet(event.target.files);
                }
                event.currentTarget.value = "";
              }}
            />
            {tx(locale, "导入联系人表", "Import Contact Sheet")}
          </label>
        </div>

        <div className="quote-inline-status">
          {uploadedContactSheet ? <div className="info-chip">{uploadedContactSheet.fileName}</div> : null}
          {uploadedContactSheet ? <div className="info-chip">{uploadedContactSheet.contactCount} {tx(locale, "个联系人", "contacts")}</div> : null}
          <a className="inline-link" href={contactSheetAsset} target="_blank" rel="noreferrer">
            {tx(locale, "下载联系人表", "Download contact sheet")}
          </a>
        </div>

        <article className="quote-request-card quote-request-card--flat procurement-console-card">
          <div className="quote-request-row">
            <span>{tx(locale, "询价线路", "Lane")}</span>
            <strong>{quoteInput.origin} → {quoteInput.destination}</strong>
          </div>
          <div className="quote-request-row">
            <span>{tx(locale, "货物", "Cargo")}</span>
            <strong>{quoteInput.commodity}</strong>
          </div>
          <div className="quote-request-row">
            <span>{tx(locale, "基准价", "Benchmark")}</span>
            <strong>{benchmarkQuote ? `USD ${formatUsd(benchmarkQuote.totalUsd)}` : "--"}</strong>
          </div>
          <div className="quote-request-row">
            <span>{tx(locale, "触达渠道", "Channels")}</span>
            <strong>{contactChannels.length ? contactChannels.join(" / ") : "--"}</strong>
          </div>
          <div className="quote-request-row">
            <span>{tx(locale, "任务状态", "Status")}</span>
            <strong>{taskStatusLabel(locale, liveTask?.status ?? "idle")}</strong>
          </div>
          <div className="quote-request-row">
            <span>{tx(locale, "目标账号", "Target")}</span>
            <strong>{liveTask?.targetUser || "PRIMARY_USER_ID"}</strong>
          </div>

          <div className="rfq-runbook rfq-runbook--compact">
            {robotSteps.map((step) => (
              <div key={step.id} className={step.active ? "rfq-step is-active" : "rfq-step"}>
                <strong>{step.label}</strong>
              </div>
            ))}
          </div>

          {liveError ? <div className="table-note">{liveError}</div> : null}

          <div className="button-row">
            <button
              className="button quote-primary-action"
              onClick={launchLiveRfq}
              disabled={!uploadedContactSheet?.matched || !vendorContacts.length || isSending}
            >
              {isSending
                ? tx(locale, "发送中", "Sending")
                : liveTask
                  ? tx(locale, "重新发送到手机", "Send Again")
                  : tx(locale, "发送企业微信询价", "Send WeCom RFQ")}
            </button>
          </div>
        </article>
      </section>

      <section className="panel stack-md">
        <div className="panel__header">
          <h3>{tx(locale, "联系人池", "Contact Pool")}</h3>
        </div>

        {contactBoard.length ? (
          <div className="procurement-card-list">
            {contactBoard.map((item) => (
              <article key={item.vendorId} className="procurement-contact-card procurement-contact-card--agent">
                <div className="quote-portal-card__top">
                  <div>
                    <strong>{item.vendorName}</strong>
                    <div className="table-note">{item.contactName} · {item.organizationType}</div>
                  </div>
                  <span className={`status-pill status-pill--${item.stage}`}>
                    {taskStatusLabel(locale, item.stage)}
                  </span>
                </div>

                <div className="quote-inline-status">
                  <div className="info-chip">{item.channel}</div>
                  <div className="info-chip">{item.contactValue}</div>
                </div>

                <div className="table-note">{item.laneStrength}</div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <h3>{tx(locale, "等待导入联系人表", "Waiting")}</h3>
          </div>
        )}
      </section>

      <section className="panel stack-md">
        <div className="panel__header">
          <h3>{tx(locale, "手机回传", "Phone Reply")}</h3>
        </div>

        {liveTask ? (
          <div className="stack-md">
            <article className="procurement-live-card">
              <div className="quote-request-row">
                <span>{tx(locale, "发送时间", "Sent At")}</span>
                <strong>{liveTask.createdAt}</strong>
              </div>
              <div className="quote-request-row">
                <span>{tx(locale, "回复时间", "Reply At")}</span>
                <strong>{liveTask.repliedAt || "--"}</strong>
              </div>
              <div className="live-message">
                <span>{tx(locale, "发送内容", "Outbound")}</span>
                <pre>{liveTask.outboundMessage}</pre>
              </div>
            </article>

            {liveTask.replyRaw ? (
              <>
                <article className="procurement-live-card">
                  <div className="live-message">
                    <span>{tx(locale, "手机回复原文", "Inbound Reply")}</span>
                    <pre>{liveTask.replyRaw}</pre>
                  </div>
                </article>

                <article className="procurement-live-card">
                  <div className="live-reply-grid">
                    <div className="quote-request-row">
                      <span>{tx(locale, "总价", "Total")}</span>
                      <strong>
                        {liveTask.replyParsed?.totalUsd != null
                          ? `USD ${formatUsd(liveTask.replyParsed.totalUsd)}`
                          : "--"}
                      </strong>
                    </div>
                    <div className="quote-request-row">
                      <span>{tx(locale, "时效", "Transit")}</span>
                      <strong>
                        {liveTask.replyParsed?.transitDays != null
                          ? `${liveTask.replyParsed.transitDays} ${tx(locale, "天", "days")}`
                          : "--"}
                      </strong>
                    </div>
                    <div className="quote-request-row">
                      <span>{tx(locale, "免柜/免堆", "Free Days")}</span>
                      <strong>
                        {liveTask.replyParsed?.freeDays != null
                          ? `${liveTask.replyParsed.freeDays} ${tx(locale, "天", "days")}`
                          : "--"}
                      </strong>
                    </div>
                    <div className="quote-request-row">
                      <span>{tx(locale, "有效期", "Validity")}</span>
                      <strong>{liveTask.replyParsed?.validity || "--"}</strong>
                    </div>
                  </div>
                </article>
              </>
            ) : (
              <div className="empty-state">
                <h3>{tx(locale, "已发送到企业微信，等待你在手机回复。", "Sent to WeCom. Waiting for your phone reply.")}</h3>
              </div>
            )}
          </div>
        ) : (
          <div className="empty-state">
            <h3>{tx(locale, "启动后会把询价话术发到你的企业微信。", "Launch to send the RFQ message to your WeCom.")}</h3>
          </div>
        )}
      </section>

      <section className="panel stack-md">
        <div className="panel__header">
          <h3>ZeroClaw Adapter</h3>
        </div>
        <div className="summary-list">
          <div>
            <span>Provider</span>
            <strong>{defaultRfqAgentAdapter.provider}</strong>
          </div>
          <div>
            <span>Endpoint</span>
            <strong>{defaultRfqAgentAdapter.endpoint}</strong>
          </div>
          <div>
            <span>Model</span>
            <strong>{defaultRfqAgentAdapter.model}</strong>
          </div>
        </div>
        {liveTask ? (
          <textarea
            className="payload-preview"
            value={serializeRfqAgentPayload(
              rfqAgentPayload ?? {
                lane: `${quoteInput.origin} -> ${quoteInput.destination}`,
                cargo: quoteInput.commodity,
                benchmarkQuoteUsd: benchmarkQuote?.totalUsd ?? 0,
                requirements: {
                  mode: quoteInput.mode,
                  incoterm: quoteInput.incoterm,
                  container: quoteInput.container,
                },
                targetContacts: vendorContacts.slice(0, 1).map((item) => ({
                  vendorName: item.vendorName,
                  contactName: item.contactName,
                  channel: item.channel,
                  contactValue: item.contactValue,
                })),
              },
            )}
            readOnly
          />
        ) : (
          <div className="table-note">
            {tx(locale, "启动后会生成可直接转给 ZeroClaw 的最小 payload。", "Payload will appear after launch for ZeroClaw wiring.")}
          </div>
        )}
      </section>
    </div>
  );
}
