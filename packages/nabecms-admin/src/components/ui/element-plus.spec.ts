import { mount } from "@vue/test-utils";
import { ElDatePicker, ElDivider } from "element-plus";
import { describe, expect, it } from "vitest";

import { DatePicker, Divider } from "./element-plus";

describe("Element Plus compatibility adapters", () => {
  it("converts the retained PrimeVue date tokens to Element Plus tokens", () => {
    const wrapper = mount(DatePicker, {
      props: {
        dateFormat: "yy/mm/dd",
      },
    });

    expect(wrapper.findComponent(ElDatePicker).props("format")).toBe("YYYY/MM/DD");
  });

  it("maps a retained vertical divider layout to Element Plus direction", () => {
    const wrapper = mount(Divider, {
      props: {
        layout: "vertical",
      },
    });

    expect(wrapper.findComponent(ElDivider).props("direction")).toBe("vertical");
  });
});
