"use client";
import {Globe} from "lucide-react";
import {useLang} from "@/hooks/use-preferences";

export default function LangSwitch() {
  const {lang, setLang, t} = useLang();
  return (
    <div className="segmented" role="group" aria-label={t("Ngôn ngữ", "Language")}>
      <button aria-pressed={lang === "vi"} onClick={() => setLang("vi")} lang="vi" title="Tiếng Việt"><Globe size={12} />VI</button>
      <button aria-pressed={lang === "en"} onClick={() => setLang("en")} lang="en" title="English">EN</button>
    </div>
  );
}
