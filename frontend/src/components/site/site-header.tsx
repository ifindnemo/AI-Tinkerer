"use client";
import Link from "next/link";
import type {ReactNode} from "react";
import {useLang} from "@/hooks/use-preferences";
import Brand from "./brand";
import LangSwitch from "./lang-switch";

// One primary navigation for every page; garage controls occupy the optional second row.
export default function SiteHeader({current, children}: {current: "home" | "garage" | "driver" | "film" | "present" | "workflow"; children?: ReactNode}) {
  const {t} = useLang();
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Brand label={t("Car Neuron trang chủ", "Car Neuron home")} />
        <nav className="site-nav" aria-label={t("Điều hướng chính", "Main navigation")}>
          <Link href="/" className="site-nav-link" aria-current={current === "home" ? "page" : undefined}>{t("Trang chủ", "Home")}</Link>
          <Link href="/garage" className="site-nav-link" aria-current={current === "garage" ? "page" : undefined}>Garage</Link>
          <Link href="/driver" className="site-nav-link" aria-current={current === "driver" ? "page" : undefined}>{t("Tài xế", "Driver")}</Link>
          <Link href="/film" className="site-nav-link" aria-current={current === "film" ? "page" : undefined}>{t("Phim giới thiệu", "Intro film")}</Link>
          <Link href="/present" className="site-nav-link" aria-current={current === "present" ? "page" : undefined}>{t("Trình chiếu", "Presentation")}</Link>
          <Link href="/workflow" className="site-nav-link" aria-current={current === "workflow" ? "page" : undefined}>Workflow</Link>
        </nav>
        <div className="site-header-tools">
          <LangSwitch />
        </div>
      </div>
      {children}
    </header>
  );
}
