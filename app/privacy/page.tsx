import type { Metadata } from "next";
import { t } from "@/lib/copy";
import { LegalDraft } from "@/components/landing/LegalDraft";

export const metadata: Metadata = {
  title: `${t.legal.privacy} (${t.legal.draft.toLowerCase()})`,
  robots: { index: false, follow: true },
};

export default function PrivacyPage() {
  return (
    <LegalDraft title={t.legal.privacy}>
      <p>Здесь будет описано, какие данные собирает Мысль (адрес почты, имя, содержимое досок, файлы), где и сколько они хранятся, кому передаются (хостинг, база данных, почта, оплата), как удалить аккаунт и данные.</p>
      <p>Текст напишет и проверит юрист до публичного запуска, с учётом требований к обработке персональных данных.</p>
    </LegalDraft>
  );
}
