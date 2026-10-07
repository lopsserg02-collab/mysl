import type { Metadata } from "next";
import { t } from "@/lib/copy";
import { LegalDraft } from "@/components/landing/LegalDraft";

export const metadata: Metadata = {
  title: `${t.legal.terms} (${t.legal.draft.toLowerCase()})`,
  robots: { index: false, follow: true },
};

export default function TermsPage() {
  return (
    <LegalDraft title={t.legal.terms}>
      <p>Здесь будут правила пользования Мыслью: кто может пользоваться сервисом, что можно и нельзя размещать на досках, как устроены платные тарифы, продление и отмена подписки, возвраты, и как с нами связаться.</p>
      <p>Текст напишет и проверит юрист до публичного запуска.</p>
    </LegalDraft>
  );
}
