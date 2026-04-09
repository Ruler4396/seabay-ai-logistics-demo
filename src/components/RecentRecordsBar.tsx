import { useDemo } from "../context/DemoContext";
import { tx } from "../utils/i18n";

function recordTypeLabel(locale: "zh" | "en", recordType: string) {
  switch (recordType) {
    case "ocr_document":
      return tx(locale, "单据", "Document");
    case "price_sheet":
      return tx(locale, "价格表", "Rate Sheet");
    case "contact_sheet":
      return tx(locale, "联系人", "Contacts");
    default:
      return recordType;
  }
}

function pageLabel(locale: "zh" | "en", page: string) {
  switch (page) {
    case "intake":
      return tx(locale, "录单", "Intake");
    case "quote":
      return tx(locale, "报价", "Quote");
    case "procurement":
      return tx(locale, "询价", "RFQ");
    default:
      return page;
  }
}

export function RecentRecordsBar() {
  const { locale, recentRecords } = useDemo();

  return (
    <section className="recent-records">
      <div className="recent-records__header">
        <strong>{tx(locale, "最近记录", "Recent Records")}</strong>
      </div>

      {recentRecords.length ? (
        <div className="recent-records__list">
          {recentRecords.map((record) => (
            <article key={record.id} className="recent-record">
              <div className="recent-record__meta">
                <span>{pageLabel(locale, record.page)}</span>
                <span>{recordTypeLabel(locale, record.recordType)}</span>
                <span>{record.source === "sample" ? tx(locale, "样例", "Sample") : tx(locale, "上传", "Upload")}</span>
              </div>
              <strong>{record.fileName}</strong>
              <small>{record.summary}</small>
              <small>{record.createdAt}</small>
            </article>
          ))}
        </div>
      ) : (
        <div className="recent-records__empty">{tx(locale, "暂无记录", "No records")}</div>
      )}
    </section>
  );
}
