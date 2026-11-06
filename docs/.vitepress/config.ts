import { defineConfig } from "vitepress";

const org = "nekobato";
const repo = "nabecms";
const siteBase = `/${repo}/`; // for GitHub Pages under <org>.github.io/<repo>/

export default defineConfig({
  title: "NabeCMS Docs",
  description:
    "Documentation for NabeCMS, a headless CMS for Cloudflare Workers",
  base: siteBase,
  srcDir: ".",
  cleanUrls: true,
  lastUpdated: true,
  head: [
    [
      "link",
      { rel: "icon", type: "image/svg+xml", href: `${siteBase}favicon.svg` },
    ],
  ],
  themeConfig: {
    logo: {
      light: "/logo.svg",
      dark: "/logo-dark.svg",
      alt: "NabeCMS logo",
    },
    nav: [
      { text: "Overview", link: "/" },
      { text: "API", link: "/api/" },
      { text: "Admin UI", link: "/admin/" },
      { text: "Operations", link: "/operations" },
      { text: "Security", link: "/security" },
    ],
    sidebar: [
      {
        text: "Getting started",
        items: [
          { text: "Introduction", link: "/" },
          { text: "Quick Start", link: "/getting-started" },
        ],
      },
      {
        text: "Operations and configuration",
        items: [
          { text: "Operations and deployment", link: "/operations" },
          { text: "Configuration reference", link: "/configuration" },
          { text: "Data management", link: "/data-management" },
          { text: "Security", link: "/security" },
          { text: "Cloudflare requirements", link: "/cloudflare" },
          { text: "Authentication email", link: "/email" },
        ],
      },
      {
        text: "API",
        items: [
          { text: "API overview", link: "/api/" },
          { text: "Contents API", link: "/api/contents" },
          { text: "Admin API", link: "/api/admin" },
        ],
      },
      {
        text: "Admin UI",
        items: [
          { text: "Admin UI guide", link: "/admin/" },
          { text: "Field definitions", link: "/admin/fields" },
        ],
      },
      {
        text: "Developing NabeCMS",
        items: [
          { text: "Developer guide", link: "/developer" },
          { text: "Architecture", link: "/architecture" },
        ],
      },
    ],
    socialLinks: [
      { icon: "github", link: `https://github.com/${org}/${repo}` },
    ],
    footer: {
      message: "Licensed under ISC",
      copyright: "© 2025 nekobato",
    },
  },
  locales: {
    root: {
      label: "English",
      lang: "en",
    },
    ja: {
      label: "日本語",
      lang: "ja",
      title: "NabeCMS ドキュメント",
      description:
        "Cloudflare Workers で動くヘッドレス CMS、NabeCMS のドキュメント",
      themeConfig: {
        nav: [
          { text: "概要", link: "/ja/" },
          { text: "API", link: "/ja/api/" },
          { text: "管理画面", link: "/ja/admin/" },
          { text: "運用", link: "/ja/operations" },
          { text: "セキュリティ", link: "/ja/security" },
        ],
        sidebar: [
          {
            text: "はじめに",
            items: [
              { text: "イントロダクション", link: "/ja/" },
              { text: "クイックスタート", link: "/ja/getting-started" },
            ],
          },
          {
            text: "運用と設定",
            items: [
              { text: "運用とデプロイ", link: "/ja/operations" },
              { text: "設定リファレンス", link: "/ja/configuration" },
              { text: "データ管理", link: "/ja/data-management" },
              { text: "セキュリティ", link: "/ja/security" },
              { text: "Cloudflare の前提と設定", link: "/ja/cloudflare" },
              { text: "認証メール", link: "/ja/email" },
            ],
          },
          {
            text: "API",
            items: [
              { text: "API 概要", link: "/ja/api/" },
              { text: "Contents API", link: "/ja/api/contents" },
              { text: "Admin API", link: "/ja/api/admin" },
            ],
          },
          {
            text: "管理画面",
            items: [
              { text: "管理画面ガイド", link: "/ja/admin/" },
              { text: "フィールド定義", link: "/ja/admin/fields" },
            ],
          },
          {
            text: "本体の開発",
            items: [
              { text: "開発者ガイド", link: "/ja/developer" },
              { text: "アーキテクチャ", link: "/ja/architecture" },
            ],
          },
        ],
        outline: { label: "このページの内容" },
        lastUpdated: { text: "最終更新" },
        docFooter: { prev: "前のページ", next: "次のページ" },
        langMenuLabel: "言語を変更",
        sidebarMenuLabel: "メニュー",
        returnToTopLabel: "ページ上部へ",
        skipToContentLabel: "本文へ移動",
        darkModeSwitchLabel: "外観",
        lightModeSwitchTitle: "ライトテーマに切り替える",
        darkModeSwitchTitle: "ダークテーマに切り替える",
      },
    },
  },
});
