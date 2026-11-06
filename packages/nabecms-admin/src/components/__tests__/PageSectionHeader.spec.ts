import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import NabeIcon from "../NabeIcon.vue";
import PageSectionHeader from "../PageSectionHeader.vue";

/**
 * Create a minimal router for breadcrumb navigation tests.
 */
const createTestRouter = () =>
  createRouter({
    history: createMemoryHistory("/admin/"),
    routes: [
      { path: "/", component: { template: "<div />" } },
      { path: "/contents", component: { template: "<div />" } },
    ],
  });

describe("PageSectionHeader", () => {
  it("renders breadcrumb items with `to` as router links", async () => {
    const router = createTestRouter();
    await router.push("/");
    await router.isReady();

    const wrapper = mount(PageSectionHeader, {
      props: {
        title: "Entries",
        breadcrumbModel: [{ label: "Contents", to: "/contents", url: "/admin/contents" }, { label: "Entries" }],
      },
      global: {
        plugins: [router],
      },
    });

    const links = wrapper.findAll(".el-breadcrumb__inner a");
    expect(links).toHaveLength(1);
    expect(links[0].attributes("href")).toBe("/admin/contents");
    expect(links[0].text()).toContain("Contents");
  });

  it("keeps external breadcrumb items as anchors", async () => {
    const router = createTestRouter();
    await router.push("/");
    await router.isReady();

    const wrapper = mount(PageSectionHeader, {
      props: {
        title: "External",
        breadcrumbModel: [{ label: "Docs", url: "https://example.com/docs", target: "_blank" }],
      },
      global: {
        plugins: [router],
      },
    });

    const link = wrapper.get(".el-breadcrumb__inner a");
    expect(link.attributes("href")).toBe("https://example.com/docs");
    expect(link.attributes("target")).toBe("_blank");
  });

  it("renders an optional title icon", async () => {
    const router = createTestRouter();
    await router.push("/");
    await router.isReady();

    const wrapper = mount(PageSectionHeader, {
      props: {
        title: "Posts",
        titleIcon: "lucide:file-plus-2",
      },
      global: {
        plugins: [router],
      },
    });

    expect(wrapper.get(".page-section-header__title").text()).toBe("Posts");
    expect(wrapper.getComponent(NabeIcon).props("icon")).toBe("lucide:file-plus-2");
    expect(wrapper.get(".page-section-header__title-icon").attributes("aria-hidden")).toBe("true");
  });

  it("does not render subtitle text from description or hint props", async () => {
    const router = createTestRouter();
    await router.push("/");
    await router.isReady();

    const wrapper = mount(PageSectionHeader, {
      props: {
        title: "Logs",
        description: "Review audit logs.",
        hint: "Use the sidebar to switch sections.",
      },
      global: {
        plugins: [router],
      },
    });

    expect(wrapper.text()).toContain("Logs");
    expect(wrapper.text()).not.toContain("Review audit logs.");
    expect(wrapper.text()).not.toContain("Use the sidebar to switch sections.");
  });
});
