import {
  PRIVACY_BLOCKS,
  REFUND_NOTES,
  REFUND_POLICIES,
  TERMS_SECTIONS,
} from "../data/faq-content";

const ARTICLE =
  "bg-card border border-border rounded-lg p-6 sm:p-8 shadow-sm max-w-4xl space-y-5";

export function TermsSection() {
  return (
    <article className={ARTICLE}>
      <h2 className="text-[18px] font-bold text-foreground">
        Điều khoản sử dụng
      </h2>
      <div className="space-y-4 text-[13.5px] leading-relaxed">
        {TERMS_SECTIONS.map((section) => (
          <section key={section.title} className="space-y-1.5">
            <h3 className="font-bold text-[14.5px] text-foreground">
              {section.title}
            </h3>
            <p className="text-muted-foreground">{section.body}</p>
          </section>
        ))}
      </div>
    </article>
  );
}

export function PrivacySection() {
  return (
    <article className={ARTICLE}>
      <h2 className="text-[18px] font-bold text-foreground">
        Chính sách bảo mật
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-[13px]">
        {PRIVACY_BLOCKS.map((block) => (
          <div
            key={block.title}
            className="p-4 rounded-md bg-muted border border-border space-y-1.5"
          >
            <h3 className="font-bold text-foreground">{block.title}</h3>
            <p className="text-muted-foreground leading-relaxed">
              {block.body}
            </p>
          </div>
        ))}
      </div>
    </article>
  );
}

export function RefundSection() {
  return (
    <article className={ARTICLE}>
      <h2 className="text-[18px] font-bold text-foreground">
        Chính sách hoàn vé
      </h2>
      <ul className="list-disc pl-5 space-y-1 text-[13.5px] text-muted-foreground">
        {REFUND_NOTES.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {REFUND_POLICIES.map((policy) => (
          <section
            key={policy.name}
            className="border border-border rounded-md overflow-hidden"
          >
            <h3 className="bg-muted px-4 py-2.5 text-[14px] font-bold text-foreground">
              {policy.name}
            </h3>
            <ul className="divide-y divide-border text-[13px]">
              {policy.rows.map((row) => (
                <li key={row.when} className="px-4 py-3 space-y-0.5">
                  <p className="text-muted-foreground">{row.when}</p>
                  <p className="font-bold text-foreground">{row.result}</p>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </article>
  );
}
