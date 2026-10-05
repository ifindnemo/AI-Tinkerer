"use client";
import Link from "next/link";
import {ArrowRight} from "lucide-react";
import {useLang} from "@/hooks/use-preferences";
import Brand from "./brand";
import LangSwitch from "./lang-switch";

// Header for the public pages (landing and film). The dashboard has its own app bar.
export default function SiteHeader({current}: {current: "home" | "film"}) {
  const {t} = useLang();
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Brand label={t("Car Neuron trang chủ", "Car Neuron home")} />
        <nav className="site-nav" aria-label={t("Điều hướng chính", "Main navigation")}>
          <Link href="/#how" className="site-nav-link">{t("Cách hoạt động", "How it works")}</Link>
          <Link href="/film" className="site-nav-link" aria-current={current === "film" ? "page" : undefined}>{t("Phim giới thiệu", "Intro film")}</Link>
        </nav>
        <div className="site-header-tools">
          <LangSwitch />
          <Link href="/garage" className="primary-button small">{t("Mở garage", "Open garage")} <ArrowRight size={15} /></Link>
        </div>
      </div>
    </header>
  );
}
