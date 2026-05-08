import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CrudModal } from "./crud";

describe("CrudModal", () => {
  it("renders create/edit workflows as a modal", () => {
    const html = renderToStaticMarkup(
      <CrudModal
        open
        eyebrow="Edit Admin"
        title="编辑后台用户"
        description="表单在居中弹窗中完成。"
        onClose={() => undefined}
      >
        <form className="admin-form crud-modal__form">
          <input aria-label="邮箱" />
        </form>
      </CrudModal>
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("crud-modal__surface");
    expect(html).toContain("编辑后台用户");
    expect(html).not.toContain("<aside");
    expect(html).not.toContain("crud-drawer--open");
  });

  it("does not leave a hidden drawer in the DOM when closed", () => {
    const html = renderToStaticMarkup(
      <CrudModal
        open={false}
        eyebrow="Edit Admin"
        title="编辑后台用户"
        onClose={() => undefined}
      >
        <div>hidden form</div>
      </CrudModal>
    );

    expect(html).toBe("");
  });
});
