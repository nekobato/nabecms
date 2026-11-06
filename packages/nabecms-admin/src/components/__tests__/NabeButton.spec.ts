import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import NabeButton from "../NabeButton.vue";

describe("NabeButton", () => {
  it("emits click from the rendered button", async () => {
    const wrapper = mount(NabeButton, {
      props: {
        label: "Open dialog",
      },
      attrs: {
        type: "button",
      },
    });

    await wrapper.get("button").trigger("click");

    expect(wrapper.emitted("click")).toHaveLength(1);
  });

  it("uses the Element Plus icon slot for a left icon with text", () => {
    const wrapper = mount(NabeButton, {
      props: {
        icon: "lucide:trash-2",
        label: "Delete",
      },
    });

    const icon = wrapper.get("button > .el-icon");
    expect({
      iconClass: icon.classes(),
      followingText: icon.element.nextElementSibling?.textContent,
    }).toEqual({
      iconClass: ["el-icon"],
      followingText: "Delete",
    });
  });

  it("uses the Element Plus right-icon spacing class", () => {
    const wrapper = mount(NabeButton, {
      props: {
        icon: "lucide:arrow-right",
        iconPos: "right",
        label: "Next",
      },
    });

    expect(wrapper.get(":scope > span > .el-icon").classes()).toEqual(["el-icon", "el-icon--right"]);
  });

  it("does not render an empty text wrapper for icon-only buttons", () => {
    const wrapper = mount(NabeButton, {
      props: {
        icon: "lucide:x",
      },
      attrs: {
        "aria-label": "Close",
      },
    });

    expect(wrapper.find("button > span").exists()).toBe(false);
  });
});
